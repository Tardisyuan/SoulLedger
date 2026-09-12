"use client";

import { useState, useEffect, useId, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usersApi, permApi, type User, type CreateUserInput, type UpdateUserInput } from "@soulledger/core/api";
import { permissionKeys, userKeys } from "@soulledger/core/query_keys";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";
import { showToast } from "@/src/components/ui/Toast";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
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

  /**
   * The role list comes from the role table, not from a restated enum.
   *
   * This select used to hard-code four options — and was missing MODERATOR,
   * the fourth copy of that omission this repo has recorded. Since 2026-09-12
   * `User.role` is validated against `perm.Role` (a role created on the
   * permissions screen can be held), so any fixed list here is wrong the
   * moment an admin creates one. `display_name` is server data, not UI copy.
   *
   * While the list is loading (or if it fails) the current value is kept as
   * the only option so the form never shows a blank select and a save never
   * silently changes the role.
   */
  const rolesQuery = useQuery({
    queryKey: permissionKeys.roles,
    queryFn: async () => (await permApi.roles.list()).data,
    enabled: isOpen,
  });
  const roleOptions =
    rolesQuery.data && rolesQuery.data.length > 0
      ? rolesQuery.data.map((r) => ({ value: r.name, label: r.display_name || r.name }))
      : [{ value: formData.role ?? "VIEWER", label: formData.role ?? "VIEWER" }];

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

  /**
   * 保存键此前是 `bg-amber-500` —— 和 `SoulEditModal` 里那一个,是同一处缺陷的
   * 两个副本。
   *
   * Tailwind 的 `amber-500` 是 `#f59e0b` = `hsl(38 92% 50%)`,而
   * `app/globals.css:322` 写的 `--color-accent` 恰好也是 `38 92% 50%` ——
   * **今天逐字节相同**,所以截图、对比度检查、人眼都看不出问题。
   *
   * 使它成为缺陷的是 `app/globals.css:334`:`--color-accent` 是**用户可在运行时
   * 配置**的。操作员一改强调色,全站主按钮跟着走,而这两个保存键留在琥珀色上 ——
   * 两个模态框的同一个动作,两种颜色,而没有任何东西会报红:调色板字面量追不上
   * token,而一个今天相等的值,没有任何断言能钉住它明天不相等。
   *
   * 换成 `Button variant="primary"`,顺带拿到手搓 `<svg className="animate-spin">`
   * 从来没有的 `aria-busy`、以及 190 个手搓按钮里 0 个有的 `active:` 反馈。
   */
  const footer = (
    <div className="flex gap-3">
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        disabled={createMutation.isPending || updateMutation.isPending}
        className="flex-1"
      >
        {t("common.cancel") || "取消"}
      </Button>
      <Button
        type="submit"
        form="user-form"
        variant="primary"
        loading={createMutation.isPending || updateMutation.isPending}
        className="flex-1"
      >
        {createMutation.isPending || updateMutation.isPending
          ? (t("common.submitting") || "提交中...")
          : isEditing
            ? (t("common.save") || "保存")
            : (t("common.create") || "创建")}
      </Button>
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

        {/* 三个字段先前搬到了 `TextField`,另外三个没有 —— 于是同一张表单里
            两种标签写法(`text-01 uppercase` 与 `text-02`)、两套 focus 语义
            (`focus-visible:` 与 `focus:`)并排站着。补齐的是剩下三个,不是
            新的决定。`SelectField` 把四个 `<option>` 换成一个数组;`className`
            落在 `Field` 的外壳上,所以 `flex-1` 仍旧是那两栏各占一半。 */}
        <SelectField
          id={roleId}
          label={t("users.role") || "角色"}
          value={formData.role}
          onChange={(e) => setFormData({ ...formData, role: e.target.value })}
          disabled={createMutation.isPending || updateMutation.isPending || rolesQuery.isPending}
          options={roleOptions}
        />

        <div className="flex gap-3">
          <TextField
            id={firstNameId}
            className="flex-1"
            label={t("users.first_name") || "名"}
            type="text"
            value={formData.first_name}
            onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
            disabled={createMutation.isPending || updateMutation.isPending}
            placeholder={t("users.first_name_placeholder") || "名"}
          />
          <TextField
            id={lastNameId}
            className="flex-1"
            label={t("users.last_name") || "姓"}
            type="text"
            value={formData.last_name}
            onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
            disabled={createMutation.isPending || updateMutation.isPending}
            placeholder={t("users.last_name_placeholder") || "姓"}
          />
        </div>
      </form>
    </BaseModal>
  );
}
