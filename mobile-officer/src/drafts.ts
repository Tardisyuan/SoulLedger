/**
 * Reply drafts, kept on this phone: one per conversation, the DRAFT_KEEP most recently edited.
 *
 * They belong to the signed-in officer, so sign-out and a session the server ended both call
 * `clearDrafts()` -- the next officer on the phone must not find the last one's words. (The server has
 * its own per-officer draft, `soulInboxApi.saveDraft`, which the web inbox uses; this app does not
 * read or write it, so the two are separate drafts.) Bodies are never logged.
 */
import { platform } from "@soulledger/core/platform";

export const DRAFTS_KEY = "officer_reply_drafts";
export const DRAFT_KEEP = 20;
const SAVE_DELAY_MS = 400;

interface Draft {
  id: string;
  text: string;
}

function read(): Draft[] {
  try {
    const parsed = JSON.parse(platform().persistent.get(DRAFTS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((d): d is Draft => typeof d?.id === "string" && typeof d?.text === "string") : [];
  } catch {
    return [];
  }
}

function write(drafts: Draft[]): void {
  if (drafts.length === 0) platform().persistent.remove(DRAFTS_KEY);
  else platform().persistent.set(DRAFTS_KEY, JSON.stringify(drafts));
}

export function readDraft(id: string): string {
  return read().find((d) => d.id === id)?.text ?? "";
}

/** Newest first; a blank text removes the draft. */
export function saveDraft(id: string, text: string): void {
  const rest = read().filter((d) => d.id !== id);
  write(text.trim() ? [{ id, text }, ...rest].slice(0, DRAFT_KEEP) : rest);
}

// One write waiting at most: typing re-arms it, leaving the screen flushes it.
let pending: { id: string; text: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
}

export function flushDraft(): void {
  const waiting = pending;
  stop();
  if (waiting) saveDraft(waiting.id, waiting.text);
}

/** Debounced save while the officer types. */
export function scheduleDraft(id: string, text: string): void {
  if (pending && pending.id !== id) flushDraft();
  pending = { id, text };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushDraft, SAVE_DELAY_MS);
}

/** The reply went out: this draft is done, and no write still waiting may bring it back. */
export function clearDraft(id: string): void {
  if (pending?.id === id) stop();
  saveDraft(id, "");
}

/** Sign-out / the server ended the session. Also drops a write still waiting, so an unmount cannot restore one. */
export function clearDrafts(): void {
  stop();
  platform().persistent.remove(DRAFTS_KEY);
}
