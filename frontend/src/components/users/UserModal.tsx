"use client";

import { useState, useEffect, useId, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type User, type CreateUserInput, type UpdateUserInput } from "@soulledger/core/api";
import { userKeys } from "@soulledger/core/query_keys";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";
import { showToast } from "@/src/components/ui/Toast";
import { TextField } from "@/src/components/ui/Field";
import { useSubmitErrorFocus } from "@/src/lib/submitErrorFocus";

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: User | null;
}

export function UserModal({ isOpen, onClose, user }: UserModalProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEditing = !!user;

  // Unique prefix so field ids never collide across multiple UserModal
  // instances mounted at once.
  const formId = useId();
  const usernameId = `${formId}-username`;
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;
  const roleId = `${formId}-role`;
  const firstNameId = `${formId}-first-name`;
  const lastNameId = `${formId}-last-name`;

  const [formData, setFormData] = useState<CreateUserInput>({
    username: "",
    email: "",
    password: "",
    role: "VIEWER",
    first_name: "",
    last_name: "",
    tenant: undefined,
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
          tenant: user.tenant?.id,
        });
      } else {
        setFormData({
          username: "",
          email: "",
          password: "",
          role: "VIEWER",
          first_name: "",
          last_name: "",
          tenant: undefined,
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

  /**
   * 逐字段的错误,取代三条指名了字段却只弹 toast 的校验。
   *
   * 原来是 `showToast(t("users.username_empty"), "error")` 然后 `return`。
   * 那三条**知道是哪个字段**(它们的键就叫 username / email / password),却把
   * 这个信息扔进一条会飘走的横幅里,而字段本身既没有 `aria-invalid` 也没有
   * 可读的说明,焦点还留在提交按钮上 —— 在 `BaseModal` 可滚动的正文里,出错的
   * 那一栏可能就在视野之外。
   *
   * 三个 `<input>` 一并换成 `TextField`:`Field` 已经把 `aria-invalid`、
   * 链式 `aria-describedby` 和 `role="alert"` 接好了(`Field.tsx:164-247`),
   * 手写一遍等于再造一个方言。
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitErrorFocus(Object.keys(fieldErrors).length > 0, formRef);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 一次收齐,而不是逐条 return:三个都空的时候,操作员应该一次看见三条,
    // 而不是修一条、再提交、再被告知下一条。
    const next: Record<string, string> = {};
    if (!formData.username.trim()) next.username = t("users.username_empty");
    if (!formData.email.trim()) next.email = t("users.email_empty");
    if (!isEditing && !formData.password) next.password = t("users.password_empty");
    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;

    if (isEditing && user) {
      const updateData: UpdateUserInput = {
        email: formData.email,
        role: formData.role,
        first_name: formData.first_name,
        last_name: formData.last_name,
        tenant: formData.tenant,
      };
      if (formData.password) {
        updateData.password = formData.password;
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
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] disabled:opacity-50 text-03 transition-colors"
      >
        {t("common.cancel") || "取消"}
      </button>
      <button
        type="submit"
        form="user-form"
        disabled={createMutation.isPending || updateMutation.isPending}
        className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-[hsl(var(--color-surface-3))] disabled:text-[hsl(var(--color-ink-subtle))] text-03 font-medium text-black transition-colors"
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
      <form ref={formRef} id="user-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          id={usernameId}
          label={t("users.username") || "用户名"}
          type="text"
          required
          autoFocus
          error={fieldErrors.username}
          value={formData.username}
          onChange={(e) => {
            setFieldErrors(({ username: _drop, ...rest }) => rest);
            setFormData({ ...formData, username: e.target.value });
          }}
          disabled={isEditing || createMutation.isPending || updateMutation.isPending}
          placeholder={t("users.username_placeholder") || "输入用户名"}
        />

        <TextField
          id={emailId}
          label={t("users.email") || "邮箱"}
          type="email"
          required
          error={fieldErrors.email}
          value={formData.email}
          onChange={(e) => {
            setFieldErrors(({ email: _drop, ...rest }) => rest);
            setFormData({ ...formData, email: e.target.value });
          }}
          disabled={createMutation.isPending || updateMutation.isPending}
          placeholder={t("users.email_placeholder") || "输入邮箱"}
        />

        {/* 编辑时的「(可选)」走 `description` 而不是塞进 `label` —— `Field` 把
            description 接进 `aria-describedby` 的链条里,而拼进 label 的话它会
            变成字段名字的一部分,读屏每次聚焦都念一遍。 */}
        <TextField
          id={passwordId}
          label={t("users.password") || "密码"}
          description={isEditing ? (t("users.optional") || "可选") : undefined}
          type="password"
          required={!isEditing}
          error={fieldErrors.password}
          value={formData.password}
          onChange={(e) => {
            setFieldErrors(({ password: _drop, ...rest }) => rest);
            setFormData({ ...formData, password: e.target.value });
          }}
          disabled={createMutation.isPending || updateMutation.isPending}
          placeholder={isEditing ? (t("users.password_edit_placeholder") || "留空则不修改") : (t("users.password_placeholder") || "输入密码")}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor={roleId} className="text-02 text-[hsl(var(--color-ink-subtle))]">{t("users.role") || "角色"}</label>
          <select
            id={roleId}
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value as CreateUserInput["role"] })}
            disabled={createMutation.isPending || updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-03 text-[hsl(var(--color-ink))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
          >
            <option value="ADMIN">{t("users.role_admin") || "管理员"}</option>
            <option value="JUDGE">{t("users.role_judge") || "审判者"}</option>
            <option value="GUARDIAN">{t("users.role_guardian") || "守护者"}</option>
            <option value="VIEWER">{t("users.role_viewer") || "查看者"}</option>
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <label htmlFor={firstNameId} className="text-02 text-[hsl(var(--color-ink-subtle))]">{t("users.first_name") || "名"}</label>
            <input
              id={firstNameId}
              type="text"
              value={formData.first_name}
              onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
              placeholder={t("users.first_name_placeholder") || "名"}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label htmlFor={lastNameId} className="text-02 text-[hsl(var(--color-ink-subtle))]">{t("users.last_name") || "姓"}</label>
            <input
              id={lastNameId}
              type="text"
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
              placeholder={t("users.last_name_placeholder") || "姓"}
            />
          </div>
        </div>
      </form>
    </BaseModal>
  );
}
