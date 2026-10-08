"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type User } from "@soulledger/core/api";
import { userKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField, TextField } from "@/src/components/ui/Field";
import { showToast } from "@/src/components/ui/Toast";

/**
 * 管理员「重置两步验证」(A12):560 的对话框,列三条后果,理由必填(写入审计),再输入账号名;
 * 危险键在两者都齐之前禁用。只对已开启的行出现 —— 入口由用户列表按 `user.mfa.enabled` 决定。
 */
export function MfaResetDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const reset = useMutation({
    mutationFn: () => usersApi.resetMfa(user.id, reason.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("mfa.admin.reset_done"), "success");
      onClose();
    },
    onError: () => showToast(t("mfa.admin.reset_failed"), "error"),
  });
  const ready = reason.trim().length > 0 && typed.trim() === user.username;

  return (
    <BaseModal
      isOpen
      wide
      dismissOnOutsideClick={false}
      title={t("mfa.admin.reset_title", { name: user.username })}
      onClose={() => !reset.isPending && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={reset.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            data-testid="mfa-reset-action"
            className="duration-instant"
            disabled={!ready || reset.isPending}
            loading={reset.isPending}
            onClick={() => reset.mutate()}
          >
            <span aria-hidden="true">✕</span>
            {t("mfa.admin.reset")}
          </Button>
        </div>
      }
    >
      <div role="alertdialog" aria-label={t("mfa.admin.reset_title", { name: user.username })} className="flex flex-col gap-4 text-sm text-[oklch(var(--color-ink))]">
        <ul className="m-0 flex list-none flex-col gap-1 border border-[oklch(var(--color-line))] p-3">
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex gap-2">
              <span aria-hidden="true" className="text-[oklch(var(--color-danger))]">!</span>
              {t(`mfa.admin.reset_consequence_${n}`)}
            </li>
          ))}
        </ul>
        <TextAreaField
          label={t("mfa.admin.reset_reason")}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          required
          disabled={reset.isPending}
        />
        <TextField
          label={t("common.type_name_to_confirm", { name: user.username })}
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
