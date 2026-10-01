"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";

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
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            {t("souls.detail.cancel_delete")}
          </Button>
          {/* 移入回收站,不是抹去(见下面那句说明):可逆的风险动作 = warning(规范 v3);
              danger-strong 只给不可逆的删除。 */}
          <Button type="button" variant="warning" onClick={onConfirm} loading={isPending}>
            {isPending ? t("souls.detail.deleting") : t("souls.detail.confirm_delete_action")}
          </Button>
        </div>
      }
    >
      <p className="text-[oklch(var(--color-ink))] text-sm">{t("souls.detail.delete_confirm_message")}</p>
    </BaseModal>
  );
}
