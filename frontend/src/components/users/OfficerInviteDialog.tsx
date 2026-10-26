"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { officerRefusalOf, permApi, tenantsApi, usersApi, type OfficerInviteInput } from "@soulledger/core/api";
import { permissionKeys, userKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { showToast } from "@/src/components/ui/Toast";

/**
 * 「邀请官员」(第五十四批 V-1):邮箱 + 角色(官员角色,不含灵魂与全局管理员)+ 选填的用户名与显示名。
 * 全局管理员(能选的殿不止一个)最前面多一个必填的「殿」。后端 400 的 `{code, field}` 挂在 `field` 指的字段下面;
 * 201 / 200 两句 toast:新邀请 / 同一个还没接受的邮箱再发一次(重发)。
 */
const FIELD_OF: Record<string, "email" | "role" | "username"> = {
  email_invalid: "email",
  role_invalid: "role",
  email_taken: "email",
  username_taken: "username",
};

export function OfficerInviteDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tenant, setTenant] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"email" | "role" | "username" | "tenant", string>>>({});

  const rolesQuery = useQuery({
    queryKey: permissionKeys.roles,
    queryFn: async () => (await permApi.roles.list()).data,
    enabled: isOpen,
  });
  const tenantsQuery = useQuery({
    queryKey: ["tenants", "for-user-create"],
    queryFn: async () => (await tenantsApi.list()).data.results,
    enabled: isOpen,
  });
  const roleOptions = (rolesQuery.data ?? [])
    .filter((r) => r.name !== "SOUL" && r.name !== "ADMIN")
    .map((r) => ({ value: r.name, label: r.is_builtin ? t(`users.roles.${r.name}`) : r.display_name || r.name }));
  const tenantChoices = tenantsQuery.data ?? [];
  const needsTenant = tenantChoices.length > 1;
  const roleValue = role || roleOptions[0]?.value || "";

  const invite = useMutation({
    mutationFn: async (data: OfficerInviteInput) => usersApi.invite(data),
    onSuccess: (res, vars) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t(res.status === 200 ? "officerInvite.resent_toast" : "officerInvite.sent_toast", { email: vars.email }), "success");
      close();
    },
    onError: (error) => {
      const refusal = officerRefusalOf(error);
      const field = refusal?.field ? (refusal.field as keyof typeof errors) : refusal ? FIELD_OF[refusal.code] : undefined;
      if (refusal && field && FIELD_OF[refusal.code]) {
        setErrors({ [field]: t(`officerInvite.error.${refusal.code}`) });
      } else if ((error as { response?: { data?: { email?: unknown } } })?.response?.data?.email) {
        setErrors({ email: t("officerInvite.error.email_invalid") });
      } else {
        showToast(t("users.create_error"), "error");
      }
    },
  });

  const close = () => {
    setEmail("");
    setRole("");
    setUsername("");
    setDisplayName("");
    setTenant("");
    setErrors({});
    onClose();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (invite.isPending) return;
    const next: typeof errors = {};
    if (!email.trim()) next.email = t("officerInvite.error.email_invalid");
    if (needsTenant && !tenant) next.tenant = t("officerInvite.hall");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    invite.mutate({
      email: email.trim(),
      role: roleValue,
      ...(username.trim() ? { username: username.trim() } : {}),
      ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
      ...(needsTenant ? { tenant } : {}),
    });
  };

  const clear = (key: keyof typeof errors) => setErrors(({ [key]: _drop, ...rest }) => rest);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => !invite.isPending && close()}
      title={t("officerInvite.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close} disabled={invite.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="officer-invite-form" variant="primary" loading={invite.isPending}>
            {t("officerInvite.send")}
          </Button>
        </div>
      }
    >
      <form id="officer-invite-form" onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("officerInvite.body")}</p>
        {needsTenant && (
          <SelectField
            label={t("officerInvite.hall")}
            required
            value={tenant}
            error={errors.tenant}
            onChange={(e) => {
              clear("tenant");
              setTenant(e.target.value);
            }}
            options={[{ value: "", label: "" }, ...tenantChoices.map((x) => ({ value: x.code, label: x.display_name || x.code }))]}
          />
        )}
        <TextField
          label={t("users.email")}
          type="email"
          required
          value={email}
          error={errors.email}
          onChange={(e) => {
            clear("email");
            setEmail(e.target.value);
          }}
        />
        <SelectField
          label={t("users.role")}
          value={roleValue}
          error={errors.role}
          onChange={(e) => {
            clear("role");
            setRole(e.target.value);
          }}
          options={roleOptions}
        />
        <TextField
          label={t("officerInvite.username_optional")}
          description={t("officerInvite.username_hint")}
          value={username}
          error={errors.username}
          onChange={(e) => {
            clear("username");
            setUsername(e.target.value);
          }}
        />
        <TextField
          label={t("officerInvite.display_name_optional")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </form>
    </BaseModal>
  );
}
