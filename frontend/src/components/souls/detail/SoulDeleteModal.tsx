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
  name = "",
  archivable = false,
  onArchive,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  name?: string;
  /** 删除被 409 `archivable: true` 拒了:确认框原地换成「不能删、可以归档」,不另弹。 */
  archivable?: boolean;
  onArchive?: () => void;
}) {
  const { t } = useI18n();

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={archivable ? t("records.archive.blocked_title") : t("souls.detail.confirm_delete")}
      footer={
        archivable ? (
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="primary" onClick={onArchive}>
              {t("records.archive.action")}
            </Button>
          </div>
        ) : (
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
        )
      }
    >
      <p className="text-[oklch(var(--color-ink))] text-sm">
        {archivable ? t("records.archive.blocked_body", { name }) : t("souls.detail.delete_confirm_message")}
      </p>
    </BaseModal>
  );
}
