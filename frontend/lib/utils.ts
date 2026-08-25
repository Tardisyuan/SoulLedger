import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge, taught about the eight-step type scale.
 *
 * WHY THIS IS NOT THE STOCK `twMerge`. Stage 11 A2 added `text-01` … `text-08`
 * to `tailwind.config.js`'s `fontSize`. tailwind-merge does not read the
 * Tailwind config — it ships a hardcoded table of class groups — and its
 * `font-size` group only recognises the t-shirt names (`text-xs` … `text-9xl`)
 * plus arbitrary lengths. `text-02` matches none of those, so it falls through
 * to the group that accepts anything after `text-`: **text-COLOR**.
 *
 * The consequence is that a font size and a text colour in the same `cn()` call
 * were treated as the same property, and the later one deleted the earlier one:
 *
 *   cn("bg-accent text-black border-accent", "px-2 py-1 text-02")
 *     → "bg-accent border-accent px-2 py-1 text-02"      // text-black gone
 *   cn("text-01 uppercase text-[hsl(var(--color-ink-subtle))]")
 *     → "uppercase text-[hsl(var(--color-ink-subtle))]"  // text-01 gone
 *
 * Note the second line: it happens inside a single string, so "keep them in
 * separate arguments" is not a workaround. Nor is reordering — that only
 * changes which of the two is destroyed. Nor is spelling the colour
 * arbitrarily (`text-[#000]`), which lands in the same group.
 *
 * This is the worst available failure mode. There is no error, no type error,
 * no lint finding and no failing build; a component simply renders one
 * declaration short. Every component built on the new scale is exposed —
 * `src/components/ui/Button.tsx` lost the `text-black` that its whole contrast
 * argument rests on, which is how this was found.
 *
 * The `clsx` layer stays. `twMerge` accepts strings and arrays but not clsx's
 * object form (`{ active: true }`), and call sites use it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Registering these as font sizes does two things: it stops them
      // colliding with text colours, and it makes them collide with each
      // other, so `cn("text-02", "text-05")` still resolves to `text-05`.
      "font-size": [{ text: ["01", "02", "03", "04", "05", "06", "07", "08"] }],
    },
  },
})

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
