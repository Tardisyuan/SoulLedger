"use client";

import { useMutation } from "@tanstack/react-query";
import { usersApi, type User } from "@/lib/api";
import { userKeys } from "@/lib/query_keys";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/src/components/ui/Toast";

interface UserDeleteDialogProps {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
}

export function UserDeleteDialog({ user, isOpen, onClose, onConfirm }: UserDeleteDialogProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.delete_success") || "用户已删除", "success");
      onClose();
      onConfirm?.();
    },
    onError: () => {
      showToast(t("users.delete_error") || "用户删除失败", "error");
    },
  });

  const handleConfirm = () => {
    if (user) {
      deleteMutation.mutate(String(user.id));
    }
  };

  const footer = (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onClose}
        disabled={deleteMutation.isPending}
        className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-ink-muted hover:bg-surface-3 disabled:opacity-50 rounded text-sm transition-colors"
      >
        {t("common.cancel") || "取消"}
      </button>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={deleteMutation.isPending}
        className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-400 disabled:bg-surface-3 disabled:text-ink-subtle rounded text-sm font-medium text-white transition-colors"
      >
        {deleteMutation.isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t("common.submitting") || "提交中..."}
          </span>
        ) : (t("common.delete") || "删除")}
      </button>
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("users.delete_title") || "确认删除"}
      footer={footer}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink">
          {t("users.delete_confirm") || "确定要删除以下用户吗？此操作无法撤销。"}
        </p>
        {user && (
          <div className="bg-surface-1 rounded border border-hairline p-3 space-y-1">
            <p className="text-sm font-medium text-ink">
              <span className="text-ink-subtle">{t("users.username") || "用户名"}: </span>
              {user.username}
            </p>
            <p className="text-sm text-ink">
              <span className="text-ink-subtle">{t("users.email") || "邮箱"}: </span>
              {user.email}
            </p>
            <p className="text-sm text-ink">
              <span className="text-ink-subtle">{t("users.role") || "角色"}: </span>
              {user.role}
            </p>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
