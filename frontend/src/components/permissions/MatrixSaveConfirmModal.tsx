"use client";

import { Role } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import type { RoleDiff } from "./matrixDiff";

/**
 * Three-tier save confirmation (tier 2 and tier 3 diffs).
 *
 * Design A6(2026-10-02):按角色分组 ——「角色 · N 人」小标题,下面每处改动一行 48 高:
 * 字形(＋ 待授 / − 待撤)+ 等宽权限码。不用成功 / 失败色:撤一项权限不是一次出错,
 * 字形已经说了方向。确认按钮是主按钮 —— 清空一个角色的授权可以再授回来,不是不可撤回的删除。
 */
export function MatrixSaveConfirmModal({
  isOpen,
  diffs,
  roleMeta,
  typedRoleNames,
  onTypedRoleNameChange,
  isSaving,
  canConfirmSave,
  onClose,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  diffs: RoleDiff[];
  roleMeta: Record<string, Role>;
  typedRoleNames: Record<string, string>;
  onTypedRoleNameChange: (role: string, value: string) => void;
  isSaving: boolean;
  canConfirmSave: boolean;
  onClose: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("permissions.matrix.confirm_title")}
      footer={
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1"
          >
            {t("permissions.matrix.confirm_cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onConfirm}
            disabled={isSaving || !canConfirmSave}
            className="flex-1"
          >
            {isSaving ? t("permissions.matrix.confirm_submitting") : t("permissions.matrix.confirm_submit")}
          </Button>
        </div>
      }
    >
      <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {diffs.map((diff) => (
          <div key={diff.role} data-confirm-role={diff.role}>
            <div className="flex items-center justify-between py-2">
              <h4 className="text-2xs font-normal text-[oklch(var(--color-ink-subtle))]">
                {/* A role the meta table does not know falls back to its translated
                    built-in name, never to the raw member (§4.6; found by ENUM_FIELDS
                    gaining `role`). */}
                {roleMeta[diff.role]?.display_name || <DomainEnum namespace="users.roles" value={diff.role} />}
              </h4>
              <span className="text-xs font-mono text-[oklch(var(--color-ink-muted))]">{diff.beforeCount} → {diff.afterCount}</span>
            </div>
            {diff.tier >= 2 && (
              <p className="text-xs text-[oklch(var(--color-ink-muted))]">
                {t("permissions.matrix.confirm_user_count", { count: String(roleMeta[diff.role]?.user_count ?? 0) })}
              </p>
            )}
            {diff.removedCodenames.length > 0 && (
              <p className="pb-1 text-xs text-[oklch(var(--color-ink-muted))]">{t("permissions.matrix.confirm_removed_label")}</p>
            )}
            <ul className="border-b border-[oklch(var(--color-line))]">
              {[
                ...diff.removedCodenames.map((c) => ["−", c] as const),
                ...diff.addedCodenames.map((c) => ["＋", c] as const),
              ].map(([glyph, c]) => (
                <li key={`${glyph}${c}`} className="flex min-h-12 items-center gap-2 border-t border-[oklch(var(--color-line))] text-sm">
                  <span aria-hidden="true" className="w-5 text-center">{glyph}</span>
                  <span className="font-mono text-[oklch(var(--color-ink))]">{c}</span>
                </li>
              ))}
            </ul>
            {diff.tier === 3 && (
              <div className="mt-2 space-y-2 pt-2">
                <p className="text-xs font-medium text-[oklch(var(--color-ink))]">
                  <span aria-hidden="true">◐ </span>
                  {t("permissions.matrix.confirm_clear_warning", { role: diff.role })}
                </p>
                {diff.removesMenuRead && (
                  <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("permissions.matrix.confirm_menu_read_warning")}</p>
                )}
                <TextField
                  id={`type-confirm-${diff.role}`}
                  label={t("permissions.matrix.confirm_type_role_label", { role: diff.role })}
                  value={typedRoleNames[diff.role] ?? ""}
                  onChange={(e) => onTypedRoleNameChange(diff.role, e.target.value)}
                  placeholder={diff.role}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </BaseModal>
  );
}
