/**
 * The soul circle, soul side: `/me/social/*`. Rides `soulHttp` (./soul) — the
 * soul token, the soul refresh, the password-change gate — so none of that is
 * restated here. backend/apps/social/soul_views.py is the contract.
 *
 * What a soul can see is decided server-side in one place
 * (backend/apps/social/soul_circle.py): same civilization (where the soul is
 * NOW, not where it came from), four visibility levels, pending/hidden content
 * only to its author. A client never filters to enforce that.
 */
import { soulHttp } from "./soul";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type SoulCard = Schemas["SoulCard"];
export type SoulSearchResult = Schemas["SoulSearchResult"];
export type SoulRelationCard = Schemas["SoulRelationCard"];
export type SoulProfile = Schemas["SoulProfile"];
export type SoulPost = Schemas["SoulPost"];
export type SoulComment = Schemas["SoulComment"];
export type SoulSocialStatus = Schemas["SoulSocialStatus"];
export type SoulReactionState = Schemas["SoulReactionState"];
export type SoulReportResult = Schemas["SoulReportResult"];
export type SoulPostVisibility = Schemas["SoulPostCreate"]["visibility"];
export type SoulReactionType = Schemas["SoulReactionRequest"]["reaction_type"];
export type SoulReportTarget = Schemas["SoulReportRequest"]["target_type"];
export type SoulReportReason = Schemas["SoulReportRequest"]["reason"];
export type PaginatedSoulPosts = Schemas["PaginatedSoulPosts"];
export type PaginatedSoulComments = Schemas["PaginatedSoulComments"];
export type PaginatedSoulCards = Schemas["PaginatedSoulCards"];
export type { PostMedia } from "../domain/postMedia";
export type SoulPostMediaUpload = Schemas["SoulPostMediaUpload"];

export { SOUL_POST_MEDIA_MAX, mediaGridColumns, mediaUrl } from "../domain/postMedia";

/**
 * The `code`s the circle's refusals carry, beyond the ones in `SOUL_ERROR_CODES`
 * (`not_found`, `account_retired`). `muted` also carries `muted_until`.
 */
export const SOUL_SOCIAL_ERROR_CODES = [
  "display_name_length",
  "display_name_sensitive",
  "display_name_taken",
  "duplicate_media",
  "empty_post",
  "eternal_light_locked",
  "file_required",
  "media_not_found",
  "muted",
  "not_an_image",
  "not_author",
  "parent_not_found",
  "post_sealed",
  "report_limit",
  "self_report",
  "too_large",
  "too_many_media",
  "too_many_pending",
  "too_many_pixels",
] as const;

const get = <T>(url: string, params?: object) => soulHttp.get<T>(url, { params }).then((r) => r.data);

export const soulSocialApi = {
  /** Ask first: `can_write` false while muted; `reports_remaining` of the 24 h allowance. */
  status: () => get<SoulSocialStatus>("/me/social/status/"),
  /**
   * This civilization + followed. `author` narrows it to one soul's posts (profile page);
   * `following` to its own posts and the souls it follows.
   */
  feed: (params: { page?: number; author?: number; following?: boolean } = {}) =>
    get<PaginatedSoulPosts>("/me/social/feed/", params),
  /**
   * 201 with `moderation_status`: PENDING when it hit the word list — show that, it is not visible yet.
   * `media`: ids from `uploadMedia`, in display order (at most 9). Text may be empty when there are images.
   */
  createPost: (content: string, visibility: SoulPostVisibility = "TENANT", media: string[] = []) =>
    soulHttp
      .post<SoulPost>("/me/social/feed/", { content, visibility, ...(media.length ? { media } : {}) })
      .then((r) => r.data),
  /**
   * Upload one image before posting. `body` is a multipart body the HOST builds
   * (the image under `file`) — see `socialApi.uploadAvatar` for why core cannot
   * build it and why the Content-Type is explicit. `onProgress` gets 0..1.
   * 400 `not_an_image` / `too_large` / `too_many_pixels`, 409 `too_many_pending`.
   */
  uploadMedia: (body: FormData, onProgress?: (fraction: number) => void) =>
    soulHttp
      .post<SoulPostMediaUpload>("/me/social/media/", body, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: onProgress
          ? (e) => onProgress(e.total ? Math.min(1, e.loaded / e.total) : 0)
          : undefined,
      })
      .then((r) => r.data),
  /** Drop an uploaded image that was not posted (file and row are deleted). */
  removeMedia: (id: string) => soulHttp.delete(`/me/social/media/${id}/`).then(() => undefined),
  post: (id: string) => get<SoulPost>(`/me/social/posts/${id}/`),
  deletePost: (id: string) => soulHttp.delete(`/me/social/posts/${id}/`).then(() => undefined),
  comments: (postId: string, page?: number) =>
    get<PaginatedSoulComments>(`/me/social/posts/${postId}/comments/`, { page }),
  comment: (postId: string, content: string, parent?: string) =>
    soulHttp
      .post<SoulComment>(`/me/social/posts/${postId}/comments/`, { content, ...(parent ? { parent } : {}) })
      .then((r) => r.data),
  deleteComment: (id: string) => soulHttp.delete(`/me/social/comments/${id}/`).then(() => undefined),
  /**
   * One reaction per soul per post: same type again removes it, a different type switches.
   * ETERNAL_LIGHT is final — after it, any call is 409 `eternal_light_locked`.
   */
  react: (postId: string, reaction_type: SoulReactionType = "LIKE") =>
    soulHttp.post<SoulReactionState>(`/me/social/posts/${postId}/reaction/`, { reaction_type }).then((r) => r.data),
  /** Display name (contains) or soul code (exact). The code is never returned. */
  search: (q: string) => get<SoulSearchResult[]>("/me/social/search/", { q }),
  /**
   * Change this soul's circle display name. Refusals, all leaving the old name in place:
   * 400 `display_name_length` (2–20 after trim), 400 `display_name_sensitive` (never saved
   * as pending), 409 `display_name_taken` (another current soul here has it, any case).
   */
  rename: (display_name: string) =>
    soulHttp.patch<SoulCard>("/me/social/profile/", { display_name }).then((r) => r.data),
  profile: (userId: number) => get<SoulProfile>(`/me/social/users/${userId}/`),
  follow: (userId: number) => soulHttp.post(`/me/social/users/${userId}/follow/`).then(() => true),
  unfollow: (userId: number) => soulHttp.delete(`/me/social/users/${userId}/follow/`).then(() => false),
  following: (page?: number) => get<PaginatedSoulCards>("/me/social/following/", { page }),
  followers: (page?: number) => get<PaginatedSoulCards>("/me/social/followers/", { page }),
  /** `counted` false: this soul already reported it (idempotent, costs nothing). 429 `report_limit`. */
  report: (target_type: SoulReportTarget, target_id: string | number, reason: SoulReportReason, detail = "") =>
    soulHttp
      .post<SoulReportResult>("/me/social/reports/", { target_type, target_id: String(target_id), reason, detail })
      .then((r) => r.data),
};
