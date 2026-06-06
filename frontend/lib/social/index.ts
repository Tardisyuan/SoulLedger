/**
 * Social Domain — barrel export.
 *
 * Usage:
 *   import { type PostModel, socialKeys } from "@/lib/social";
 *   import { useFeed, useCreatePost } from "@/lib/social/state";
 */

// Models & types
export {
  type PostModel,
  type CommentModel,
  type ReactionModel,
  type FollowModel,
  type UserProfile,
  type PostVisibility,
  type ReactionType,
  type SocialEvent,
  type FeedState,
  socialKeys,
  initialFeedState,
  snapshotPost,
  rollbackPost,
  mergeFeedPosts,
  hydrateSocialEvent,
} from "./models";

// State hooks
export {
  useFeed,
  usePost,
  usePostsByAuthor,
  useCreatePost,
  useUpdatePost,
  useDeletePost,
  useComments,
  useCreateComment,
  useDeleteComment,
  useToggleReaction,
  useRemoveReaction,
  useUserReactions,
  useFollowers,
  useFollowing,
  useFollowStatus,
  useFollow,
  useUnfollow,
  useProfile,
  useUpdateProfile,
} from "./state";
