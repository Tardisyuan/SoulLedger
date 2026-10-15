/**
 * Letter replies written offline (Design batch 28 O3). The only thing the officer app queues: a
 * decision (approve / reject) is never sent late, because the case may have changed meanwhile.
 *
 * ONE ENTRY PER CONVERSATION, in the persistent store, so it outlives the process. The text is also the
 * officer's reply draft for that conversation (drafts.ts) and the draft is left alone until the reply
 * has gone out -- a failure therefore never costs the words.
 *
 * SENDING. `flushOutbox()` runs when the network returns (shell.tsx) and when the app opens online.
 * Before each POST the thread is read again: an officer message that was not there when the reply was
 * queued means someone else answered -- the reply is NOT sent (the server has no such check; it would
 * simply post a second answer). A request that dies with no answer from the server leaves the entry
 * queued and ends the run; one that the server answers with an error marks the entry `failed` with a
 * reason (below) and the run goes on to the next. Bodies are never logged.
 *
 * It is cleared with the drafts on sign-out and on a session the server ended (session.tsx).
 */
import { soulInboxApi } from "@soulledger/core/api/soul-inbox";
import { platform } from "@soulledger/core/platform";
import { useSyncExternalStore } from "react";

import { clearDraft } from "./drafts";

export const OUTBOX_KEY = "officer_reply_outbox";

/** Why a queued reply did not go out; each has its own words (officer_app.outbox.<reason>). */
export type OutboxReason = "answered" | "archived" | "left_hall" | "retry";

export interface OutboxEntry {
  /** The conversation. */
  id: string;
  name: string;
  text: string;
  /** The officer messages (event ids) the thread had when this was queued. */
  seen: string[];
  /** Sent with every attempt: the server answers a repeat with the first reply, so a lost response cannot post twice. */
  txn?: string;
  /** A send of this text may already have reached the server (set before the POST). Its own message is not "someone else answered". */
  tried?: boolean;
  state: "queued" | "failed";
  reason?: OutboxReason;
}

function isEntry(e: unknown): e is OutboxEntry {
  const x = e as Partial<OutboxEntry> | null;
  return !!x && typeof x.id === "string" && typeof x.text === "string" && typeof x.name === "string" && Array.isArray(x.seen) && (x.state === "queued" || x.state === "failed");
}

function readStored(): OutboxEntry[] {
  try {
    const parsed = JSON.parse(platform().persistent.get(OUTBOX_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

// A stable snapshot for useSyncExternalStore: replaced, never mutated, on every change.
let snapshot: OutboxEntry[] | null = null;
const listeners = new Set<() => void>();

export const outboxEntries = (): OutboxEntry[] => (snapshot ??= readStored());

function commit(next: OutboxEntry[]): void {
  snapshot = next;
  if (next.length === 0) platform().persistent.remove(OUTBOX_KEY);
  else platform().persistent.set(OUTBOX_KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

export function useOutbox(): OutboxEntry[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    outboxEntries,
  );
}

/** A fresh id for one reply (not one conversation): the server remembers it a week. */
export const newReplyTxn = () => `or${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`;

export const outboxEntry = (id: string): OutboxEntry | undefined => outboxEntries().find((e) => e.id === id);

/** Queue (or replace) the reply for this conversation. */
export function enqueueReply(entry: Omit<OutboxEntry, "state" | "reason">): void {
  commit([...outboxEntries().filter((e) => e.id !== entry.id), { ...entry, state: "queued" }]);
}

export function removeFromOutbox(id: string): void {
  commit(outboxEntries().filter((e) => e.id !== id));
}

/** 「删除我的草稿」: the entry and the draft with it. */
export function discardReply(id: string): void {
  removeFromOutbox(id);
  clearDraft(id);
}

/** Sign-out / the server ended the session. */
export function clearOutbox(): void {
  snapshot = [];
  platform().persistent.remove(OUTBOX_KEY);
  listeners.forEach((l) => l());
}

const statusOf = (e: unknown): number | undefined => (e as { response?: { status?: number } })?.response?.status;
const codeOf = (e: unknown): string | undefined => (e as { response?: { data?: { code?: string } } })?.response?.data?.code;

/** What the server's refusal means for the officer. 403 / 404: the thread is no longer this hall's to see. */
export function outboxReasonOf(error: unknown): OutboxReason {
  const status = statusOf(error);
  if (status === 403 || status === 404) return "left_hall";
  if (status === 409 && codeOf(error) === "closed") return "archived";
  return "retry";
}

const fail = (id: string, reason: OutboxReason) =>
  commit(outboxEntries().map((e) => (e.id === id ? { ...e, state: "failed" as const, reason } : e)));

let running: Promise<number> | null = null;

/** Sends every queued reply. Resolves with how many went out. One run at a time. */
export function flushOutbox(): Promise<number> {
  running ??= run().finally(() => (running = null));
  return running;
}

async function run(): Promise<number> {
  let sent = 0;
  for (const entry of outboxEntries().filter((e) => e.state === "queued")) {
    try {
      const { data: thread } = await soulInboxApi.messages(entry.id);
      // After a send that may have gone through, our own reply is in the thread: the server stamps every reply
      // with the txn id it came with, so ours is exactly the message carrying this entry's txn. Never compare
      // text (another officer may write the same words). A message without a txn id (older, or a lost stamp) is
      // treated as someone else's: wrongly flagging "answered" is the safe direction, the officer just rereads.
      const ours = (m: { txn_id?: string | null }) => !!entry.txn && m.txn_id === entry.txn;
      if (thread.some((m) => m.from_officer && !entry.seen.includes(m.event_id) && !ours(m))) {
        fail(entry.id, "answered");
        continue;
      }
      const txn = entry.txn ?? newReplyTxn();
      commit(outboxEntries().map((e) => (e.id === entry.id ? { ...e, txn, tried: true } : e)));
      await soulInboxApi.reply(entry.id, entry.text, txn);
      removeFromOutbox(entry.id);
      clearDraft(entry.id);
      sent += 1;
    } catch (e) {
      if (statusOf(e) === undefined) break; // no answer: still offline, try again on the next return
      fail(entry.id, outboxReasonOf(e));
    }
  }
  return sent;
}

/** 「重试」 on a failed row. */
export function retryReply(id: string): Promise<number> {
  commit(outboxEntries().map((e) => (e.id === id ? { ...e, state: "queued" as const, reason: undefined } : e)));
  return flushOutbox();
}
