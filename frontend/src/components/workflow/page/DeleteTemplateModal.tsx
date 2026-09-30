"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { NameConfirmDialog } from "@/src/components/admin/NameConfirmDialog";
import { type BackendTemplate } from "@/src/components/workflow/page/types";

/**
 * /workflow 的「删除模板」确认。删了拿不回来(`workflow.delete_irreversible`),所以按规范 v2
 * 走「输入名称以确认」:逐字输入模板名之前,危险按钮是禁用的。mutation 仍然归页面,这里
 * 只回报「确认删这个 id」。
 */
export function DeleteTemplateModal({
  isOpen,
  onClose,
  onConfirm,
  template,
  isPending,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (id: string) => void;
  template: BackendTemplate | null;
  isPending: boolean;
}) {
  const { t } = useI18n();

  return (
    <NameConfirmDialog
      isOpen={isOpen}
      title={t("common.confirm_delete")}
      name={template?.name ?? ""}
      actionLabel={isPending ? t("common.deleting") : t("common.confirm_delete")}
      isPending={isPending}
      onCancel={onClose}
      onConfirm={() => {
        if (template) onConfirm(String(template.id));
        onClose();
      }}
      message={
        <div className="space-y-3">
          <p>{t("workflow.delete_confirm_msg", { name: template?.name || "" })}</p>
          <p className="text-[oklch(var(--color-status-error))]">{t("workflow.delete_irreversible")}</p>
        </div>
      }
    />
  );
}
