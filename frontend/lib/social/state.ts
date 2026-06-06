/**
 * Social State Management — React Query hooks with optimistic updates.
 *
 * Provides hooks for Post, Comment, Reaction, Follow, and Feed operations.
 * All hooks use normalized cache keys from socialKeys.
 * Optimistic updates are applied immediately and rolled back on failure.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import {
  type PostModel,
  type CommentModel,
  type ReactionModel,
  type FollowModel,
  type ReactionType,
  type PostVisibility,
  socialKeys,
  snapshotPost,
  rollbackPost,
} from "./models";

// ── Post API ───────────────────────────────────────────────────────────

const postApi = {
  list: (params?: Record<string, string>) =>
    api.get("/social/posts/", { params }).then((r) => r.data),
  get: (id: string) =>
    api.get(`/social/posts/${id}/`).then((r) => r.data),
  create: (data: { content: string; visibility?: PostVisibility; media_url?: string }) =>
    api.post("/social/posts/", data).then((r) => r.data),
  update: (id: string, data: { content?: string; visibility?: PostVisibility }) =>
    api.patch(`/social/posts/${id}/`, data).then((r) => r.data),
  delete: (id: string) =>
    api.delete(`/social/posts/${id}/`).then((r) => r.data),
};

// ── Comment API ────────────────────────────────────────────────────────

const commentApi = {
  listByPost: (postId: string, params?: Record<string, string>) =>
    api.get(`/social/posts/${postId}/comments/`, { params }).then((r) => r.data),
  create: (postId: string, data: { content: string; parent_id?: string }) =>
    api.post(`/social/posts/${postId}/comments/`, data).then((r) => r.data),
  delete: (postId: string, commentId: string) =>
    api.delete(`/social/posts/${postId}/comments/${commentId}/`).then((r) => r.data),
};

// ── Reaction API ───────────────────────────────────────────────────────

const reactionApi = {
  toggle: (postId: string, reactionType: ReactionType) =>
    api.post(`/social/posts/${postId}/reactions/`, { reaction_type: reactionType }).then((r) => r.data),
  remove: (postId: string) =>
    api.delete(`/social/posts/${postId}/reactions/me/`).then((r) => r.data),
};

// ── Follow API ─────────────────────────────────────────────────────────

const followApi = {
  follow: (userId: string) =>
    api.post(`/social/follows/`, { following_id: userId }).then((r) => r.data),
  unfollow: (userId: string) =>
    api.delete(`/social/follows/${userId}/`).then((r) => r.data),
  followers: (userId: string, params?: Record<string, string>) =>
    api.get(`/social/users/${userId}/followers/`, { params }).then((r) => r.data),
  following: (userId: string, params?: Record<string, string>) =>
    api.get(`/social/users/${userId}/following/`, { params }).then((r) => r.data),
  checkStatus: (userId: string) =>
    api.get(`/social/follows/status/${userId}/`).then((r) => r.data),
};

// ── Profile API ────────────────────────────────────────────────────────

const profileApi = {
  get: (userId: string) =>
    api.get(`/social/users/${userId}/profile/`).then((r) => r.data),
  update: (data: { bio?: string; avatar_url?: string }) =>
    api.patch("/social/profile/", data).then((r) => r.data),
};

// ── Feed API ───────────────────────────────────────────────────────────

const feedApi = {
  get: (params?: { cursor?: string; limit?: number }) =>
    api.get("/social/feed/", { params }).then((r) => r.data),
};

// ── Hooks: Posts ───────────────────────────────────────────────────────

export function useFeed(userId: string, enabled = true) {
  return useQuery({
    queryKey: socialKeys.feed.list(userId),
    queryFn: () => feedApi.get(),
    enabled,
    staleTime: 30_000,
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: socialKeys.posts.detail(id),
    queryFn: () => postApi.get(id),
    enabled: !!id,
  });
}

export function usePostsByAuthor(authorId: string) {
  return useQuery({
    queryKey: socialKeys.posts.byAuthor(authorId),
    queryFn: () => postApi.list({ author_id: authorId }),
    enabled: !!authorId,
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { content: string; visibility?: PostVisibility; media_url?: string }) =>
      postApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: socialKeys.posts.all });
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; content?: string; visibility?: PostVisibility }) =>
      postApi.update(id, data),
    onMutate: async ({ id, content }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: socialKeys.posts.detail(id) });
      const previous = queryClient.getQueryData<PostModel>(socialKeys.posts.detail(id));
      if (previous && content) {
        queryClient.setQueryData(socialKeys.posts.detail(id), {
          ...previous,
          content,
          _pending: true,
        });
      }
      return { previous };
    },
    onError: (_err, { id }, context) => {
      // Rollback
      if (context?.previous) {
        queryClient.setQueryData(socialKeys.posts.detail(id), context.previous);
      }
    },
    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(id) });
      queryClient.invalidateQueries({ queryKey: socialKeys.posts.all });
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: socialKeys.posts.all });
    },
  });
}

// ── Hooks: Comments ────────────────────────────────────────────────────

export function useComments(postId: string) {
  return useQuery({
    queryKey: socialKeys.comments.byPost(postId),
    queryFn: () => commentApi.listByPost(postId),
    enabled: !!postId,
  });
}

export function useCreateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, content, parentId }: { postId: string; content: string; parentId?: string }) =>
      commentApi.create(postId, { content, parent_id: parentId }),
    onSuccess: (_data, { postId }) => {
      queryClient.invalidateQueries({ queryKey: socialKeys.comments.byPost(postId) });
      queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, commentId }: { postId: string; commentId: string }) =>
      commentApi.delete(postId, commentId),
    onSuccess: (_data, { postId }) => {
      queryClient.invalidateQueries({ queryKey: socialKeys.comments.byPost(postId) });
      queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
    },
  });
}

// ── Hooks: Reactions ───────────────────────────────────────────────────

export function useToggleReaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, reactionType }: { postId: string; reactionType: ReactionType }) =>
      reactionApi.toggle(postId, reactionType),
    onMutate: async ({ postId }) => {
      // Optimistic: increment reaction count
      await queryClient.cancelQueries({ queryKey: socialKeys.posts.detail(postId) });
      const previous = queryClient.getQueryData<PostModel>(socialKeys.posts.detail(postId));
      if (previous) {
        queryClient.setQueryData(socialKeys.posts.detail(postId), {
          ...previous,
          reactionCount: previous.reactionCount + 1,
        });
      }
      return { previous };
    },
    onError: (_err, { postId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(socialKeys.posts.detail(postId), context.previous);
      }
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: socialKeys.reactions.byPost(postId) });
      queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
    },
  });
}

export function useRemoveReaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => reactionApi.remove(postId),
    onMutate: async (postId) => {
      // Optimistic: decrement reaction count
      await queryClient.cancelQueries({ queryKey: socialKeys.posts.detail(postId) });
      const previous = queryClient.getQueryData<PostModel>(socialKeys.posts.detail(postId));
      if (previous) {
        queryClient.setQueryData(socialKeys.posts.detail(postId), {
          ...previous,
          reactionCount: Math.max(0, previous.reactionCount - 1),
        });
      }
      return { previous };
    },
    onError: (_err, postId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(socialKeys.posts.detail(postId), context.previous);
      }
    },
    onSettled: (_data, _error, postId) => {
      queryClient.invalidateQueries({ queryKey: socialKeys.reactions.byPost(postId) });
      queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
    },
  });
}

export function useUserReactions(userId: string) {
  return useQuery({
    queryKey: socialKeys.reactions.byUser(userId),
    queryFn: () => reactionApi.toggle(userId, "LIKE"), // placeholder
    enabled: false, // manual trigger only
  });
}

// ── Hooks: Follows ─────────────────────────────────────────────────────

export function useFollowers(userId: string) {
  return useQuery({
    queryKey: socialKeys.follows.followers(userId),
    queryFn: () => followApi.followers(userId),
    enabled: !!userId,
  });
}

export function useFollowing(userId: string) {
  return useQuery({
    queryKey: socialKeys.follows.following(userId),
    queryFn: () => followApi.following(userId),
    enabled: !!userId,
  });
}

export function useFollowStatus(followerId: string, followingId: string) {
  return useQuery({
    queryKey: socialKeys.follows.status(followerId, followingId),
    queryFn: () => followApi.checkStatus(followingId),
    enabled: !!followerId && !!followingId && followerId !== followingId,
  });
}

export function useFollow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => followApi.follow(userId),
    onMutate: async (userId) => {
      // Optimistic: increment following count
      await queryClient.cancelQueries({ queryKey: socialKeys.profile.detail(userId) });
      const previous = queryClient.getQueryData(socialKeys.profile.detail(userId));
      if (previous && typeof previous === "object") {
        queryClient.setQueryData(socialKeys.profile.detail(userId), {
          ...(previous as Record<string, unknown>),
          followersCount: ((previous as Record<string, unknown>).followersCount as number) + 1,
          isFollowing: true,
        });
      }
      return { previous };
    },
    onError: (_err, userId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(socialKeys.profile.detail(userId), context.previous);
      }
    },
    onSettled: (_data, _error, userId) => {
      queryClient.invalidateQueries({ queryKey: socialKeys.profile.detail(userId) });
      queryClient.invalidateQueries({ queryKey: socialKeys.follows.all });
    },
  });
}

export function useUnfollow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => followApi.unfollow(userId),
    onMutate: async (userId) => {
      // Optimistic: decrement following count
      await queryClient.cancelQueries({ queryKey: socialKeys.profile.detail(userId) });
      const previous = queryClient.getQueryData(socialKeys.profile.detail(userId));
      if (previous && typeof previous === "object") {
        queryClient.setQueryData(socialKeys.profile.detail(userId), {
          ...(previous as Record<string, unknown>),
          followersCount: Math.max(0, ((previous as Record<string, unknown>).followersCount as number) - 1),
          isFollowing: false,
        });
      }
      return { previous };
    },
    onError: (_err, userId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(socialKeys.profile.detail(userId), context.previous);
      }
    },
    onSettled: (_data, _error, userId) => {
      queryClient.invalidateQueries({ queryKey: socialKeys.profile.detail(userId) });
      queryClient.invalidateQueries({ queryKey: socialKeys.follows.all });
    },
  });
}

// ── Hooks: Profile ─────────────────────────────────────────────────────

export function useProfile(userId: string) {
  return useQuery({
    queryKey: socialKeys.profile.detail(userId),
    queryFn: () => profileApi.get(userId),
    enabled: !!userId,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { bio?: string; avatar_url?: string }) => profileApi.update(data),
    onSuccess: () => {
      // Invalidate all profile queries
      queryClient.invalidateQueries({ queryKey: socialKeys.profile.all });
    },
  });
}
