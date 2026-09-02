/**
 * Historical dates, as the backend's `HistoricalDateField` sends them.
 *
 * SPLIT OUT OF `frontend/lib/utils.ts`, which held these beside `cn()` — a
 * `tailwind-merge` wrapper carrying a forty-line note about the eight-step type
 * scale. Two unrelated things sharing a file because both were "utils": one is
 * a Tailwind class-name resolver that only means something in a browser, the
 * other is how this product writes down a date. `lib/api/souls.ts` and
 * `lib/api/ledger.ts` imported `HistoricalDate` from it, so the API contract
 * had a type-only dependency on the CSS layer. `cn()` stays in the frontend;
 * this comes here.
 */
export interface HistoricalDate {
  year: number;
  month: number | null;
  day: number | null;
}

/**
 * Format a HistoricalDate for display.
 * Shows year with BCE/CE suffix, month/day only when present.
 * @example
 * formatHistoricalDate({ year: -44, month: 3, day: 15 }) // "44 BCE · March 15"
 * formatHistoricalDate({ year: 1066, month: null, day: null }) // "1066 CE"
 */
export function formatHistoricalDate(date: HistoricalDate | null | undefined): string | null {
  if (!date) return null;

  const { year, month, day } = date;

  // Format year with BCE/CE suffix
  let yearStr: string;
  if (year <= 0) {
    // BCE: year -1 is "1 BCE", year -44 is "44 BCE"
    yearStr = `${Math.abs(year)} BCE`;
  } else {
    yearStr = `${year} CE`;
  }

  // Add month if present
  if (month !== null) {
    const monthName = new Date(2000, month - 1).toLocaleString("en", { month: "long" });
    if (day !== null) {
      return `${yearStr} · ${monthName} ${day}`;
    }
    return `${yearStr} · ${monthName}`;
  }

  // Just year
  return yearStr;
}
