/**
 * The chat's presentation rules — which of the design's states (handoff 1c ①–⑦,
 * 1d) a conversation is in, and how the list is cut into sections. Pure, with
 * tests in `__tests__/chatRules.test.ts`.
 *
 * The rules themselves are the server's (`backend/apps/chat/services.py`). The
 * server says, per conversation: `refusal` (why I cannot speak now — the same
 * judgement a send makes), `throttled` + `initiated_by_me` + `next_request_at`
 * (the 24-hour request channel). This file only picks the screen for those
 * facts. The one thing it adds is what the server learns lazily: the other side
 * has replied (the backend lifts the throttle on the next send — so until then
 * a reply already makes it a free conversation on this screen, and the send
 * still goes through the backend, which is what lifts it).
 */
import type { SoulConversation } from "@soulledger/core/api/soul-chat";

export type ChatMode =
  /** ① Free: mutual, or a request that has been answered. */
  | { kind: "free" }
  /** ③ Their first letter: reply and it opens; the hint says so. */
  | { kind: "incoming" }
  /** ② My request, and a letter may go now (the first, or 24 h after the last). */
  | { kind: "outgoing_open" }
  /** ② / ④ My request, locked until `nextAt`. `rejected`: a send was just refused for it (④). */
  | { kind: "outgoing_locked"; nextAt: string; rejected: boolean }
  /** ⑤ I am muted: no composer; the hall button under the reason. */
  | { kind: "muted" }
  /** ⑥ Read-only for good: the other soul was reborn (`closed`) or its account is closed. */
  | { kind: "closed"; reason: "closed" | "peer_retired" }
  /** The hall I am in now: write freely. */
  | { kind: "hall" }
  /** A hall I have left: its letters stay, sealed; the current hall is offered instead. */
  | { kind: "hall_sealed" };

export interface ChatFacts {
  now: number;
  /** Someone other than me has written in this room (per the timeline this device has). */
  peerHasSpoken: boolean;
  /** I have written in this room. */
  iHaveSpoken: boolean;
  /** A refusal this device met on its last send, newer than the list: a code, and `retry_at` for a 429. */
  refused?: { code: string; retryAt: string | null } | null;
}

export function chatMode(c: SoulConversation, facts: ChatFacts): ChatMode {
  const refusal = facts.refused?.code ?? c.refusal;
  if (refusal === "closed" || refusal === "peer_retired") return { kind: "closed", reason: refusal };
  if (c.kind === "OFFICER_INBOX") return refusal === "not_current_hall" ? { kind: "hall_sealed" } : { kind: "hall" };
  if (refusal === "muted") return { kind: "muted" };
  if (c.throttled && c.initiated_by_me && !facts.peerHasSpoken) {
    if (facts.refused?.code === "request_throttled" && facts.refused.retryAt) {
      return { kind: "outgoing_locked", nextAt: facts.refused.retryAt, rejected: true };
    }
    if (c.next_request_at && Date.parse(c.next_request_at) > facts.now) {
      return { kind: "outgoing_locked", nextAt: c.next_request_at, rejected: false };
    }
    return { kind: "outgoing_open" };
  }
  if (c.throttled && !c.initiated_by_me && !facts.iHaveSpoken) return { kind: "incoming" };
  return { kind: "free" };
}

/**
 * A send that must go through the backend: MY request channel in a throttled
 * room (the initiator is power level 0 in Synapse until the backend lifts it),
 * and the hall inbox (audited server-side). Everything else goes to Synapse —
 * including the answer to THEIR request: the receiver speaks at level 50, and
 * the backend refuses it on its path (409 `not_initiator`).
 */
export const sendsThroughBackend = (c: SoulConversation) => (c.throttled && c.initiated_by_me) || c.kind === "OFFICER_INBOX";

export interface ChatSections {
  /** The hall the soul is in now — at most one; `null`: never written, the row offers to start. */
  hall: SoulConversation | null;
  /** Halls left behind: listed under the current one, above the souls (handoff 1d rule 二). */
  sealedHalls: SoulConversation[];
  /** Soul conversations, newest activity first. Mutual or not is not a section (handoff 1a). */
  souls: SoulConversation[];
}

const activity = (c: SoulConversation, lastTs: (roomId: string) => number) =>
  Math.max(lastTs(c.room_id), Date.parse(c.last_message_at ?? c.created_at) || 0);

export function chatSections(rows: SoulConversation[], lastTs: (roomId: string) => number = () => 0): ChatSections {
  const halls = rows.filter((c) => c.kind === "OFFICER_INBOX");
  return {
    hall: halls.find((c) => c.refusal !== "not_current_hall") ?? null,
    sealedHalls: halls.filter((c) => c.refusal === "not_current_hall"),
    souls: rows.filter((c) => c.kind !== "OFFICER_INBOX").sort((a, b) => activity(b, lastTs) - activity(a, lastTs)),
  };
}

/**
 * A soul code as typed → as the server compares it: trimmed, upper-cased —
 * `normalize_soul_code` in backend/apps/soul_accounts/services.py, which login
 * shares. Nothing looser: a client that also dropped dashes would find codes
 * the server does not ("登得进却查不到" the other way round).
 */
export const normalizeCode = (raw: string) => raw.trim().toUpperCase();
/** `SOUL_CODE_LENGTH` there. Shorter or longer is refused here with its own copy, before asking. */
export const isCompleteCode = (code: string) => code.length === 10;

const pad = (n: number) => String(n).padStart(2, "0");

/** List time: today `HH:mm`, this year `MM-DD`, else `YYYY-MM-DD`. Device time. */
export function listStamp(ts: number, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === today.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bubble time: today `HH:mm`, else `MM-DD HH:mm`. */
export function bubbleStamp(ts: number, now: number): string {
  const d = new Date(ts);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date(now).toDateString() ? clock : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
}

/** The day divider between bubbles: `YYYY-MM-DD`. */
export function dayOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days left on a mute, rounded up — "你被禁言 N 日" counts what is left, not what was given. */
export function daysLeft(until: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(until) - now) / 86_400_000));
}
