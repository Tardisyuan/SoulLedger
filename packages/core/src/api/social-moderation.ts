import { api } from "./client";
import type { components } from "./generated/schema";
import type { PaginatedResponse } from "./users";

/**
 * `/api/v1/social-moderation/` — the officer side of the soul circle.
 * backend/apps/social/moderation_{views,serializers}.py is the contract; every
 * endpoint needs the one codename `social.moderate`.
 *
 * Types come straight from the generated schema: this module is new, nothing
 * hand-written predates it that could drift.
 */
type Schemas = components["schemas"];
export type ModerationReport = Schemas["Report"];
export type ModeratedPost = Schemas["ModeratedPost"];
export type ModeratedComment = Schemas["ModeratedComment"];
export type SensitiveWord = Schemas["SensitiveWord"];
export type SocialMute = Schemas["SocialMute"];
export type ReportResolution = Schemas["ResolveReport"]["resolution"];
export type HandledContent = Schemas["HandledContent"];
/** Labels live in the bundles: `social_moderation.word_category.<member>` ("" → `NONE`). */
export type SensitiveWordCategory = Schemas["SocialSensitiveWordCategoryEnum"];
/** `social_moderation.word_action.<member>`. */
export type SensitiveWordAction = Schemas["SocialSensitiveWordActionEnum"];
export type ContentKind = "posts" | "comments";
export type ContentAction = "approve" | "hide" | "restore" | "delete";

export interface ModerationFilters {
  status?: string;
  moderation_status?: string;
  page?: number;
}

export interface NewSensitiveWord {
  word: string;
  /** Omitted: uncategorized (""). */
  category?: SensitiveWordCategory | "";
  /** Omitted: REVIEW — what every word did before actions existed. */
  action?: SensitiveWordAction;
}

export interface HandledFilters {
  type?: HandledContent["type"];
  handling?: HandledContent["handling"];
  page?: number;
}

export const socialModerationApi = {
  /** Default (no `status`): OPEN only — the queue, not the history. */
  reports: (params: ModerationFilters) =>
    api.get<PaginatedResponse<ModerationReport>>("/social-moderation/reports/", { params }),
  /** HIDE / DELETE act on the reported content; MUTE needs `mute_days`; 409 `already_resolved`. */
  resolveReport: (id: string, resolution: ReportResolution, note = "", muteDays?: number) =>
    api.post<ModerationReport>(`/social-moderation/reports/${id}/resolve/`, {
      resolution,
      note,
      ...(muteDays ? { mute_days: muteDays } : {}),
    }),
  /** Default (no `moderation_status`): PENDING only. */
  content: <K extends ContentKind>(kind: K, params: ModerationFilters) =>
    api.get<PaginatedResponse<K extends "posts" ? ModeratedPost : ModeratedComment>>(
      `/social-moderation/${kind}/`,
      { params }
    ),
  /** 409 `invalid_transition` when the row's current status does not allow it. */
  act: (kind: ContentKind, id: string, action: ContentAction, reason = "") =>
    api.post(`/social-moderation/${kind}/${id}/${action}/`, { reason }),
  /** Each row carries `hits_30d` — hits over the last 30 days. */
  words: (params: { page?: number }) =>
    api.get<PaginatedResponse<SensitiveWord>>("/social-moderation/sensitive-words/", { params }),
  /** Stored trimmed and lower-cased; 409 `duplicate_word`. */
  addWord: (word: string | NewSensitiveWord) =>
    api.post<SensitiveWord>("/social-moderation/sensitive-words/", typeof word === "string" ? { word } : word),
  removeWord: (id: string) => api.delete(`/social-moderation/sensitive-words/${id}/`),
  /** All or nothing, 1–200 ids; 404 `not_found` with `missing` when any id is not in this civilization's list. */
  removeWords: (ids: string[]) =>
    api.post<{ deleted: number }>("/social-moderation/sensitive-words/batch-delete/", { ids }),
  /** Hidden and officer-deleted posts and comments, newest first. */
  handled: (params: HandledFilters) =>
    api.get<PaginatedResponse<HandledContent>>("/social-moderation/handled/", { params }),
  mutes: (params: { page?: number }) =>
    api.get<PaginatedResponse<SocialMute>>("/social-moderation/mutes/", { params }),
  /** Only a soul currently in this civilization; 404 otherwise. */
  mute: (userId: number, days: number, reason = "") =>
    api.post<SocialMute>("/social-moderation/mutes/", { user_id: userId, days, reason }),
  /** 409 `already_lifted`. */
  liftMute: (id: string) => api.post<SocialMute>(`/social-moderation/mutes/${id}/lift/`),
};
