"use client";

import { Role } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import type { RoleDiff } from "./matrixDiff";

/** Three-tier save confirmation (tier 2 and tier 3 diffs). */
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
            variant="danger"
            onClick={onConfirm}
            disabled={isSaving || !canConfirmSave}
            className="flex-1"
          >
            {isSaving ? t("permissions.matrix.confirm_submitting") : t("permissions.matrix.confirm_submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        <p className="text-03 text-[hsl(var(--color-status-warning))]">{t("permissions.matrix.confirm_replace_notice")}</p>
        {diffs.map((diff) => (
          <div key={diff.role} className="border border-[hsl(var(--color-hairline))] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-[hsl(var(--color-ink))] text-03">{roleMeta[diff.role]?.display_name || diff.role}</h4>
              <span className="text-02 font-mono text-[hsl(var(--color-ink-muted))]">{diff.beforeCount} → {diff.afterCount}</span>
            </div>
            {diff.tier >= 2 && (
              <p className="text-02 text-[hsl(var(--color-ink-muted))]">
                {t("permissions.matrix.confirm_user_count", { count: String(roleMeta[diff.role]?.user_count ?? 0) })}
              </p>
            )}
            {diff.addedCodenames.length > 0 && (
              <p className="text-02 text-[hsl(var(--color-status-success))] font-mono">+ {diff.addedCodenames.join(", ")}</p>
            )}
            {diff.removedCodenames.length > 0 && (
              <div>
                <p className="text-02 text-[hsl(var(--color-status-error))] mb-1">{t("permissions.matrix.confirm_removed_label")}</p>
                <ul className="text-02 font-mono text-[hsl(var(--color-status-error))] list-disc list-inside space-y-1">
                  {diff.removedCodenames.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            )}
            {diff.tier === 3 && (
              <div className="mt-2 space-y-2 border-t border-[hsl(var(--color-hairline))] pt-2">
                <p className="text-02 text-[hsl(var(--color-status-error))] font-medium">
                  {t("permissions.matrix.confirm_clear_warning", { role: diff.role })}
                </p>
                {diff.removesMenuRead && (
                  <p className="text-02 text-[hsl(var(--color-status-error))]">{t("permissions.matrix.confirm_menu_read_warning")}</p>
                )}
                <label htmlFor={`type-confirm-${diff.role}`} className="block text-02 text-[hsl(var(--color-ink-muted))]">
                  {t("permissions.matrix.confirm_type_role_label", { role: diff.role })}
                </label>
                <input
                  id={`type-confirm-${diff.role}`}
                  type="text"
                  value={typedRoleNames[diff.role] ?? ""}
                  onChange={(e) => onTypedRoleNameChange(diff.role, e.target.value)}
                  placeholder={diff.role}
                  className="w-full px-2 py-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 font-mono text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </BaseModal>
  );
}
