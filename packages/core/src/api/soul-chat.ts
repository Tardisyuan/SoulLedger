/**
 * Soul chat, soul side: `/me/chat/*`. Rides `soulHttp` (./soul) like the circle
 * client does. backend/apps/chat/views.py is the contract; every rule (mutual
 * follows chat freely, a stranger gets one request per 24 h, mutes) is enforced
 * there, never here.
 *
 * Starting a direct chat: find a soul by its full code (any civilization — the
 * circle search stops at the soul's own), then open the conversation with the
 * returned `user_id`. Reading and free-chat sending go straight to Synapse
 * (./matrix); what goes through here is what the backend must see: the
 * 24-hour request channel of a throttled room, and letters to the hall.
 */
import axios from "axios";
import { soulErrorMessage, soulHttp, type SoulErrorMessage } from "./soul";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type SoulConversation = Schemas["Conversation"];
export type SoulChatSession = Schemas["ChatSession"];
/** The circle's card: `user_id`, display name, avatar, `is_active`. Never the soul code. */
export type SoulChatLookupResult = Schemas["SoulCard"];

/**
 * Codes the lookup refuses with. Both already have copy under `soul_app.errors`
 * (see `SOUL_ERROR_CODES` in ./soul): `not_found` is deliberately the one answer
 * for "no such code", "yourself", "a past life" and "an officer";
 * `rate_limited` (20 lookups per soul account per hour) carries `retry_at`.
 */
export const SOUL_CHAT_LOOKUP_ERROR_CODES = ["not_found", "rate_limited"] as const;

/**
 * The chat refusals with their own copy under `soul_app.chat.errors` — the
 * `code`s `backend/apps/chat/services.py`'s `ChatError` and the two 503s carry.
 * `self_conversation` is the server's name for `self`.
 */
export const SOUL_CHAT_ERROR_CODES = [
  "request_throttled",
  "muted",
  "closed",
  "peer_retired",
  "not_current_hall",
  "chat_unavailable",
  "chat_not_configured",
  "not_found",
  "self_conversation",
] as const;
export type SoulChatErrorCode = (typeof SOUL_CHAT_ERROR_CODES)[number];

/** The chat `code` of a failed request, or `null` (then `soulErrorMessage` has the general copy). */
export function soulChatErrorCode(error: unknown): SoulChatErrorCode | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return (SOUL_CHAT_ERROR_CODES as readonly unknown[]).includes(code) ? (code as SoulChatErrorCode) : null;
}

/** `retry_at` of a 429 (`request_throttled`, `rate_limited`), or `null`. */
export function soulChatRetryAt(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const at = (error.response?.data as { retry_at?: unknown } | undefined)?.retry_at;
  return typeof at === "string" ? at : null;
}

export function soulChatErrorMessage(error: unknown): SoulErrorMessage {
  const code = soulChatErrorCode(error);
  if (code === null) return soulErrorMessage(error);
  return { key: `soul_app.chat.errors.${code === "self_conversation" ? "self" : code}` };
}

export const soulChatApi = {
  /** A short-lived Matrix login token (./matrix `matrixLogin`). 503 `chat_not_configured`: this deployment has no chat. */
  session: () => soulHttp.get<SoulChatSession>("/me/chat/session/").then((r) => r.data),
  /** The hall the soul is in now: 201 new, 200 existing. */
  openInbox: () =>
    soulHttp.post<SoulConversation>("/me/chat/conversations/", { kind: "OFFICER_INBOX" }).then((r) => r.data),
  /**
   * Through the backend: a throttled room (the request channel; 429
   * `request_throttled` with `retry_at`) and the hall inbox. Free rooms go to
   * Synapse directly — though this path accepts them too.
   */
  send: (conversationId: string, body: string) =>
    soulHttp
      .post<{ event_id: string }>(`/me/chat/conversations/${conversationId}/messages/`, { body })
      .then((r) => r.data.event_id),
  /** The whole code, any case; no prefix or fuzzy matching. POST so the code stays out of URLs and logs. */
  lookup: (soul_code: string) =>
    soulHttp.post<SoulChatLookupResult>("/me/chat/lookup/", { soul_code }).then((r) => r.data),
  /** 201 new, 200 existing. `throttled` true: not mutual, so this is a request (one per 24 h). */
  openDirect: (target_user: number) =>
    soulHttp.post<SoulConversation>("/me/chat/conversations/", { target_user }).then((r) => r.data),
  conversations: () => soulHttp.get<SoulConversation[]>("/me/chat/conversations/").then((r) => r.data),
};
