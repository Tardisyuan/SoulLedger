"use client";

import { type User } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";

/**
 * 停用官员,而他手上还有在途的事(第五十四批 H-1):「停用前先移交?」。只在打开前的那一次预览(只读)发现有事时才出现;
 * 没有在途的事就不弹,仍是直接停用。
 *
 * 「仍然停用」用 ink 实底,不用危险色:停用可以恢复,在途的事停用后仍在他名下、以后还能移交。
 * 它不是默认按钮,排在「移交在途案件」之后,把移交当作离职流程的第一步。
 */
export function OfficerDeactivateDialog({
  user,
  pending,
  onHandover,
  onDeactivate,
  onClose,
}: {
  user: User;
  pending: boolean;
  onHandover: () => void;
  onDeactivate: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const who = user.display_name || user.username;
  return (
    <BaseModal
      isOpen
      onClose={() => !pending && onClose()}
      title={`${t("users.deactivate")} ${who}`}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" data-testid="deactivate-anyway" onClick={onDeactivate} loading={pending}>
            {t("officerHandover.deactivate_anyway")}
          </Button>
          <Button type="button" variant="secondary" data-testid="deactivate-handover" onClick={onHandover} disabled={pending}>
            {t("officerHandover.action")}
          </Button>
        </div>
      }
    >
      <p role="alert" className="text-sm text-[oklch(var(--color-ink))]">
        <span aria-hidden="true">! </span>
        {t("officerHandover.deactivate_prompt", { name: who })}
      </p>
    </BaseModal>
  );
}
