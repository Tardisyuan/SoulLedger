"use client";

import { useMutation } from "@tanstack/react-query";
import { usersApi, type User } from "@soulledger/core/api";
import { userKeys } from "@soulledger/core/query_keys";
import { NameConfirmDialog } from "@/src/components/admin/NameConfirmDialog";
import { RoleName } from "@/src/components/users/RoleName";
import { useI18n } from "@/src/contexts/I18nContext";
import { useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/src/components/ui/Toast";

interface UserDeleteDialogProps {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
}

/**
 * 删除用户。User 是软删(AuditUserFields),但**不进回收站**(apps/core/recycle_bin.py 没有
 * 登记它),界面上拿不回来 —— 不可撤回,所以按规则走「输入名称以确认」:输入用户名,
 * 危险按钮在名字对上之前禁用。此前是一对手搓按钮,确认键是 10% 红底。
 */
export function UserDeleteDialog({ user, isOpen, onClose, onConfirm }: UserDeleteDialogProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.delete_success"), "success");
      onClose();
      onConfirm?.();
    },
    onError: () => {
      showToast(t("users.delete_error"), "error");
    },
  });

  return (
    <NameConfirmDialog
      isOpen={isOpen}
      title={t("users.delete_title")}
      name={user?.username ?? ""}
      actionLabel={t("common.delete")}
      isPending={deleteMutation.isPending}
      onCancel={onClose}
      onConfirm={() => {
        if (user) deleteMutation.mutate(String(user.id));
      }}
      message={
        <div className="space-y-4">
          <p>{t("users.delete_confirm")}</p>
          {user && (
            <div className="border border-[oklch(var(--color-hairline))] p-3 space-y-1">
              <p className="font-medium">
                <span className="text-[oklch(var(--color-ink-subtle))]">{t("users.username")}: </span>
                {user.username}
              </p>
              <p>
                <span className="text-[oklch(var(--color-ink-subtle))]">{t("users.email")}: </span>
                {user.email}
              </p>
              <p>
                <span className="text-[oklch(var(--color-ink-subtle))]">{t("users.role")}: </span>
                <RoleName value={user.role} />
              </p>
            </div>
          )}
        </div>
      }
    />
  );
}
