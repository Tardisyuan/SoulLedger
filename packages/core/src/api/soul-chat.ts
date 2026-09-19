/**
 * Soul chat, soul side: `/me/chat/*`. Rides `soulHttp` (./soul) like the circle
 * client does. backend/apps/chat/views.py is the contract; every rule (mutual
 * follows chat freely, a stranger gets one request per 24 h, mutes) is enforced
 * there, never here.
 *
 * Only the path to *starting* a direct chat lives here for now: find a soul by
 * its full code (any civilization — the circle search stops at the soul's own),
 * then open the conversation with the returned `user_id`. The chat screens that
 * will need the rest of `/me/chat/` are waiting on a design.
 */
import { soulHttp } from "./soul";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type SoulConversation = Schemas["Conversation"];
/** The circle's card: `user_id`, display name, avatar, `is_active`. Never the soul code. */
export type SoulChatLookupResult = Schemas["SoulCard"];

/**
 * Codes the lookup refuses with. Both already have copy under `soul_app.errors`
 * (see `SOUL_ERROR_CODES` in ./soul): `not_found` is deliberately the one answer
 * for "no such code", "yourself", "a past life" and "an officer";
 * `rate_limited` (20 lookups per soul account per hour) carries `retry_at`.
 */
export const SOUL_CHAT_LOOKUP_ERROR_CODES = ["not_found", "rate_limited"] as const;

export const soulChatApi = {
  /** The whole code, any case; no prefix or fuzzy matching. POST so the code stays out of URLs and logs. */
  lookup: (soul_code: string) =>
    soulHttp.post<SoulChatLookupResult>("/me/chat/lookup/", { soul_code }).then((r) => r.data),
  /** 201 new, 200 existing. `throttled` true: not mutual, so this is a request (one per 24 h). */
  openDirect: (target_user: number) =>
    soulHttp.post<SoulConversation>("/me/chat/conversations/", { target_user }).then((r) => r.data),
  conversations: () => soulHttp.get<SoulConversation[]>("/me/chat/conversations/").then((r) => r.data),
};
