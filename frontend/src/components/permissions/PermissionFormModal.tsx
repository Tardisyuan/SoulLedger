"use client";

import { useState, useEffect, useId } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import type { Permission } from "@/lib/api";

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
    // existingCategories intentionally excluded: it can change identity on
    // every render of the parent (new array from useMemo's fallback []), and
    // re-running this on that change would stomp whatever the operator is
    // mid-typing into the category field.
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
            className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-[hsl(var(--color-ink-muted))] hover:bg-surface-2 disabled:opacity-50 text-03 transition-colors"
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
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p id={errorId} role="alert" className="text-red-400 text-03">{error}</p>}
        <div>
          <label htmlFor={codenameId} className="block text-02 text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.codename_label")}</label>
          <input
            id={codenameId}
            type="text"
            value={codename}
            onChange={(e) => setCodename(e.target.value)}
            placeholder={t("permissions.codename_placeholder")}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline text-[hsl(var(--color-ink))] text-03 focus:outline-none focus:border-[hsl(var(--color-accent))]"
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
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline text-[hsl(var(--color-ink))] text-03 focus:outline-none focus:border-[hsl(var(--color-accent))]"
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
            className="w-full px-3 py-2 bg-surface-2 border border-hairline text-[hsl(var(--color-ink))] text-03 focus:outline-none focus:border-[hsl(var(--color-accent))]"
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
