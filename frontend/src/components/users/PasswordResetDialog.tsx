"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type User } from "@soulledger/core/api";
import { userKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { showToast } from "@/src/components/ui/Toast";

/**
 * 管理员「重置密码」:先确认(说清后果),再把服务端生成的新密码显示一次。
 *
 * 新密码只活在本组件的 `useState`:不进查询缓存、不进存储,关闭即丢(父级只在选中某行时挂载本组件)。
 * 显示之后 Esc / 点外面 / 「关闭」都先过一道确认 —— 与灵魂账号的初始密码同一做法
 * (`soul-accounts/RevealCredentialDialog`)。
 */
export function PasswordResetDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const reset = useMutation({
    mutationFn: () => usersApi.resetPassword(user.id),
    onSuccess: ({ data }) => {
      setPassword(data.password);
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
    onError: () => {
      showToast(t("users.reset_password.failed"), "error");
      onClose();
    },
  });

  const copy = async () => {
    if (password === null) return;
    try {
      await navigator.clipboard.writeText(password);
      showToast(t("users.reset_password.copied"), "success");
    } catch {
      showToast(t("users.reset_password.copy_failed"), "error");
    }
  };

  if (password === null) {
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
        <p className="text-sm text-[oklch(var(--color-ink))]">{t("users.reset_password.confirm_body")}</p>
      </BaseModal>
    );
  }

  return (
    <BaseModal
      isOpen
      onClose={() => setConfirmingClose(true)}
      dismissOnOutsideClick={false}
      title={t("users.reset_password.shown_title", { name: user.username })}
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="primary" onClick={() => setConfirmingClose(true)}>
            {t("users.reset_password.close")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p role="alert" className="text-sm text-[oklch(var(--color-status-warning))]">
          {t("users.reset_password.shown_warning")}
        </p>
        <div className="font-mono text-md break-all select-all text-[oklch(var(--color-ink))]" data-testid="reset-password-value">
          {password}
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
          {t("users.reset_password.copy")}
        </Button>
        {/* 放在面板里面:挂在同一棵树下,Esc 才只关最上面的确认层。 */}
        <ConfirmDialog
          isOpen={confirmingClose}
          title={t("users.reset_password.close_confirm_title")}
          message={t("users.reset_password.close_confirm_body")}
          confirmText={t("users.reset_password.close_confirm")}
          cancelText={t("users.reset_password.close_back")}
          variant="warning"
          onConfirm={onClose}
          onCancel={() => setConfirmingClose(false)}
        />
      </div>
    </BaseModal>
  );
}
