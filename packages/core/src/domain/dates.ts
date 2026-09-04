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
import { DEFAULT_LOCALE, type Locale } from "../config/locale";

export interface HistoricalDate {
  year: number;
  month: number | null;
  day: number | null;
}

/**
 * Month names, written out per locale instead of asked of `Intl`.
 *
 * THE TWO DEFECTS THIS TABLE REPLACES. The line was
 * `new Date(2000, month - 1).toLocaleString("en", { month: "long" })`.
 *
 *   1. The locale was the literal `"en"`, in a package whose `DEFAULT_LOCALE`
 *      is `zh-Hans` and which ships three bundles. A Chinese-locale user read
 *      `1066 CE · March 15`. Nothing asserted the month name — that string was
 *      unexamined, not pinned.
 *   2. `toLocaleString` is only required to honour the options bag where the
 *      runtime has ICU data. On a React Native Android build without full ICU
 *      it ignores `{ month: "long" }` and returns the whole date, so the same
 *      line renders `1066 CE · Wed Mar 01 2000 15`. This package is consumed by
 *      React Native (see the `lib` note in tsconfig.json), so that is a real
 *      target, not a hypothetical one.
 *
 * A table has neither failure mode: twelve strings per locale, no runtime data
 * to be missing, and adding a fourth locale to `Locale` makes this a type error
 * rather than a silent fallback.
 */
const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * `egy` reuses the English names, spelled as an alias rather than a fallback.
 *
 * `messages/egy.json` carries no month names — it is an English base with the
 * Egyptian terminology substituted in, which is the same reason
 * `config/locale.ts` maps `egy` to `en` for `<html lang>` and `I18nContext`
 * maps it to `en` for `Intl`. Written as an entry here so that the day a real
 * civil-calendar month list (Thoth, Phaophi, …) is decided, there is one place
 * holding the decision instead of a `?? MONTH_NAMES_EN` nobody can find.
 */
const MONTH_NAMES: Record<Locale, readonly string[]> = {
  "zh-Hans": ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
  en: MONTH_NAMES_EN,
  egy: MONTH_NAMES_EN,
};

/**
 * How a month and a day join, per locale. Not a shared `${month} ${day}`:
 * `3月 15` is not how a date is written in Chinese, and half-localising the
 * month while leaving the English spacing would trade one wrong string for
 * another.
 */
const MONTH_DAY: Record<Locale, (monthName: string, day: number) => string> = {
  "zh-Hans": (monthName, day) => `${monthName}${day}日`,
  en: (monthName, day) => `${monthName} ${day}`,
  egy: (monthName, day) => `${monthName} ${day}`,
};

/**
 * Format a HistoricalDate for display.
 * Shows year with BCE/CE suffix, month/day only when present.
 *
 * `locale` defaults to `DEFAULT_LOCALE`, not to English: a call site that
 * passes nothing gets the package's own default, which is the whole point of
 * the argument existing. `packages/core` cannot read a React context, so the
 * locale has to arrive from the caller — every production call site is inside
 * a component with `useI18n()` in scope and passes the real one.
 *
 * @example
 * formatHistoricalDate({ year: -44, month: 3, day: 15 }, "en") // "44 BCE · March 15"
 * formatHistoricalDate({ year: -44, month: 3, day: 15 }) // "44 BCE · 3月15日"
 * formatHistoricalDate({ year: 1066, month: null, day: null }) // "1066 CE"
 */
export function formatHistoricalDate(
  date: HistoricalDate | null | undefined,
  locale: Locale = DEFAULT_LOCALE
): string | null {
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
    // A month outside 1-12 is a malformed payload, not a date: fall back to the
    // year alone rather than printing `undefined`. The old `new Date(2000, 12)`
    // silently rolled over into the next January.
    const monthName = MONTH_NAMES[locale][month - 1];
    if (monthName === undefined) return yearStr;
    if (day !== null) {
      return `${yearStr} · ${MONTH_DAY[locale](monthName, day)}`;
    }
    return `${yearStr} · ${monthName}`;
  }

  // Just year
  return yearStr;
}
