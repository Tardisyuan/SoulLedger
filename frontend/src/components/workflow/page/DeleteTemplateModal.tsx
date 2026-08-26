"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { type BackendTemplate } from "@/src/components/workflow/page/types";

/**
 * /workflow 的「删除模板」确认弹窗。原先长在 app/workflow/page.tsx 的 return 里，
 * 那个文件越过仓库 500 行的上限之后搬到这里。
 *
 * 标记逐字未改。改的只是它从哪里拿状态：`confirmModalOpen` /
 * `setConfirmModalOpen(false)` / `confirmingTemplate` / `deleteMutation` 换成
 * prop `isOpen` / `onClose` / `template` / `onConfirm` + `isPending` —— mutation
 * 仍然归页面，这里只回报「确认删这个 id」。
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
    <BaseModal
      isOpen={isOpen}
      onClose={() => onClose()}
      title={t("common.confirm_delete")}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => onClose()}>
            {t("common.cancel")}
          </Button>
          {/* Was `bg-status-error` + `text-white`, which measures 3.59:1 in
              the dark theme — under AA, on the one control in this dialog
              that destroys something. `Button`'s danger variant is the
              10%-tint recipe that clears AA in both themes. */}
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              if (template) {
                onConfirm(String(template.id));
              }
              onClose();
            }}
            disabled={isPending}
          >
            {isPending ? (t("common.deleting")) : (t("common.confirm_delete"))}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-03 text-ink">{t("workflow.delete_confirm_msg", { name: template?.name || "" })}</p>
        <p className="text-03 text-[hsl(var(--color-status-error))]">{t("workflow.delete_irreversible")}</p>
      </div>
    </BaseModal>
  );
}
