"use client";

import { useI18n } from "@/src/contexts/I18nContext";

interface PaginationProps {
  page: number;
  totalPages: number;
  count: number;
  onPageChange: (page: number) => void;
  showInfo?: boolean;
}

export function Pagination({ page, totalPages, count, onPageChange, showInfo = true }: PaginationProps) {
  const { t } = useI18n();

  if (totalPages <= 1 && !showInfo) return null;

  return (
    <div className="flex items-center justify-between mt-4 px-2">
      {showInfo && (
        <p className="text-sm text-[hsl(var(--color-ink-muted))]">
          {t("pagination.info", {
            page: String(page),
            total: String(totalPages),
            count: String(count),
          })}
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="px-3 py-1.5 text-sm bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 disabled:cursor-not-allowed text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
        >
          ← {t("common.prev")}
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-sm bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 disabled:cursor-not-allowed text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
        >
          {t("common.next")} →
        </button>
      </div>
    </div>
  );
}
