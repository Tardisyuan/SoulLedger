"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/src/contexts/I18nContext";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
}

/**
 * SearchBar with debounced input.
 * Calls onChange after debounceMs (default 300ms) of inactivity.
 */
export function SearchBar({
  value,
  onChange,
  placeholder,
  debounceMs = 300,
}: SearchBarProps) {
  const { t } = useI18n();
  const [localValue, setLocalValue] = useState(value);

  // Sync local state when external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounced onChange
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [localValue, debounceMs, onChange, value]);

  const handleClear = useCallback(() => {
    setLocalValue("");
    onChange("");
  }, [onChange]);

  return (
    <div className="relative" role="search">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg className="h-4 w-4 text-[hsl(var(--color-ink-muted))]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder || t("search.placeholder") || "Search..."}
        className="w-full pl-10 pr-8 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-muted))] focus:outline-none focus:border-[hsl(var(--color-accent))] transition-colors"
        aria-label={t("search.aria_label") || "Search"}
      />
      {localValue && (
        <button
          onClick={handleClear}
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
          aria-label={t("search.clear") || "Clear search"}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
