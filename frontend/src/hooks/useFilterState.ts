"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export interface FilterDefaults {
  [key: string]: string | number | undefined;
}

export interface FilterState {
  [key: string]: string | number | undefined;
}

/**
 * Hook that syncs filter state with URL search params.
 *
 * Features:
 * - Single source of truth: URL search params
 * - Page reset on filter change
 * - Clean URLs (empty values omitted)
 * - Debounced search handled at component level
 */
export function useFilterState(defaults: FilterDefaults = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read current filters from URL
  const filters: FilterState = useMemo(() => {
    const result: FilterState = {};
    for (const [key, defaultValue] of Object.entries(defaults)) {
      const urlValue = searchParams.get(key);
      if (urlValue !== null && urlValue !== "") {
        // Try to parse as number if default is number
        result[key] = typeof defaultValue === "number" ? Number(urlValue) : urlValue;
      } else {
        result[key] = defaultValue;
      }
    }
    return result;
  }, [searchParams, defaults]);

  // Set a filter value (updates URL)
  const setFilter = useCallback(
    (key: string, value: string | number | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === undefined || value === "" || value === null) {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
      // Reset page to 1 on any filter change
      params.delete("page");
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  // Reset all filters to defaults
  const resetFilters = useCallback(() => {
    router.push("?", { scroll: false });
  }, [router]);

  // Check if any non-default filters are active
  const hasActiveFilters = useMemo(() => {
    for (const [key, defaultValue] of Object.entries(defaults)) {
      const urlValue = searchParams.get(key);
      if (urlValue !== null && urlValue !== "" && urlValue !== String(defaultValue)) {
        return true;
      }
    }
    return false;
  }, [searchParams, defaults]);

  return {
    filters,
    setFilter,
    resetFilters,
    hasActiveFilters,
    searchParams,
  };
}
