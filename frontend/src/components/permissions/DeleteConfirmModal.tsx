"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";

/**
 * The delete confirmation used for both a permission and a role. The two were
 * byte-identical apart from their title and body copy, so the only thing a
 * caller supplies is those two strings — the footer's two buttons, their
 * variants and their pending copy are shared by construction rather than by
 * two people happening to spell them the same way.
 */
export function DeleteConfirmModal({
  isOpen,
  title,
  message,
  isPending,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isPending}
            className="flex-1"
          >
            {t("permissions.cancel_delete")}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1"
          >
            {isPending ? t("permissions.deleting") : t("permissions.confirm_delete_action")}
          </Button>
        </div>
      }
    >
      <p className="text-[hsl(var(--color-ink))] text-03">{message}</p>
    </BaseModal>
  );
}
