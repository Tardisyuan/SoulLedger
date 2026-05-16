"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type User, type CreateUserInput, type UpdateUserInput } from "@/lib/api";
import { userKeys } from "@/lib/query_keys";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";
import { showToast } from "@/src/components/ui/Toast";

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: User | null;
}

export function UserModal({ isOpen, onClose, user }: UserModalProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEditing = !!user;

  const [formData, setFormData] = useState<CreateUserInput>({
    username: "",
    email: "",
    password: "",
    role: "VIEWER",
    first_name: "",
    last_name: "",
    tenant_id: undefined,
  });

  useEffect(() => {
    if (isOpen) {
      if (user) {
        setFormData({
          username: user.username,
          email: user.email,
          password: "",
          role: user.role,
          first_name: user.first_name || "",
          last_name: user.last_name || "",
          tenant_id: user.tenant?.id,
        });
      } else {
        setFormData({
          username: "",
          email: "",
          password: "",
          role: "VIEWER",
          first_name: "",
          last_name: "",
          tenant_id: undefined,
        });
      }
    }
  }, [isOpen, user]);

  const createMutation = useMutation({
    mutationFn: (data: CreateUserInput) => usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.create_success") || "用户创建成功", "success");
      onClose();
    },
    onError: () => {
      showToast(t("users.create_error") || "用户创建失败", "error");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.update_success") || "用户更新成功", "success");
      onClose();
    },
    onError: () => {
      showToast(t("users.update_error") || "用户更新失败", "error");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.username.trim()) {
      showToast("用户名不能为空", "error");
      return;
    }
    if (!formData.email.trim()) {
      showToast("邮箱不能为空", "error");
      return;
    }
    if (!isEditing && !formData.password) {
      showToast("密码不能为空", "error");
      return;
    }

    if (isEditing && user) {
      const updateData: UpdateUserInput = {
        email: formData.email,
        role: formData.role,
        first_name: formData.first_name,
        last_name: formData.last_name,
        tenant_id: formData.tenant_id,
      };
      if (formData.password) {
        (updateData as any).password = formData.password;
      }
      updateMutation.mutate({ id: String(user.id), data: updateData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const footer = (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onClose}
        disabled={createMutation.isPending || updateMutation.isPending}
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] disabled:opacity-50 rounded text-sm transition-colors"
      >
        {t("common.cancel") || "取消"}
      </button>
      <button
        type="submit"
        form="user-form"
        disabled={createMutation.isPending || updateMutation.isPending}
        className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-[hsl(var(--color-surface-3))] disabled:text-[hsl(var(--color-ink-subtle))] rounded text-sm font-medium text-black transition-colors"
      >
        {createMutation.isPending || updateMutation.isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t("common.submitting") || "提交中..."}
          </span>
        ) : isEditing ? (t("common.save") || "保存") : (t("common.create") || "创建")}
      </button>
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? (t("users.edit_user") || "编辑用户") : (t("users.create_user") || "创建用户")}
      footer={footer}
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("users.username") || "用户名"}</label>
          <input
            type="text"
            required
            autoFocus
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            disabled={isEditing || createMutation.isPending || updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
            placeholder={t("users.username_placeholder") || "输入用户名"}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("users.email") || "邮箱"}</label>
          <input
            type="email"
            required
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            disabled={createMutation.isPending || updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
            placeholder={t("users.email_placeholder") || "输入邮箱"}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[hsl(var(--color-ink-subtle))]">
            {t("users.password") || "密码"}
            {isEditing && <span className="text-[hsl(var(--color-ink-muted))]"> ({t("users.optional") || "可选"})</span>}
          </label>
          <input
            type="password"
            required={!isEditing}
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            disabled={createMutation.isPending || updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
            placeholder={isEditing ? (t("users.password_edit_placeholder") || "留空则不修改") : (t("users.password_placeholder") || "输入密码")}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("users.role") || "角色"}</label>
          <select
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value as CreateUserInput["role"] })}
            disabled={createMutation.isPending || updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
          >
            <option value="ADMIN">{t("users.role_admin") || "管理员"}</option>
            <option value="JUDGE">{t("users.role_judge") || "审判者"}</option>
            <option value="GUARDIAN">{t("users.role_guardian") || "守护者"}</option>
            <option value="VIEWER">{t("users.role_viewer") || "查看者"}</option>
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("users.first_name") || "名"}</label>
            <input
              type="text"
              value={formData.first_name}
              onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
              placeholder={t("users.first_name_placeholder") || "名"}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("users.last_name") || "姓"}</label>
            <input
              type="text"
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
              placeholder={t("users.last_name_placeholder") || "姓"}
            />
          </div>
        </div>
      </form>
    </BaseModal>
  );
}
