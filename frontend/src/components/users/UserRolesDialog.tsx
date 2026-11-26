"use client";

import { useId, useState } from "react";
import type { User } from "@soulledger/core/api";
import { useRoles } from "@soulledger/core/hooks/usePermissionMatrix";
import { useAssignUserRoles } from "@soulledger/core/hooks/useUsers";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";
import { showToast } from "@/src/components/ui/Toast";
import { Button } from "@/src/components/ui/Button";
import { SelectField } from "@/src/components/ui/Field";
import { SYSTEM_ADMIN_ROLE_NAME, isAdminRole } from "@soulledger/core/api/perm";

/**
 * 设置一个人的主角色与兼任角色。权限是它们的并集,并集在服务端算
 * (`apps/perm/checker.py::check_permission`);这里只负责选。
 *
 * 选项来自角色表(同 UserModal:自建角色可被持有,写死的清单迟早漏)。
 * 兼任里没有 ADMIN 与 SOUL —— 服务端拒绝,所以界面不给选;主角色是 ADMIN 时
 * 兼任整块禁用,保存时发 `[]`(管理员已拥有全部权限)。
 */
export function UserRolesDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  // Open while there is a user; keyed by them so the choices start from that user's roles (a `key`, not an effect
  // that copies props into state; audit 2026-11-26 §2.5).
  return user ? <UserRolesForm key={user.id} user={user} onClose={onClose} /> : null;
}

function UserRolesForm({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
  const formId = useId();
  const assign = useAssignUserRoles();
  const [primary, setPrimary] = useState(user.role);
  const [extras, setExtras] = useState<string[]>(() => (user.extra_roles ?? []).filter((r) => r !== user.role));

  const rolesQuery = useRoles();
  const labelOf = (name: string, displayName?: string, builtin?: boolean) =>
    builtin ? t(`users.roles.${name}`) : displayName || name;
  // SYSTEM_ADMIN 由系统建,不在这里分配;正是系统管理员本人时留着,免得保存时悄悄换掉。
  const roles = (rolesQuery.data ?? []).filter((r) => r.name !== "SOUL" && (r.name !== SYSTEM_ADMIN_ROLE_NAME || r.name === primary));
  // While the table loads, the current primary stays the only option, so a save never changes it silently.
  const primaryOptions =
    roles.length > 0
      ? roles.map((r) => ({ value: r.name, label: labelOf(r.name, r.display_name, r.is_builtin) }))
      : [{ value: primary, label: primary }];
  const extraCandidates = roles.filter((r) => !isAdminRole(r.name) && r.name !== primary);
  const adminLocked = isAdminRole(primary);

  const toggle = (name: string, on: boolean) =>
    setExtras((cur) => (on ? [...cur.filter((r) => r !== name), name] : cur.filter((r) => r !== name)));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    assign.mutate(
      { id: String(user.id), role: primary, extra_roles: adminLocked ? [] : extras.filter((r) => r !== primary) },
      {
        onSuccess: () => {
          showToast(t("users.roles_dialog.saved"), "success");
          onClose();
        },
        onError: () => showToast(t("users.roles_dialog.error"), "error"),
      }
    );
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={t("users.roles_dialog.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={assign.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={`${formId}-form`} variant="primary" loading={assign.isPending}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <form id={`${formId}-form`} onSubmit={save} className="space-y-4">
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">
          {t("users.roles_dialog.for_user", { name: user.username })}
        </p>
        <SelectField
          label={t("users.roles_dialog.primary")}
          description={t("users.roles_dialog.primary_hint")}
          value={primary}
          onChange={(e) => setPrimary(e.target.value)}
          disabled={assign.isPending || rolesQuery.isPending}
          options={primaryOptions}
        />
        <fieldset className="space-y-2" disabled={assign.isPending || adminLocked}>
          <legend className="text-sm text-[oklch(var(--color-ink-muted))]">{t("users.roles_dialog.extra")}</legend>
          <p className="text-xs text-[oklch(var(--color-ink-subtle))]">
            {adminLocked ? t("users.roles_dialog.admin_locked") : t("users.roles_dialog.extra_hint")}
          </p>
          {!adminLocked && extraCandidates.length === 0 && (
            <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("users.roles_dialog.extra_none")}</p>
          )}
          <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {extraCandidates.map((r) => (
              <label key={r.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!adminLocked && extras.includes(r.name)}
                  onChange={(e) => toggle(r.name, e.target.checked)}
                />
                {labelOf(r.name, r.display_name, r.is_builtin)}
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </BaseModal>
  );
}
