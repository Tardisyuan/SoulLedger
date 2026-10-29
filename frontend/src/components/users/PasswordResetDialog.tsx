"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type PasswordResetLink, type User } from "@soulledger/core/api";
import { userKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { showToast } from "@/src/components/ui/Toast";
import { useSecondFactor } from "./SecondFactorPrompt";

/**
 * 管理员「重置密码」(2026-10-29 用户决定第 8 条):先确认(说清后果),再显示服务端给的一次性设置链接
 * (24 小时、只能用一次),由管理员转交本人,本人在链接上自己设密码。**不再有明文密码** —— 谁都看不到新密码。
 * 对另一位管理员:服务端要操作人自己的两步验证码,`useSecondFactor` 在 403 `second_factor_required` 时弹出输入。
 * 链接只活在本组件的 `useState`:不进查询缓存、不进存储,关闭即丢;丢了就再重置一次(旧链接随之失效)。
 */
export function PasswordResetDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<PasswordResetLink | null>(null);
  const secondFactor = useSecondFactor(user.username);
  const reset = useMutation({
    mutationFn: () => secondFactor.run((proof) => usersApi.resetPassword(user.id, proof)),
    onSuccess: ({ data }) => {
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
    onError: () => {
      showToast(t("users.reset_password.failed"), "error");
      onClose();
    },
  });

  const copy = async () => {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(result.link);
      showToast(t("users.reset_password.copied"), "success");
    } catch {
      showToast(t("users.reset_password.copy_failed"), "error");
    }
  };

  if (result === null) {
    return (
      <BaseModal
        isOpen
        onClose={() => !reset.isPending && onClose()}
        title={t("users.reset_password.confirm_title", { name: user.username })}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={reset.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="warning"
              data-testid="password-reset-confirm"
              onClick={() => reset.mutate()}
              loading={reset.isPending}
            >
              {t("users.reset_password.confirm")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[oklch(var(--color-ink))]">{t("users.reset_password.confirm_body_link")}</p>
        {secondFactor.prompt}
      </BaseModal>
    );
  }

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={t("users.reset_password.link_title", { name: user.username })}
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="primary" onClick={onClose}>
            {t("users.reset_password.link_close")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p role="alert" className="text-sm text-[oklch(var(--color-status-warning))]">
          {t("users.reset_password.link_warning", { hours: String(Math.round(result.expires_in / 3600)) })}
        </p>
        <div className="font-mono text-sm break-all select-all text-[oklch(var(--color-ink))]" data-testid="reset-password-link">
          {result.link}
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
          {t("users.reset_password.link_copy")}
        </Button>
      </div>
    </BaseModal>
  );
}
