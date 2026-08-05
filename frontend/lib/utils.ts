import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Historical date from backend HistoricalDateField.
 * Nullable components allow for ancient dates with unknown month/day.
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
