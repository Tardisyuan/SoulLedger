/**
 * 查询's 「最近打开」 (convenience audit 2026-11-15 D2): the last RECENT_KEEP cases and souls the officer opened,
 * newest first, shown under an empty search box. Stored as `{ owner, items }` (owner.ts), so another officer on the
 * phone reads nothing; `clearReadCache()` removes it on sign-out and when the server ends the session (it is a trace of
 * what was read, like the read cache).
 */
import { platform } from "@soulledger/core/platform";

import { readOwned, writeOwned } from "./owner";

export const RECENT_KEY = "officer_recent_opened";
export const RECENT_KEEP = 10;

export interface RecentOpened {
  type: "judgment" | "soul";
  id: string;
  /** A case's number, a soul's name. */
  title: string;
  /** A case's soul name. */
  line?: string;
}

export function readRecent(): RecentOpened[] {
  const items = readOwned<{ items?: unknown }>(RECENT_KEY)?.items;
  return Array.isArray(items) ? (items as RecentOpened[]) : [];
}

export function noteOpened(entry: RecentOpened): void {
  const items = [entry, ...readRecent().filter((e) => !(e.type === entry.type && e.id === entry.id))].slice(0, RECENT_KEEP);
  try {
    writeOwned(RECENT_KEY, { items });
  } catch {
    // A full store loses the list, never the screen.
  }
}

export function clearRecent(): void {
  platform().persistent.remove(RECENT_KEY);
}
