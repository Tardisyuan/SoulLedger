"use client";

import { useState, useId, useRef } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";
import { useSubmitErrorFocus } from "@/src/lib/submitErrorFocus";
import type { Role } from "@soulledger/core/api";

interface RoleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; display_name: string }) => void;
  isPending: boolean;
  error: string | null;
  title: string;
  initialData?: Role;
}

/**
 * Rendered only while open, keyed by the role: the form starts from `initialData` on every open (a `key`, not an
 * effect that copies props into state; audit 2026-11-26 §2.5).
 */
export function RoleFormModal(props: RoleFormModalProps) {
  return props.isOpen ? <RoleForm key={props.initialData?.id ?? "new"} {...props} /> : null;
}

function RoleForm({ isOpen, onClose, onSubmit, isPending, error, title, initialData }: RoleFormModalProps) {
  const { t } = useI18n();
  // Unique prefix so field/error ids never collide across multiple
  // RoleFormModal instances mounted at once.
  const formId = useId();
  /**
   * 提交被拒之后焦点去哪。
   *
   * 这一条是**表单级**的错误("码名已被占用"这类),不是逐字段的。原先它被挂在
   * 每一个 `<input>` 的 `aria-invalid` 上 —— 于是一次码名冲突会同时告诉读屏
   * 用户 name 和 category 也是坏的,而三条指向的还是同一句泛用文案。那些属性
   * 已经撤掉:这条错误只由上面那个 `role="alert"` 说一次。
   *
   * 焦点因此落在那句消息上(`tabIndex={-1}`),而不是留在提交按钮上 ——
   * `BaseModal` 的正文是可滚动的,消息可能就在焦点位置的视野之外。
   */
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useSubmitErrorFocus(!!error, formRef, errorRef);

  const nameId = `${formId}-name`;
  const displayNameId = `${formId}-display-name`;
  const errorId = `${formId}-error`;
  const [name, setName] = useState(initialData?.name ?? "");
  const [displayName, setDisplayName] = useState(initialData?.display_name ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!displayName.trim()) return;
    onSubmit({ name: name.trim().toUpperCase(), display_name: displayName.trim() });
  }


  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          {/* `loading` rather than only `disabled` — same reasoning as the twin
              in `PermissionFormModal`: the label already changed while the
              request was in flight, so the state was known; it just carried no
              spinner and no `aria-busy`. `Button` disables on `loading`, hence
              no `isPending ||` in `disabled`. */}
          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            loading={isPending}
            disabled={!name.trim() || !displayName.trim()}
          >
            {isPending ? t("permissions.submitting") : t("permissions.submit")}
          </Button>
        </div>
      }
    >
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        {/* 这条**表单级**消息仍然手写,不走 `Field` 的 `error` —— 理由在上面
            `useSubmitErrorFocus` 那段:它不属于任何一个字段,交给 `Field` 就等于
            把 `aria-invalid` 重新挂回每个 input 上,正是先前撤掉的那件事。
            换掉的只有颜色:`red-400 text` 是 Tailwind 原生调色板,浅色模式下拿到
            的是暗色那一档;`--color-status-error` 明暗各测过一套。 */}
        {error && <p ref={errorRef} tabIndex={-1} id={errorId} role="alert" className="text-[oklch(var(--color-danger))] text-sm"><span aria-hidden="true">! </span>{error}</p>}
        {/* A built-in role's name is fixed: the backend compares ADMIN /
            MODERATOR / JUDGE / GUARDIAN / VIEWER by literal and answers 400 to
            a rename, so the field says so up front instead of letting the
            operator type a name that will be refused. `readOnly`, not
            `disabled`: the value still submits (the PUT sends `name` back
            unchanged) and stays readable to assistive tech. */}
        <TextField
          id={nameId}
          label={t("permissions.role_name_label")}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("permissions.role_name_placeholder")}
          readOnly={initialData?.is_builtin === true}
          description={initialData?.is_builtin ? t("permissions.role_name_builtin_hint") : undefined}
        />
        {/* `description` above: the TextField wires `aria-describedby` to it. */}
        <TextField
          id={displayNameId}
          label={t("permissions.display_name_label")}
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t("permissions.display_name_placeholder")}
        />
      </form>
    </BaseModal>
  );
}
