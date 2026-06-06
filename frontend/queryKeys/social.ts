/**
 * Social Query Keys — centralized cache key factory.
 *
 * Pattern: domain.resource.variant(params)
 * All keys are immutable (as const) for type safety.
 *
 * Usage:
 *   import { socialFeedKeys, socialPostKeys } from "@/queryKeys/social";
 *   queryClient.invalidateQueries({ queryKey: socialFeedKeys.list("user123") });
 */

// ── Feed Keys ─────────────────────────────────────────────────────────

export const socialFeedKeys = {
  all: ["social", "feed"] as const,
  list: (userId: string) => ["social", "feed", "list", userId] as const,
  detail: (userId: string, cursor?: string) =>
    ["social", "feed", "list", userId, { cursor }] as const,
} as const;

// ── Post Keys ─────────────────────────────────────────────────────────

export const socialPostKeys = {
  all: ["social", "posts"] as const,
  detail: (id: string) => ["social", "posts", "detail", id] as const,
  byAuthor: (authorId: string) => ["social", "posts", "author", authorId] as const,
  byAuthorDetail: (authorId: string, cursor?: string) =>
    ["social", "posts", "author", authorId, { cursor }] as const,
} as const;

// ── Comment Keys ──────────────────────────────────────────────────────

export const socialCommentKeys = {
  all: ["social", "comments"] as const,
  byPost: (postId: string) => ["social", "comments", "post", postId] as const,
  byPostDetail: (postId: string, cursor?: string) =>
    ["social", "comments", "post", postId, { cursor }] as const,
} as const;

// ── Reaction Keys ─────────────────────────────────────────────────────

export const socialReactionKeys = {
  all: ["social", "reactions"] as const,
  byPost: (postId: string) => ["social", "reactions", "post", postId] as const,
  byUser: (userId: string) => ["social", "reactions", "user", userId] as const,
  status: (postId: string, userId: string) =>
    ["social", "reactions", "status", postId, userId] as const,
} as const;

// ── Follow Keys ───────────────────────────────────────────────────────

export const socialFollowKeys = {
  all: ["social", "follows"] as const,
  followers: (userId: string) => ["social", "follows", "followers", userId] as const,
  following: (userId: string) => ["social", "follows", "following", userId] as const,
  status: (followerId: string, followingId: string) =>
    ["social", "follows", "status", followerId, followingId] as const,
} as const;

// ── Profile Keys ──────────────────────────────────────────────────────

export const socialProfileKeys = {
  all: ["social", "profile"] as const,
  detail: (userId: string) => ["social", "profile", userId] as const,
} as const;

// ── Unified Export ────────────────────────────────────────────────────

export const socialKeys = {
  feed: socialFeedKeys,
  post: socialPostKeys,
  comment: socialCommentKeys,
  reaction: socialReactionKeys,
  follow: socialFollowKeys,
  profile: socialProfileKeys,
} as const;
