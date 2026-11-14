/**
 * The officer's small habits kept on this phone (convenience audit D8): 案卷台's source chip, and the last three
 * reasons this officer wrote when rejecting. Owner-scoped like the outbox (owner.ts): another officer signing in on
 * the same phone reads nothing of these, `dropUnowned` removes them at that sign-in, and sign-out clears them.
 */
import { platform } from "@soulledger/core/platform";

import { readOwned, writeOwned } from "./owner";

export const QUEUE_SOURCE_KEY = "officer_queue_source";
export const REJECT_REASONS_KEY = "officer_reject_reasons";
export const MEMORY_KEYS = [QUEUE_SOURCE_KEY, REJECT_REASONS_KEY] as const;
export const RECENT_REASONS = 3;
/** The longest reason box (rules.ts `reasonMaxLength`); anything longer was not typed here. */
const REASON_MAX = 2000;

/** The kept source when it is still one of `allowed`; else null (the caller starts at 全部). */
export function readQueueSource<K extends string>(allowed: readonly K[]): K | null {
  const source = readOwned<{ source?: unknown }>(QUEUE_SOURCE_KEY)?.source;
  return typeof source === "string" && (allowed as readonly string[]).includes(source) ? (source as K) : null;
}

export function writeQueueSource(source: string): void {
  writeOwned(QUEUE_SOURCE_KEY, { source });
}

/** Newest first, at most three, each a non-blank string. */
export function recentReasons(): string[] {
  const reasons = readOwned<{ reasons?: unknown }>(REJECT_REASONS_KEY)?.reasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.filter((r): r is string => typeof r === "string" && r.trim() !== "" && r.length <= REASON_MAX).slice(0, RECENT_REASONS);
}

/** After a reject the server took: this reason goes first; the same words are not kept twice. */
export function rememberReason(reason: string): void {
  const text = reason.trim();
  if (!text || text.length > REASON_MAX) return;
  writeOwned(REJECT_REASONS_KEY, { reasons: [text, ...recentReasons().filter((r) => r !== text)].slice(0, RECENT_REASONS) });
}

export function clearMemory(): void {
  for (const key of MEMORY_KEYS) platform().persistent.remove(key);
}
