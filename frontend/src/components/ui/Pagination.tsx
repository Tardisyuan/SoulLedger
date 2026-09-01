"use client";

import { useEffect, useState } from "react";

import { useI18n } from "@/src/contexts/I18nContext";

interface PaginationProps {
  page: number;
  totalPages: number;
  count: number;
  onPageChange: (page: number) => void;
  showInfo?: boolean;
}

/**
 * Prev/next was the whole control, and at 20 rows a page that is not enough.
 *
 * A tenant with a few thousand souls needs 150+ clicks to reach the tail, one
 * page at a time, with no way to say where it wants to be. First/last are two
 * buttons; the jump box is the one that actually changes the shape of the
 * task.
 *
 * WHY THE JUMP BOX IS NOT IN A FORM. Enter has to commit it, and the obvious
 * way to get that is to wrap it in a `<form>` — but this component is rendered
 * inside page bodies that already contain forms, and a nested form is not legal
 * HTML. So Enter is handled explicitly on the input instead, with
 * `preventDefault` so it cannot reach an enclosing form either. Same reason
 * every button here carries `type="button"`.
 *
 * WHY THE INPUT IS NOT CONTROLLED BY `page`. A controlled value fights the
 * operator mid-type: clearing the box to type "12" would immediately snap it
 * back to the current page. It syncs FROM `page` when the page changes
 * elsewhere, and is otherwise theirs.
 */
export function Pagination({ page, totalPages, count, onPageChange, showInfo = true }: PaginationProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(page));

  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  if (totalPages <= 1 && !showInfo) return null;

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(page));
      return;
    }
    // Clamped rather than rejected: "999" on a 7-page list means "the end",
    // and bouncing it back with an error would be pedantry about a number the
    // operator did not have to know.
    const next = Math.min(Math.max(1, parsed), Math.max(1, totalPages));
    setDraft(String(next));
    if (next !== page) onPageChange(next);
  };

  const stepButton =
    "px-3 py-1.5 text-03 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 disabled:cursor-not-allowed text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors";

  return (
    <div className="flex items-center justify-between mt-4 px-2">
      {showInfo && (
        <p className="text-02 text-[hsl(var(--color-ink-muted))]">
          {t("pagination.info", {
            page: String(page),
            total: String(totalPages),
            count: String(count),
          })}
        </p>
      )}
      <div className="flex items-center gap-2">
        {/* `type="button"` on every one. A <button> inside a <form> defaults to
            `submit`, and these sit in page bodies that do contain forms — a
            page turn would submit whatever form enclosed it. */}
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          aria-label={t("pagination.first")}
          className={stepButton}
        >
          ⇤
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className={stepButton}
        >
          ← {t("common.prev")}
        </button>

        {/* Mono + tabular-nums, like every other number in this app, so the
            box does not change width as the page count grows. */}
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          aria-label={t("pagination.jump")}
          className="w-14 px-2 py-1.5 text-03 font-mono tabular-nums text-center bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink))]"
        />

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className={stepButton}
        >
          {t("common.next")} →
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          aria-label={t("pagination.last")}
          className={stepButton}
        >
          ⇥
        </button>
      </div>
    </div>
  );
}
