"use client";

import { useState } from "react";
import type { SoulAccount } from "@soulledger/core/api";
import { classifySoulAccountError, useResetSoulMfa } from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField, TextField } from "@/src/components/ui/Field";
import { failureKey } from "./soulAccountsView";

/**
 * 官员替灵魂「关闭两步验证」(设计 第十八批):三条后果,理由必填(写进审计日志),再输入灵魂编号 ——
 * 危险键在两者都齐之前禁用(规范:实底红的危险键只出现在「输入名称以确认」的对话框里,
 * `dangerButtonPlacement.test.ts`;与管理员重置官员两步验证的 `MfaResetDialog` 同一形状)。
 *
 * 只关不开:没有「替灵魂开启」。入口(`SoulAccountCard`)只在该灵魂已开启、且调用者持有
 * `souls.mfa_reset` 并属于灵魂的原属殿时出现;服务端对后两者各自再核一遍。
 */
export function SoulMfaResetDialog({ account, soulName, onClose }: { account: SoulAccount; soulName: string; onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const reset = useResetSoulMfa();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [reasonMissing, setReasonMissing] = useState(false);
  const ready = reason.trim().length > 0 && typed.trim().toUpperCase() === account.soul_code.toUpperCase();

  const submit = () => {
    if (reason.trim().length === 0) return setReasonMissing(true);
    reset.mutate(
      { accountId: account.id, reason: reason.trim() },
      {
        onSuccess: () => {
          showToast(t("soul_accounts.account.mfa_reset.done"), "success");
          onClose();
        },
        onError: (error) => {
          const failure = classifySoulAccountError(error);
          if (Object.keys(failure.fields).length > 0) setReasonMissing(true);
          else showToast(t(failureKey(failure, "soul_accounts.account.failed")), "error");
        },
      }
    );
  };

  const title = t("soul_accounts.account.mfa_reset.title", { name: soulName });
  return (
    <BaseModal
      isOpen
      wide
      dismissOnOutsideClick={false}
      title={title}
      onClose={() => !reset.isPending && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={reset.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            data-testid="soul-mfa-reset-action"
            className="duration-instant"
            disabled={!ready || reset.isPending}
            loading={reset.isPending}
            onClick={submit}
          >
            <span aria-hidden="true">✕</span>
            {t("soul_accounts.account.actions.mfa_reset")}
          </Button>
        </div>
      }
    >
      <div role="alertdialog" aria-label={title} className="flex flex-col gap-4 text-sm text-[oklch(var(--color-ink))]">
        <ul className="m-0 flex list-none flex-col gap-1 border border-[oklch(var(--color-line))] p-3">
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex gap-2">
              <span aria-hidden="true" className="text-[oklch(var(--color-danger))]">!</span>
              {t(`soul_accounts.account.mfa_reset.consequence_${n}`)}
            </li>
          ))}
        </ul>
        <TextAreaField
          label={t("soul_accounts.account.mfa_reset.reason")}
          rows={2}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonMissing(false);
          }}
          maxLength={500}
          required
          error={reasonMissing ? t("soul_accounts.account.mfa_reset.reason_required") : undefined}
          disabled={reset.isPending}
        />
        <TextField
          label={t("common.type_name_to_confirm", { name: account.soul_code })}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={reset.isPending}
        />
      </div>
    </BaseModal>
  );
}
