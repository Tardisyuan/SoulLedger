/**
 * Reply drafts, kept on this phone: one per conversation, the DRAFT_KEEP most recently edited.
 *
 * They belong to the signed-in officer: sign-out calls `clearDrafts()` (after saying how many there are, me.tsx);
 * a session the server ended keeps them for the same officer's next sign-in (owner.ts `dropUnowned`) -- the next
 * officer on the phone must not find the last one's words. Stored as `{ owner, drafts }` (owner.ts): another
 * officer on this phone reads none of them. Bodies are never logged.
 *
 * SYNC with the web inbox. The server keeps one private draft per conversation per officer (`soulInboxApi.draft`,
 * backend `InboxOfficerState`; only its writer ever gets it back). The phone stays the first copy: every write lands
 * here at once and is `dirty` until a PUT has carried it up. A failed PUT says nothing and leaves it dirty; it goes
 * again on the next `pushDrafts` (network back, app opened online) or when the letter is opened. Sign-out clears this
 * phone only: the server's copy is the officer's own and waits for them at the desk.
 * An emptied box that the server may have a copy of stays as a blank entry until the server has forgotten it too;
 * otherwise the next opening would bring the words back.
 */
import { soulInboxApi } from "@soulledger/core/api/soul-inbox";
import { platform } from "@soulledger/core/platform";

import { currentOwner, heldByAnother, readOwned, writeOwned } from "./owner";

export const DRAFTS_KEY = "officer_reply_drafts";
export const DRAFT_KEEP = 20;
const SAVE_DELAY_MS = 400;

interface Draft {
  id: string;
  text: string;
  /** When it was last edited here, or the server's time for a copy taken from the server (ms). */
  at: number;
  /** Changed here and not yet carried to the server. */
  dirty: boolean;
  /** The server may hold a copy (set before the PUT, whose answer can be lost). */
  remote: boolean;
}

function read(): Draft[] {
  const drafts = readOwned<{ drafts?: unknown }>(DRAFTS_KEY)?.drafts;
  if (!Array.isArray(drafts)) return [];
  // A draft kept by a build before the sync has only id and text: never pushed, of no known age.
  return (drafts as Partial<Draft>[])
    .filter((d) => typeof d?.id === "string" && typeof d?.text === "string")
    .map((d) => ({ ...d, at: typeof d.at === "number" ? d.at : 0, dirty: d.dirty !== false, remote: d.remote === true }) as Draft);
}

function write(drafts: Draft[]): void {
  if (heldByAnother(DRAFTS_KEY)) return;
  if (drafts.length === 0) platform().persistent.remove(DRAFTS_KEY);
  else writeOwned(DRAFTS_KEY, { drafts });
}

/** The conversations with a draft, newest first (the sign-out question counts them). */
export function draftIds(): string[] {
  flushDraft();
  return read().filter((d) => d.text).map((d) => d.id);
}

export function readDraft(id: string): string {
  return read().find((d) => d.id === id)?.text ?? "";
}

/** Newest first; a blank text removes the draft. */
export function saveDraft(id: string, text: string): void {
  const all = read();
  const mine = all.find((d) => d.id === id);
  const next = text.trim() ? text : "";
  // Nothing new: iOS also fires onChangeText when React fills the box, and that must not read as an edit.
  if ((mine?.text ?? "") === next) return;
  const rest = all.filter((d) => d.id !== id);
  if (!next && !mine?.remote) write(rest);
  else write([{ id, text: next, at: Date.now(), dirty: true, remote: mine?.remote ?? false }, ...rest].slice(0, DRAFT_KEEP));
}

const statusOf = (e: unknown): number | undefined => (e as { response?: { status?: number } })?.response?.status;

/** Carry one draft up. Never throws, never speaks: the words are safe here either way. */
function pushDraft(id: string): void {
  const mine = read().find((d) => d.id === id);
  if (!mine?.dirty || !currentOwner()) return;
  write(read().map((d) => (d.id === id ? { ...d, remote: true } : d)));
  const settled = () => {
    const all = read();
    // Typed on while this was in the air: still dirty, the next push carries the newer words.
    if (all.find((d) => d.id === id)?.text !== mine.text) return;
    write(mine.text ? all.map((d) => (d.id === id ? { ...d, dirty: false } : d)) : all.filter((d) => d.id !== id));
  };
  // 409 closed, or the letter is no longer this officer's to see: asking again would not change the answer.
  soulInboxApi.saveDraft(id, mine.text).then(settled, (e: unknown) => {
    if ([403, 404, 409].includes(statusOf(e) ?? 0)) settled();
  });
}

/** Everything not yet on the server, but for `except` (a queued reply's words: the reply is about to carry them). */
export function pushDrafts(except: readonly string[]): void {
  for (const d of read()) if (d.dirty && !except.includes(d.id)) pushDraft(d.id);
}

/**
 * Opening a letter: the server's copy has arrived, returns what the box should say. Words not yet pushed stay unless
 * the server's are newer (written at the desk since); words already pushed always yield, since the server has moved
 * on from them. A server with nothing has no time to compare, so unpushed words stay and go up.
 */
// ponytail: compares this phone's clock with the server's, so a phone set wrong can pick the older side. Curing it
// takes a base-version check on the PUT (a backend change); worth it only if this is ever seen.
export function mergeServerDraft(id: string, server: { draft: string; draft_saved_at?: string | null }): string {
  const all = read();
  const mine = all.find((d) => d.id === id);
  const same = (mine?.text ?? "") === server.draft;
  const at = Date.parse(server.draft_saved_at ?? "") || 0;
  if (mine?.dirty && !same && mine.at >= at) {
    pushDraft(id);
    return mine.text;
  }
  if (same && !mine?.dirty) return server.draft;
  const rest = all.filter((d) => d.id !== id);
  write(server.draft ? [{ id, text: server.draft, at, dirty: false, remote: true }, ...rest].slice(0, DRAFT_KEEP) : rest);
  return server.draft;
}

// One write waiting at most: typing re-arms it, leaving the screen flushes it.
let pending: { id: string; text: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
}

/** Writes what is waiting to this phone and nothing more: the session may just have ended (session.tsx). */
export function flushDraft(): void {
  const waiting = pending;
  stop();
  if (waiting) saveDraft(waiting.id, waiting.text);
}

/** The typing paused or the screen is going: what is waiting lands here, and goes up. */
export function settleDraft(): void {
  const id = pending?.id;
  flushDraft();
  if (id) pushDraft(id);
}

/** Debounced save while the officer types. */
export function scheduleDraft(id: string, text: string): void {
  if (pending && pending.id !== id) settleDraft();
  pending = { id, text };
  if (timer) clearTimeout(timer);
  timer = setTimeout(settleDraft, SAVE_DELAY_MS);
}

/**
 * The reply went out: this draft is done, and no write still waiting may bring it back. The reply itself cleared the
 * server's copy (`inbox.after_reply`); the DELETE is for a PUT that was in the air alongside it, so losing it costs nothing.
 */
export function clearDraft(id: string): void {
  if (pending?.id === id) stop();
  write(read().filter((d) => d.id !== id));
  if (currentOwner()) soulInboxApi.clearDraft(id).catch(() => undefined);
}

/** 「删除我的草稿」: nothing went out, so the server's copy is still there and must be told, whenever the network allows. */
export function discardDraft(id: string): void {
  if (pending?.id === id) stop();
  saveDraft(id, "");
  pushDraft(id);
}

/** Sign-out / the server ended the session. Also drops a write still waiting, so an unmount cannot restore one. */
export function clearDrafts(): void {
  stop();
  platform().persistent.remove(DRAFTS_KEY);
}
