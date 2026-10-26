/**
 * Term arithmetic shared by web and the soul app: how far through a term a soul is, and how
 * many days a countdown has left. It existed twice (web `dispositionTerm.ts`, mobile `rules.ts`
 * / `voiceCache.ts` / `chatRules.ts`) with different answers for the same input: an inverted
 * term was a full bar on one side and no bar on the other, and `daysLeft` was 0, 1 or NaN
 * depending on which copy a screen imported.
 */
import type { HistoricalDate } from "./dates";

const DAY_MS = 86_400_000;

/**
 * A historical date as epoch milliseconds (UTC). The backend writes years with no year 0
 * (-1 = 1 BCE, 1 = 1 CE; apps/souls/dates.py); JS dates count astronomically (0 = 1 BCE), so a
 * BCE year is shifted by one first. Missing month / day default to January / the 1st.
 */
export function historicalDateMs(date: HistoricalDate): number {
  const d = new Date(0);
  d.setUTCFullYear(date.year < 0 ? date.year + 1 : date.year, (date.month ?? 1) - 1, date.day ?? 1);
  return d.getTime();
}

/** Whole days until `until` (ISO string or epoch ms), rounded up like the server's. 0 for none, past or unparseable; `min` raises the floor (a mute still on screen has at least 1 day). */
export function daysLeft(until: string | number | null | undefined, now: number = Date.now(), min = 0): number {
  if (until === null || until === undefined || until === "") return 0;
  const ms = (typeof until === "number" ? until : Date.parse(until)) - now;
  return Number.isFinite(ms) ? Math.max(min, Math.ceil(ms / DAY_MS)) : 0;
}

/**
 * The share of a term already served, 0–1. Null when there is nothing to measure: either end
 * unknown, or an end that is not after the start. Callers decide how to draw null (the soul
 * app hides the bar; the disposition page draws it full).
 */
export function termFraction(fromMs: number, toMs: number, now: number): number | null {
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) return null;
  return Math.min(1, Math.max(0, (now - fromMs) / (toMs - fromMs)));
}
