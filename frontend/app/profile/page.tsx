"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { showToast } from "@/src/components/ui/Toast";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge, type BadgeTone } from "@/src/components/ui/Badge";
import { TextField, fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";
import { LedgerHeading } from "@/src/components/souls/detail/SoulLedgerSections";

/**
 * Role → badge tone. `GUARDIAN` and the roles below it used to reach for
 * `--color-status-lost`, which `Badge` has no tone for; `neutral` is what a
 * role with no severity actually means, and it is the tone the data grid
 * already gives an unremarkable enum member.
 */
const ROLE_TONES: Record<string, BadgeTone> = {
  ADMIN: "error",
  JUDGE: "warning",
  GUARDIAN: "info",
};

export default function ProfilePage() {
  const { t } = useI18n();
  const { user, setUser } = useTenant();
  const queryClient = useQueryClient();

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Fetch latest profile
  const { data: profile, isLoading, isError, refetch } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await authApi.profile();
      return res.data;
    },
  });

  // Update profile mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { first_name?: string; last_name?: string; email?: string }) => {
      const res = await authApi.updateProfile(data);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      if (user && data) {
        setUser({ ...user, ...data });
      }
      setEditingField(null);
      showToast(t("profile.profile_updated"), "success");
    },
    onError: () => {
      showToast(t("profile.profile_update_failed"), "error");
    },
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: async ({ oldPassword, newPassword }: { oldPassword: string; newPassword: string }) => {
      const res = await authApi.changePassword(oldPassword, newPassword);
      return res.data;
    },
    onSuccess: () => {
      setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
      setShowPasswordForm(false);
      showToast(t("profile.password_changed"), "success");
    },
    onError: () => {
      showToast(t("profile.password_change_failed"), "error");
    },
  });

  const handleEditSave = (field: string) => {
    if (!editValue.trim()) {
      setEditingField(null);
      return;
    }
    updateMutation.mutate({ [field]: editValue.trim() });
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast(t("profile.password_mismatch"), "error");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      showToast(t("profile.password_too_short"), "error");
      return;
    }
    changePasswordMutation.mutate({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    });
  };

  const role = profile?.role || user?.role || "";

  return (
    <PageShell title={t("profile.title")} variant="prose">
      {/* A banner, not a full-page error state. Every field here falls back to
          the auth context's `user`, so a failed fetch does not blank the page
          — it shows values that may be stale without saying so, which is the
          worse failure. Replacing the whole page with QueryError would hide
          content that is still usable. The error was not read at all before
          this. */}
      {isError && (
        <div
          role="alert"
          className="mb-6 py-2 border-b border-[oklch(var(--color-rule))] flex items-center justify-between gap-4"
        >
          <p className="text-sm text-[oklch(var(--color-danger))]">
            <span aria-hidden="true">! </span>
            {t("profile.load_failed")}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] transition-colors shrink-0"
          >
            {t("error.retry")}
          </button>
        </div>
      )}

      {/* 规范 v1:区块标压线,行线代替卡片;标签在左,值在右,393 px 下同样两列。 */}
      <section className="mb-6">
        <LedgerHeading mark="甲" title={t("profile.basic_info")} />
        <dl className="grid grid-cols-[8rem_1fr] max-sm:grid-cols-[6rem_1fr] text-sm">
          <dt className={DT}>{t("profile.username")}</dt>
          <dd className={DD}>
            {isLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span className="font-medium truncate" title={profile?.username || user?.username}>
                {profile?.username || user?.username}
              </span>
            )}
          </dd>

          {(
            [
              ["email", "email", t("profile.email"), profile?.email || user?.email || "", "w-48"],
              ["first_name", "text", t("profile.first_name"), profile?.first_name || "", "w-24"],
              ["last_name", "text", t("profile.last_name"), profile?.last_name || "", "w-24"],
            ] as const
          ).map(([field, type, label, value, skeleton]) => (
            <EditableRow
              key={field}
              field={field}
              type={type}
              label={label}
              value={value}
              loading={isLoading}
              skeletonClass={skeleton}
              editing={editingField === field}
              draft={editValue}
              onDraft={setEditValue}
              onEdit={() => {
                setEditingField(field);
                setEditValue(value);
              }}
              onSave={() => handleEditSave(field)}
              onCancel={() => setEditingField(null)}
            />
          ))}

          <dt className={DT}>{t("profile.role")}</dt>
          <dd className={DD}>
            {isLoading ? (
              <Skeleton className="h-5 w-20" />
            ) : (
              <Badge tone={ROLE_TONES[role] ?? "neutral"}>
                {t(`users.roles.${role}`)}
              </Badge>
            )}
          </dd>

          <dt className={DT}>{t("profile.tenant")}</dt>
          <dd className={DD}>
            {isLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span
                className="truncate"
                title={user?.tenant?.display_name || user?.tenant?.code || undefined}
              >
                {/* /auth/profile/ is UserSerializer, which has no `tenant`
                    field at all — the two leading branches this expression
                    used to start with were dead. */}
                {user?.tenant?.display_name || user?.tenant?.code || "-"}
              </span>
            )}
          </dd>
        </dl>
      </section>

      {/* Change Password Section */}
      <section>
        <LedgerHeading mark="乙" title={t("profile.change_password")} />
        <div className="pt-3">
        {!isLoading && !showPasswordForm ? (
          <Button variant="secondary" type="button" onClick={() => setShowPasswordForm(true)}>
            {t("profile.change_password")}
          </Button>
        ) : isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : showPasswordForm ? (
          <form onSubmit={handlePasswordSubmit} className="max-w-[440px] space-y-4">
            <TextField
              type="password"
              label={t("profile.old_password")}
              value={passwordForm.oldPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
              required
            />
            <TextField
              type="password"
              label={t("profile.new_password")}
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              minLength={8}
              required
            />
            <TextField
              type="password"
              label={t("profile.confirm_password")}
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              minLength={8}
              required
            />
            <div className="flex justify-end gap-2 border-t border-[oklch(var(--color-block))] pt-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowPasswordForm(false);
                  setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={changePasswordMutation.isPending}
              >
                {changePasswordMutation.isPending
                  ? (t("common.loading"))
                  : (t("common.save"))}
              </Button>
            </div>
          </form>
        ) : null}
        </div>
      </section>
    </PageShell>
  );
}

/** 一对 dt / dd 的行线与字色(与灵魂详情「甲 · 身份」同一份写法)。 */
const DT = "py-1.5 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink-subtle))] self-stretch flex items-center";
const DD = "py-1.5 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink))] min-w-0 flex items-center gap-2";

/**
 * 一条可就地编辑的账行。邮箱 / 名 / 姓原是三段逐字相同的标记,只差字段名;
 * 编辑时控件的 `id` 与左侧 `<label htmlFor>` 成对 —— 此前那三个 `<label>` 不指向
 * 任何控件,输入框没有可读的名字。
 */
function EditableRow({
  field,
  type,
  label,
  value,
  loading,
  skeletonClass,
  editing,
  draft,
  onDraft,
  onEdit,
  onSave,
  onCancel,
}: {
  field: string;
  type: "email" | "text";
  label: string;
  value: string;
  loading: boolean;
  skeletonClass: string;
  editing: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const inputId = `profile-${field}`;
  return (
    <>
      <dt className={DT}>
        {editing ? <label htmlFor={inputId}>{label}</label> : label}
      </dt>
      <dd className={cn(DD, editing && "flex-wrap")}>
        {editing ? (
          <>
            <input
              id={inputId}
              type={type}
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              className={cn(fieldControl({ size: "sm" }), "flex-1 min-w-40")}
              autoFocus
            />
            <span className="flex gap-2 ml-auto">
              <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" size="sm" type="button" onClick={onSave}>
                {t("common.save")}
              </Button>
            </span>
          </>
        ) : (
          <>
            {loading ? (
              <Skeleton className={`h-4 ${skeletonClass}`} />
            ) : (
              <span className="truncate" title={value || undefined}>
                {value || "-"}
              </span>
            )}
            {!loading && (
              <Button variant="ghost" size="sm" type="button" className="ml-auto" onClick={onEdit}>
                {t("common.edit")}
              </Button>
            )}
          </>
        )}
      </dd>
    </>
  );
}
