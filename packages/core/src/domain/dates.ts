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
 * `egy` used to reuse the English names until Design batch 60 (2026-10-29) gave `Abed 1` … `Abed 12`.
 *
 * `messages/egy.json` carries no month names — it is an English base with the
 * Egyptian terminology substituted in, which is the same reason
 * `config/locale.ts` maps `egy` to `en` for `<html lang>` and `I18nContext`
 * maps it to `en` for `Intl`. Written as an entry here so that the day a real
 * civil-calendar month list (Thoth, Phaophi, …) is decided, there is one place
 * holding the decision instead of a `?? MONTH_NAMES_EN` nobody can find.
 */
const MONTH_NAMES: Record<Locale, readonly string[]> = {
  // 数字月名(`3月`)而不是汉字月名(`三月`),而这是一个被问过并保留的决定,
  // 不是没想过。语言包里**根本没有月份名** —— 45 个键里 41 个不在任何包里,
  // 见 `b3a3e7c` —— 所以这里没有文案决定可依,只能从别处的惯例推。
  //
  // 依的是应用自己的惯例:`I18nContext` 的 formatDate 走 `Intl`,而 `Intl` 对
  // zh-Hans 出的是 `1970年1月1日`。历史日期若写成 `三月十五日`,同一个屏幕上
  // 就会有两种中文日期风格,而分歧的理由(一个是历史日期、一个是系统时间戳)
  // 对读者不可见。
  //
  // 想改成汉字的话,`config/civilizationSigil.ts` 已经有 `toHanNumeral`,
  // 改动是这一行加 MONTH_DAY 的 zh-Hans 分支;但那时应当连 formatDate 一起改,
  // 否则只是把不一致挪了个位置。
  "zh-Hans": ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
  en: MONTH_NAMES_EN,
  // Design 第六十批(2026-10-29):`Abed` + 数字,同中文「3月」的结构。不用埃及历月名(Thoth 约从公历 9 月中起),
  // 免得读者以为日期换了历法 —— 日期本身仍是公历。
  egy: ["Abed 1", "Abed 2", "Abed 3", "Abed 4", "Abed 5", "Abed 6", "Abed 7", "Abed 8", "Abed 9", "Abed 10", "Abed 11", "Abed 12"],
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
  egy: (monthName, day) => `${monthName} Hru ${day}`,
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
 * formatHistoricalDate({ year: -44, month: 3, day: 15 }) // "前44年 · 3月15日"
 * formatHistoricalDate({ year: 1066, month: null, day: null }) // "1066年"
 */
export function formatHistoricalDate(
  date: HistoricalDate | null | undefined,
  locale: Locale = DEFAULT_LOCALE
): string | null {
  if (!date) return null;

  const { year, month, day } = date;

  // Format year with BCE/CE suffix
  let yearStr: string;
  if (locale === "zh-Hans") {
    // 用户 2026-10-29:中文公元写「2026年」、公元前写「前44年」,不再带 CE / BCE(英文不动)。
    yearStr = year <= 0 ? `前${Math.abs(year)}年` : `${year}年`;
  } else if (locale === "egy") {
    // Design 第六十批:公元不加词(同中文);公元前写 `Tepy Er Kristos`(在基督之前,同受洗那组「生于基督之前」)。
    // 年份前不加 `Renpet`:`Renpet 1066` 在词表里读作「1066 年的时长」。
    yearStr = year <= 0 ? `${Math.abs(year)} Tepy Er Kristos` : `${year}`;
  } else if (year <= 0) {
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

/**
 * An ISO calendar day (`YYYY-MM-DD`, the shape `Judgment.held_until` comes in) in the same words as
 * `formatHistoricalDate` — 「2027年 · 12月1日」, not the raw string. Anything else comes back as given.
 */
export function formatIsoDay(iso: string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? (formatHistoricalDate({ year: +m[1], month: +m[2], day: +m[3] }, locale) ?? "") : (iso ?? "");
}

/**
 * A server timestamp as both apps print it in mono: `YYYY-MM-DD HH:mm`, in the device's own time zone.
 * Null for nothing or an unparseable value. One copy (cq-apps 2026-10-30 #3): it was the soul app's
 * `formatStamp` and the officer app's `formatWhen`, line for line.
 */
export function formatStamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Local calendar date as `YYYY-MM-DD` — the shape `Judgment.held_until` comes in. */
function localIsoDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Held in 枉死城 right now (第五十一批): the judgment is untimely and its fated date is still ahead. The same
 * rule as the server's claim guard (`held_until > localdate()`), so a held row never offers a claim the server
 * would refuse. Here rather than beside `judgmentApi` so screens whose tests stub that module keep the real rule.
 */
export function isHeldUntilFatedDate(j: { held_until?: string | null }, now: Date = new Date()): boolean {
  return !!j.held_until && j.held_until > localIsoDate(now);
}

/**
 * 埃及的案子到不了两真之殿(review P2-9,docs/01 §4.2):无名者不入冥界、葬仪不当走不完旅程。永远候着,
 * 服务端拒绝认领与结案(409 `duat_unfinished`),所以界面不放「认领」。
 */
export function isDuatBarred(j: { duat_stage?: string | null }): boolean {
  return j.duat_stage === "NAMELESS" || j.duat_stage === "IMPROPER_BURIAL";
}
