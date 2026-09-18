import { api } from "./client";
import type { components } from "./generated/schema";
import type { PaginatedResponse } from "./users";

/**
 * `/api/v1/chat/inbox/` — letters souls write to the hall they are in now
 * (backend/apps/chat/views.py `OfficerInboxViewSet`). Reading needs
 * `soul_inbox.read`, replying `soul_inbox.reply`. Message bodies live in
 * Synapse, not in our database: `messages()` is a pass-through, newest first.
 */
type Schemas = components["schemas"];
export type InboxConversation = Schemas["OfficerInbox"];
export type InboxMessage = Schemas["InboxMessage"];

export const soulInboxApi = {
  list: (params: { page?: number }) =>
    api.get<PaginatedResponse<InboxConversation>>("/chat/inbox/", { params }),
  /** Newest first. 503 `chat_not_configured` / `chat_unavailable` when Synapse is off or down. */
  messages: (id: string) => api.get<InboxMessage[]>(`/chat/inbox/${id}/messages/`),
  /** 409 `closed` once the soul has been reborn. */
  reply: (id: string, body: string) =>
    api.post<Schemas["MessageSent"]>(`/chat/inbox/${id}/reply/`, { body }),
};
