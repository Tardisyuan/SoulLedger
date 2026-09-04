"use client";

import { useState, useEffect, useId, useRef } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { useSubmitErrorFocus } from "@/src/lib/submitErrorFocus";
import type { Role } from "@soulledger/core/api";

export function RoleFormModal({
  isOpen,
  onClose,
  onSubmit,
  isPending,
  error,
  title,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; display_name: string }) => void;
  isPending: boolean;
  error: string | null;
  title: string;
  initialData?: Role;
}) {
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
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (isOpen) {
      setName(initialData?.name ?? "");
      setDisplayName(initialData?.display_name ?? "");
    }
  }, [isOpen, initialData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!displayName.trim()) return;
    onSubmit({ name: name.trim().toUpperCase(), display_name: displayName.trim() });
  }

  function handleClose() {
    setName("");
    setDisplayName("");
    onClose();
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 text-03 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !name.trim() || !displayName.trim()}
            className="flex-1 px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] disabled:opacity-50 text-black text-03 font-medium transition-colors"
          >
            {isPending ? t("permissions.submitting") : t("permissions.submit")}
          </button>
        </div>
      }
    >
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        {error && <p ref={errorRef} tabIndex={-1} id={errorId} role="alert" className="text-red-400 text-03">{error}</p>}
        <div>
          <label htmlFor={nameId} className="block text-02 text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.role_name_label")}</label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("permissions.role_name_placeholder")}
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink))] text-03 focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label htmlFor={displayNameId} className="block text-02 text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.display_name_label")}</label>
          <input
            id={displayNameId}
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("permissions.display_name_placeholder")}
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink))] text-03 focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          />
        </div>
      </form>
    </BaseModal>
  );
}
