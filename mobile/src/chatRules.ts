/**
 * The chat's display helpers: how a typed soul code is read, and the times on the list and the bubbles.
 * Which state a conversation is in (and the list's sections) is `@soulledger/core/domain/soulChat`.
 */
import { SOUL_CODE_LENGTH } from "@soulledger/core/domain/soulCode";
import { hhmm, localDateString, mmdd } from "@soulledger/core/domain/dates";

/**
 * A soul code as typed → as the server compares it: trimmed, upper-cased —
 * `normalize_soul_code` in backend/apps/soul_accounts/services.py, which login
 * shares. Nothing looser: a client that also dropped dashes would find codes
 * the server does not ("登得进却查不到" the other way round).
 */
export const normalizeCode = (raw: string) => raw.trim().toUpperCase();
/** `SOUL_CODE_LENGTH` there. Shorter or longer is refused here with its own copy, before asking. */
export const isCompleteCode = (code: string) => code.length === SOUL_CODE_LENGTH;

/** List time: today `HH:mm`, this year `MM-DD`, else `YYYY-MM-DD`. Device time. */
export function listStamp(ts: number, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return hhmm(d);
  if (d.getFullYear() === today.getFullYear()) return mmdd(d);
  return localDateString(d);
}

/** Bubble time: today `HH:mm`, else `MM-DD HH:mm`. */
export function bubbleStamp(ts: number, now: number): string {
  const d = new Date(ts);
  const clock = hhmm(d);
  return d.toDateString() === new Date(now).toDateString() ? clock : `${mmdd(d)} ${clock}`;
}

/** The day divider between bubbles: `YYYY-MM-DD`. */
export function dayOf(ts: number): string {
  const d = new Date(ts);
  return localDateString(d);
}
