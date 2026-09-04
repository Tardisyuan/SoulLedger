"use client";

import { useState, useEffect, useId, useRef } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { useSubmitErrorFocus } from "@/src/lib/submitErrorFocus";
import type { Permission } from "@soulledger/core/api";

export function PermissionFormModal({
  isOpen,
  onClose,
  onSubmit,
  isPending,
  error,
  title,
  initialData,
  existingCategories,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { codename: string; name: string; category: string }) => void;
  isPending: boolean;
  error: string | null;
  title: string;
  initialData?: Permission;
  /**
   * The real, current set of categories — pulled from live Permission data
   * by the caller (app/permissions/page.tsx already derives this for the
   * matrix), not a fixed list here. A hardcoded list previously shipped with
   * only 5 entries against 14 real categories, one of them "karma" — a
   * category that stopped existing when that app was renamed to "ledger".
   * Kept as suggestions via <datalist> rather than a closed <select>: the
   * first codename in a genuinely new category has to be able to name one
   * that doesn't exist yet.
   */
  existingCategories: string[];
}) {
  const { t } = useI18n();
  // Unique prefix so field/error ids never collide across multiple
  // PermissionFormModal instances mounted at once.
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

  const codenameId = `${formId}-codename`;
  const nameId = `${formId}-name`;
  const categoryId = `${formId}-category`;
  const categoryListId = `${formId}-category-list`;
  const errorId = `${formId}-error`;
  const [codename, setCodename] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState(existingCategories[0] ?? "");

  useEffect(() => {
    if (isOpen) {
      setCodename(initialData?.codename ?? "");
      setName(initialData?.name ?? "");
      setCategory(initialData?.category ?? existingCategories[0] ?? "");
    }
    // existingCategories intentionally excluded, and this is the deliberate
    // kind of omission the rule allows for rather than a dep someone forgot.
    // The caller passes `categories.map((c) => c.category)` inline
    // (app/permissions/page.tsx), so the prop is a **new array on every render
    // of that page** — and that page re-renders on each keystroke of its own
    // filter box. Adding it here would re-run this effect on renders where
    // nothing about the modal changed and reset `category` back to
    // `existingCategories[0]` under the operator's cursor. Pinned by
    // `src/__tests__/permissionFormCategoryStability.test.tsx`, which types a
    // new category name, re-renders the parent, and asserts the typed value is
    // still there.
    //
    // What would make this a real dependency: the caller memoising the array
    // (or passing `categories` itself and mapping here). Then the effect could
    // include it and would only re-run when the category set actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!codename.trim()) return;
    if (!name.trim()) return;
    if (!category.trim()) return;
    onSubmit({ codename: codename.trim(), name: name.trim(), category: category.trim() });
  }

  function handleClose() {
    setCodename("");
    setName("");
    setCategory(existingCategories[0] ?? "");
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
            disabled={isPending || !codename.trim() || !name.trim() || !category.trim()}
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
          <label htmlFor={codenameId} className="block text-02 text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.codename_label")}</label>
          <input
            id={codenameId}
            type="text"
            value={codename}
            onChange={(e) => setCodename(e.target.value)}
            placeholder={t("permissions.codename_placeholder")}
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink))] text-03 focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label htmlFor={nameId} className="block text-02 text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.name_label")}</label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("permissions.name_placeholder")}
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink))] text-03 focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label htmlFor={categoryId} className="block text-02 text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.category_label")}</label>
          <input
            id={categoryId}
            type="text"
            list={categoryListId}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t("permissions.category_placeholder")}
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink))] text-03 focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          />
          <datalist id={categoryListId}>
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <p className="mt-1 text-02 text-[hsl(var(--color-ink-subtle))]">
            {t("permissions.category_hint")}
          </p>
        </div>
      </form>
    </BaseModal>
  );
}
