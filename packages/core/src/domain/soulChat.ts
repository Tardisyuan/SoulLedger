/**
 * 灵魂端书信会话此刻是哪一种(Design handoff 1c ①–⑦、1d),以及书信列表怎么分节。纯函数;灵魂 App
 * (`mobile/src/screens/conversation.tsx`、`letters.tsx`、`chat.tsx`)读它,将来 Web 有灵魂书信也读这一份。
 *
 * 规则是服务端的(`backend/apps/chat/services.py`)。会话没有状态列:服务端按会话下发 `refusal`(我此刻为什么
 * 不能说话 —— 与发送时同一个判断 `services.refusal`)与 `throttled` + `initiated_by_me` + `next_request_at`
 * (一日一封的申请通道)。这里只把这几样事实读成一个状态。唯一多出来的是服务端要晚一步才知道的:对方已经回过信
 * (后端在下一次发送时才解除节流 —— 在那之前,这个屏上回过信就算自由往来,发送照旧走后端,由它解除)。
 */
import type { SoulConversation } from "../api/soul-chat";

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
  /**
   * ⑥ Read-only: the other soul was reborn (`closed`) or its account is closed; or (2026-11-01) they declined
   * my request (`declined`), I blocked them (`peer_blocked`), or they blocked me -- told only `undeliverable`.
   */
  | { kind: "closed"; reason: ClosedReason }
  /** The hall I am in now: write freely. */
  | { kind: "hall" }
  /** A hall I have left: its letters stay, sealed; the current hall is offered instead. */
  | { kind: "hall_sealed" };

export const CLOSED_REASONS = ["closed", "peer_retired", "declined", "peer_blocked", "undeliverable"] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];
const isClosedReason = (code: string | null | undefined): code is ClosedReason => (CLOSED_REASONS as readonly unknown[]).includes(code);

export interface ChatFacts {
  now: number;
  /** Someone other than me has written in this room (per the timeline this device has). */
  peerHasSpoken: boolean;
  /** I have written in this room, or a letter of mine is on its way to it. */
  iHaveSpoken: boolean;
  /** A refusal this device met on its last send, newer than the list: a code, and `retry_at` for a 429. */
  refused?: { code: string; retryAt: string | null } | null;
}

export function chatMode(c: SoulConversation, facts: ChatFacts): ChatMode {
  // A refusal whose time has come says nothing about now: the list decides again.
  const refused = facts.refused?.retryAt && Date.parse(facts.refused.retryAt) <= facts.now ? null : facts.refused;
  const refusal = refused?.code ?? c.refusal;
  if (isClosedReason(refusal)) return { kind: "closed", reason: refusal };
  if (c.kind === "OFFICER_INBOX") return refusal === "not_current_hall" ? { kind: "hall_sealed" } : { kind: "hall" };
  if (refusal === "muted") return { kind: "muted" };
  if (c.throttled && c.initiated_by_me && !facts.peerHasSpoken) {
    if (refused?.code === "request_throttled" && refused.retryAt) {
      return { kind: "outgoing_locked", nextAt: refused.retryAt, rejected: true };
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
