"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { NameConfirmDialog } from "@/src/components/admin/NameConfirmDialog";

/**
 * 删除权限的确认。删除不进回收站,所以按规范 v2 走「输入名称以确认」:要逐字输入权限码,
 * 危险按钮在那之前是禁用的。
 */
export function DeleteConfirmModal({
  isOpen,
  title,
  message,
  name,
  isPending,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  /** 要逐字输入的权限码。 */
  name: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <NameConfirmDialog
      isOpen={isOpen}
      title={title}
      message={message}
      name={name}
      actionLabel={isPending ? t("permissions.deleting") : t("permissions.confirm_delete_action")}
      isPending={isPending}
      onCancel={onClose}
      onConfirm={onConfirm}
    />
  );
}
