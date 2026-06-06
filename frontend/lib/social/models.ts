/**
 * Social Domain Models — normalized, event-hydratable, rollback-capable.
 *
 * Aligns 1:1 with backend EventCatalog (M12.7):
 *   POST_CREATED, POST_UPDATED, POST_DELETED,
 *   COMMENT_CREATED, COMMENT_DELETED,
 *   REACTION_ADDED, REACTION_REMOVED,
 *   USER_FOLLOWED, USER_UNFOLLOWED
 */

// ── Enums ──────────────────────────────────────────────────────────────

export type PostVisibility = "PUBLIC" | "TENANT" | "FOLLOWERS" | "PRIVATE";

export type ReactionType = "LIKE" | "LOVE" | "RESPECT" | "SYMPATHY" | "ETERNAL_LIGHT";

// ── Core Models ────────────────────────────────────────────────────────

export interface PostModel {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  visibility: PostVisibility;
  mediaUrl?: string;
  commentCount: number;
  reactionCount: number;
  /** Optimistic flag: true while a mutation is in-flight */
  _pending?: boolean;
  /** Snapshot before optimistic update (for rollback) */
  _snapshot?: Partial<PostModel>;
  createdAt: string;
  updatedAt: string;
}

export interface CommentModel {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  parentId: string | null;
  content: string;
  _pending?: boolean;
  _snapshot?: Partial<CommentModel>;
  createdAt: string;
}

export interface ReactionModel {
  id: string;
  userId: string;
  postId: string | null;
  commentId: string | null;
  reactionType: ReactionType;
  createdAt: string;
}

export interface FollowModel {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  bio: string;
  followersCount: number;
  followingCount: number;
  postCount: number;
  isFollowing?: boolean; // hydrated from Follow state
}

// ── Cache Key Factory ──────────────────────────────────────────────────
// Single source of truth: re-export from queryKeys/social.ts

import {
  socialFeedKeys,
  socialPostKeys,
  socialCommentKeys,
  socialReactionKeys,
  socialFollowKeys,
  socialProfileKeys,
} from "@/queryKeys/social";

export const socialKeys = {
  all: ["social"] as const,
  posts: socialPostKeys,
  comments: socialCommentKeys,
  reactions: socialReactionKeys,
  follows: socialFollowKeys,
  profile: socialProfileKeys,
  feed: socialFeedKeys,
} as const;

// Backward-compatible aliases for useRealtimeFeed.ts
export const socialFeedKeysCompat = {
  posts: {
    feed: (userId: string) => socialFeedKeys.list(userId),
    detail: (id: string) => socialPostKeys.detail(id),
  },
  comments: {
    byPost: (postId: string) => socialCommentKeys.byPost(postId),
  },
  reactions: {
    byPost: (postId: string) => socialReactionKeys.byPost(postId),
  },
  follows: {
    all: socialFollowKeys.all,
  },
} as const;

// ── Optimistic Update Helpers ──────────────────────────────────────────

/**
 * Create an optimistic snapshot of a post before mutation.
 * Used for rollback on failure.
 */
export function snapshotPost(post: PostModel): PostModel {
  return { ...post, _pending: true, _snapshot: { commentCount: post.commentCount, reactionCount: post.reactionCount } };
}

/**
 * Rollback a post to its pre-mutation snapshot.
 */
export function rollbackPost(post: PostModel): PostModel {
  if (!post._snapshot) return { ...post, _pending: false };
  return {
    ...post,
    ...post._snapshot,
    _pending: false,
    _snapshot: undefined,
  };
}

// ── Event Hydration ────────────────────────────────────────────────────

/**
 * Map backend event types to frontend model updates.
 * Used by WebSocketContext to hydrate cache on real-time events.
 */
export type SocialEventType =
  | "POST_CREATED"
  | "POST_UPDATED"
  | "POST_DELETED"
  | "COMMENT_CREATED"
  | "COMMENT_DELETED"
  | "REACTION_ADDED"
  | "REACTION_REMOVED"
  | "USER_FOLLOWED"
  | "USER_UNFOLLOWED";

export interface SocialEvent {
  domain: "social";
  event: SocialEventType;
  post_id?: string;
  comment_id?: string;
  reaction_type?: ReactionType;
  user_id?: string;
  author_name?: string;
  content?: string;
  comment_count?: number;
  reaction_count?: number;
  follower_id?: string;
  following_id?: string;
  timestamp: string;
}

/**
 * Hydrate React Query cache based on incoming social event.
 */
export function hydrateSocialEvent(
  event: SocialEvent,
  queryClient: { invalidateQueries: (args: { queryKey: readonly unknown[] | unknown[] }) => void },
): void {
  switch (event.event) {
    case "POST_CREATED":
    case "POST_UPDATED":
    case "POST_DELETED":
      queryClient.invalidateQueries({ queryKey: socialKeys.posts.all });
      break;
    case "COMMENT_CREATED":
    case "COMMENT_DELETED":
      if (event.post_id) {
        queryClient.invalidateQueries({ queryKey: socialKeys.comments.byPost(event.post_id) });
        queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(event.post_id) });
      }
      break;
    case "REACTION_ADDED":
    case "REACTION_REMOVED":
      if (event.post_id) {
        queryClient.invalidateQueries({ queryKey: socialKeys.reactions.byPost(event.post_id) });
        queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(event.post_id) });
      }
      break;
    case "USER_FOLLOWED":
    case "USER_UNFOLLOWED":
      if (event.following_id) {
        queryClient.invalidateQueries({ queryKey: socialKeys.follows.followers(event.following_id) });
        queryClient.invalidateQueries({ queryKey: socialKeys.profile.detail(event.following_id) });
      }
      if (event.follower_id) {
        queryClient.invalidateQueries({ queryKey: socialKeys.follows.following(event.follower_id) });
        queryClient.invalidateQueries({ queryKey: socialKeys.profile.detail(event.follower_id) });
      }
      break;
  }
}

// ── Feed State ─────────────────────────────────────────────────────────

export interface FeedState {
  /** Ordered list of post IDs for the current feed page */
  postIds: string[];
  /** Normalized post cache (id → PostModel) */
  posts: Record<string, PostModel>;
  /** Cursor for pagination (ISO timestamp of last post) */
  cursor: string | null;
  /** Whether more pages are available */
  hasMore: boolean;
  /** Loading state */
  isLoading: boolean;
}

export const initialFeedState: FeedState = {
  postIds: [],
  posts: {},
  cursor: null,
  hasMore: true,
  isLoading: false,
};

/**
 * Merge new posts into the feed state (handles deduplication).
 */
export function mergeFeedPosts(state: FeedState, newPosts: PostModel[]): FeedState {
  const existingIds = new Set(state.postIds);
  const merged = { ...state.posts };
  const newIds: string[] = [];

  for (const post of newPosts) {
    merged[post.id] = post;
    if (!existingIds.has(post.id)) {
      newIds.push(post.id);
    }
  }

  return {
    ...state,
    postIds: [...state.postIds, ...newIds],
    posts: merged,
    cursor: newPosts.length > 0 ? newPosts[newPosts.length - 1].createdAt : state.cursor,
    hasMore: newPosts.length === 50, // assuming page size 50
    isLoading: false,
  };
}
