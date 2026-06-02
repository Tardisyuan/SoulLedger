"use client";

import { useI18n } from "@/src/contexts/I18nContext";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  type: "select" | "text" | "number" | "date" | "boolean";
  options?: FilterOption[];
  placeholder?: string;
}

interface FilterPanelProps {
  filters: FilterConfig[];
  values: Record<string, string | number | undefined>;
  onChange: (key: string, value: string | number | undefined) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
}

/**
 * FilterPanel renders filter controls based on a schema definition.
 * Supports: select, text, number, date, boolean types.
 */
export function FilterPanel({
  filters,
  values,
  onChange,
  onReset,
  hasActiveFilters,
}: FilterPanelProps) {
  const { t } = useI18n();

  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-end gap-3">
      {filters.map((filter) => (
        <div key={filter.key} className="flex flex-col gap-1">
          <label className="text-xs text-[hsl(var(--color-ink-muted))] font-medium">
            {filter.label}
          </label>
          {filter.type === "select" && filter.options && (
            <select
              value={String(values[filter.key] || "")}
              onChange={(e) => onChange(filter.key, e.target.value || undefined)}
              className="px-3 py-1.5 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            >
              <option value="">{filter.placeholder || t("filter.all") || "All"}</option>
              {filter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
          {filter.type === "text" && (
            <input
              type="text"
              value={String(values[filter.key] || "")}
              onChange={(e) => onChange(filter.key, e.target.value || undefined)}
              placeholder={filter.placeholder}
              className="px-3 py-1.5 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          )}
          {filter.type === "number" && (
            <input
              type="number"
              value={String(values[filter.key] || "")}
              onChange={(e) => onChange(filter.key, e.target.value ? Number(e.target.value) : undefined)}
              placeholder={filter.placeholder}
              className="px-3 py-1.5 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))] w-24"
            />
          )}
          {filter.type === "date" && (
            <input
              type="date"
              value={String(values[filter.key] || "")}
              onChange={(e) => onChange(filter.key, e.target.value || undefined)}
              className="px-3 py-1.5 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          )}
          {filter.type === "boolean" && (
            <select
              value={String(values[filter.key] ?? "")}
              onChange={(e) => {
                const val = e.target.value;
                onChange(filter.key, val === "" ? undefined : val);
              }}
              className="px-3 py-1.5 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            >
              <option value="">{filter.placeholder || t("filter.all") || "All"}</option>
              <option value="true">{t("filter.yes") || "Yes"}</option>
              <option value="false">{t("filter.no") || "No"}</option>
            </select>
          )}
        </div>
      ))}
      {hasActiveFilters && (
        <button
          onClick={onReset}
          className="px-3 py-1.5 text-sm text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] border border-[hsl(var(--color-hairline))] rounded transition-colors"
        >
          {t("filter.clear_all") || "Clear All"}
        </button>
      )}
    </div>
  );
}
