"use client";

import { useI18n } from "@/src/contexts/I18nContext";

interface ActiveFilter {
  key: string;
  label: string;
  value: string | number;
}

interface ActiveFiltersProps {
  filters: ActiveFilter[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}

/**
 * ActiveFilters shows currently active filters as removable chips.
 */
export function ActiveFilters({ filters, onRemove, onClearAll }: ActiveFiltersProps) {
  const { t } = useI18n();

  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[hsl(var(--color-ink-muted))]">
        {t("search.active_filters") || "Filters:"}
      </span>
      {filters.map((filter) => (
        <span
          key={filter.key}
          className="inline-flex items-center gap-1 px-2 py-0.5 bg-[hsl(var(--color-accent))]/10 text-[hsl(var(--color-accent))] rounded text-xs"
        >
          {filter.label}: {filter.value}
          <button
            onClick={() => onRemove(filter.key)}
            className="ml-1 hover:text-[hsl(var(--color-ink))]"
            aria-label={`${t("search.remove") || "Remove"} ${filter.label}`}
          >
            ×
          </button>
        </span>
      ))}
      {filters.length > 1 && (
        <button
          onClick={onClearAll}
          className="text-xs text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] underline"
        >
          {t("search.clear_all") || "Clear All"}
        </button>
      )}
    </div>
  );
}
