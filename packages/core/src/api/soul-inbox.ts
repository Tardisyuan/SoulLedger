import { api } from "./client";
import type { components } from "./generated/schema";
import type { PaginatedResponse } from "./users";

/**
 * `/api/v1/chat/inbox/` — letters souls write to the hall they are in now
 * (backend/apps/chat/views.py `OfficerInboxViewSet`). Reading needs
 * `soul_inbox.read`, replying `soul_inbox.reply`. Message bodies live in
 * Synapse, not in our database: `messages()` is a pass-through, newest first.
 *
 * Unread, archived and the draft are the CALLER's own (backend/apps/chat/inbox.py):
 * another officer reading, archiving or drafting changes nothing here.
 */
type Schemas = components["schemas"];
export type InboxConversation = Schemas["OfficerInbox"];
export type InboxMessage = Schemas["InboxMessage"];
export type InboxFolderCounts = Schemas["InboxFolders"];
export type InboxState = Schemas["InboxState"];
export type InboxReplyTemplate = Schemas["InboxReplyTemplate"];

/** The server's folders (`inbox.FOLDERS`). `awaiting_reply` comes oldest first; the rest newest first. */
export type InboxFolder = "all" | "awaiting_reply" | "replied" | "drafts" | "archived";

export interface InboxListParams {
  page?: number;
  folder?: InboxFolder;
  status?: "open" | "closed";
  hall?: number;
}

export const soulInboxApi = {
  list: (params: InboxListParams) => api.get<PaginatedResponse<InboxConversation>>("/chat/inbox/", { params }),
  /** Totals per folder, the same filter as `list` — so a count is what paging to the end gives. */
  folders: () => api.get<InboxFolderCounts>("/chat/inbox/folders/"),
  /** Newest first. 503 `chat_not_configured` / `chat_unavailable` when Synapse is off or down. */
  messages: (id: string) => api.get<InboxMessage[]>(`/chat/inbox/${id}/messages/`),
  /** 409 `closed` once the soul has been reborn. Clears the caller's draft and marks the thread read. */
  reply: (id: string, body: string) => api.post<Schemas["MessageSent"]>(`/chat/inbox/${id}/reply/`, { body }),
  markRead: (id: string) => api.post<InboxState>(`/chat/inbox/${id}/read/`),
  archive: (id: string) => api.post<InboxState>(`/chat/inbox/${id}/archive/`),
  unarchive: (id: string) => api.post<InboxState>(`/chat/inbox/${id}/unarchive/`),
  draft: (id: string) => api.get<InboxState>(`/chat/inbox/${id}/draft/`),
  /** Blank (or whitespace only) clears it. 409 `closed`: a closed thread is read-only. */
  saveDraft: (id: string, body: string) => api.put<InboxState>(`/chat/inbox/${id}/draft/`, { body }),
  clearDraft: (id: string) => api.delete<InboxState>(`/chat/inbox/${id}/draft/`),
};

/** `/api/v1/chat/inbox-templates/` — the hall's reply templates. Every action needs `soul_inbox.reply`. Not paginated. */
export const inboxTemplatesApi = {
  list: () => api.get<InboxReplyTemplate[]>("/chat/inbox-templates/"),
  create: (data: { title: string; body: string }) => api.post<InboxReplyTemplate>("/chat/inbox-templates/", data),
  update: (id: string, data: { title?: string; body?: string }) =>
    api.patch<InboxReplyTemplate>(`/chat/inbox-templates/${id}/`, data),
  remove: (id: string) => api.delete(`/chat/inbox-templates/${id}/`),
};

/** The only placeholders a template may carry (backend `TEMPLATE_PLACEHOLDERS`, which refuses any other). */
export const TEMPLATE_PLACEHOLDERS = ["soul_name", "hall_name"] as const;

/**
 * Fill a template before it goes into the reply box. Client-side on purpose: the
 * template never reaches Synapse, the filled text does. Only the two known
 * names are replaced; anything else is left as written (the server will not
 * have stored it).
 */
export function renderTemplate(body: string, values: { soul_name: string; hall_name: string }): string {
  return body.replace(/\{\{\s*(soul_name|hall_name)\s*\}\}/g, (_, name: "soul_name" | "hall_name") => values[name]);
}
