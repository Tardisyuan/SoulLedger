"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";

/** Delete Confirmation Modal */
export function SoulDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  isPending,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { t } = useI18n();

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("souls.detail.confirm_delete")}
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 text-03 transition-colors"
          >
            {t("souls.detail.cancel_delete")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 px-4 py-2 bg-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.8)] disabled:opacity-50 text-white text-03 font-medium transition-colors"
          >
            {isPending ? t("souls.detail.deleting") : t("souls.detail.confirm_delete_action")}
          </button>
        </div>
      }
    >
      <p className="text-[hsl(var(--color-ink))] text-03">{t("souls.detail.delete_confirm_message")}</p>
    </BaseModal>
  );
}
