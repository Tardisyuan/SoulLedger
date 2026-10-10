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
/** An uploaded, not yet sent letter image: its id and pixel size. */
export type SoulChatImageUpload = Schemas["ChatImageUploaded"];
/** A letter image's signed URL (site-root path, about an hour), for one viewer. */
export type SoulChatImageView = Schemas["ChatImage"];

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

/**
 * Codes the image endpoints add (backend `apps/chat/images.py`). The first three are the circle's
 * (`soul_app.circle.media.errors.*`); the last two are the chat's own (`soul_app.chat.image.errors.*`).
 * Everything else a send can meet is in `SOUL_CHAT_ERROR_CODES`.
 */
export const SOUL_CHAT_IMAGE_ERROR_CODES = ["not_an_image", "too_large", "too_many_pixels", "too_many_pending", "images_unavailable"] as const;
export type SoulChatImageErrorCode = (typeof SOUL_CHAT_IMAGE_ERROR_CODES)[number];

/** The `code` of a failed image request, or `null`. */
export function soulChatImageErrorCode(error: unknown): SoulChatImageErrorCode | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return (SOUL_CHAT_IMAGE_ERROR_CODES as readonly unknown[]).includes(code) ? (code as SoulChatImageErrorCode) : null;
}

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

/** Copy key for a failed image request: its own code first, then the chat's, then the general copy. */
export function soulChatImageErrorMessage(error: unknown): SoulErrorMessage {
  const code = soulChatImageErrorCode(error);
  if (code === "too_many_pending" || code === "images_unavailable") return { key: `soul_app.chat.image.errors.${code}` };
  if (code !== null) return { key: `soul_app.circle.media.errors.${code}` };
  return soulChatErrorMessage(error);
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
   *
   * `txnId`: the same id sent again gets the first send's event id back and
   * nothing is posted twice (the backend remembers it for 7 days).
   */
  send: (conversationId: string, body: string, txnId?: string) =>
    soulHttp
      .post<{ event_id: string }>(`/me/chat/conversations/${conversationId}/messages/`, txnId ? { body, txn_id: txnId } : { body })
      .then((r) => r.data.event_id),
  /**
   * Letter images, two steps. `uploadImage`: one image per request (`body` is a multipart body the HOST
   * builds, the file under `file` — see `soulSocialApi.uploadMedia`); 400 `not_an_image` / `too_large` /
   * `too_many_pixels`, 409 `too_many_pending` (4 unsent per conversation) / `images_unavailable` (a
   * throttled request room) / `closed`, 403 `muted` / `not_current_hall`. `sendImage`: posts it as one
   * message; sent again it answers with the first event id and posts nothing. Both always go through the
   * backend — the image file is not in Matrix.
   */
  uploadImage: (conversationId: string, body: FormData, onProgress?: (fraction: number) => void) =>
    soulHttp
      .post<SoulChatImageUpload>(`/me/chat/conversations/${conversationId}/images/`, body, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: onProgress ? (e) => onProgress(e.total ? Math.min(1, e.loaded / e.total) : 0) : undefined,
      })
      .then((r) => r.data),
  sendImage: (imageId: string) =>
    soulHttp.post<{ event_id: string }>(`/me/chat/images/${imageId}/send/`).then((r) => r.data.event_id),
  /** The signed path for one image (about an hour); 404 if this account is not a party to its conversation. */
  imageUrl: (imageId: string) => soulHttp.get<SoulChatImageView>(`/me/chat/images/${imageId}/`).then((r) => r.data),
  /** The whole code, any case; no prefix or fuzzy matching. POST so the code stays out of URLs and logs. */
  lookup: (soul_code: string) =>
    soulHttp.post<SoulChatLookupResult>("/me/chat/lookup/", { soul_code }).then((r) => r.data),
  /** 201 new, 200 existing. `throttled` true: not mutual, so this is a request (one per 24 h). */
  openDirect: (target_user: number) =>
    soulHttp.post<SoulConversation>("/me/chat/conversations/", { target_user }).then((r) => r.data),
  conversations: () => soulHttp.get<SoulConversation[]>("/me/chat/conversations/").then((r) => r.data),
};
