/**
 * React Query Social Sync Layer — optimistic updates, invalidation, merge.
 *
 * Rules:
 *   - NO manual refetch for realtime updates (event-driven invalidation only)
 *   - All mutations use optimistic updates with rollback
 *   - Merge strategy: event payload replaces cache entry
 *   - Invalidation: prefix-based for list queries, id-based for detail queries
 */

import { useQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import {
  socialFeedKeys,
  socialPostKeys,
  socialCommentKeys,
  socialReactionKeys,
  socialFollowKeys,
  socialProfileKeys,
} from "@/queryKeys/social";
import type {
  PostModel,
  CommentModel,
  ReactionModel,
  FollowModel,
  UserProfile,
  PostVisibility,
  ReactionType,
} from "@/lib/social/models";

// ── API Layer (typed) ─────────────────────────────────────────────────

const postApi = {
  list: (params?: Record<string, string>) =>
    api.get<unknown>("/social/posts/", { params }).then((r) => r.data as PostModel[]),
  get: (id: string) =>
    api.get<unknown>(`/social/posts/${id}/`).then((r) => r.data as PostModel),
  create: (data: { content: string; visibility?: PostVisibility; media_url?: string }) =>
    api.post<unknown>("/social/posts/", data).then((r) => r.data as PostModel),
  update: (id: string, data: { content?: string; visibility?: PostVisibility }) =>
    api.patch<unknown>(`/social/posts/${id}/`, data).then((r) => r.data as PostModel),
  delete: (id: string) =>
    api.delete<unknown>(`/social/posts/${id}/`).then((r) => r.data),
};

const commentApi = {
  listByPost: (postId: string) =>
    api.get<unknown>(`/social/posts/${postId}/comments/`).then((r) => r.data as CommentModel[]),
  create: (postId: string, data: { content: string; parent_id?: string }) =>
    api.post<unknown>(`/social/posts/${postId}/comments/`, data).then((r) => r.data as CommentModel),
  delete: (postId: string, commentId: string) =>
    api.delete<unknown>(`/social/posts/${postId}/comments/${commentId}/`).then((r) => r.data),
};

const reactionApi = {
  toggle: (postId: string, reactionType: ReactionType) =>
    api.post<unknown>(`/social/posts/${postId}/reactions/`, { reaction_type: reactionType }).then((r) => r.data as ReactionModel),
  remove: (postId: string) =>
    api.delete<unknown>(`/social/posts/${postId}/reactions/me/`).then((r) => r.data),
};

const followApi = {
  follow: (userId: string) =>
    api.post<unknown>("/social/follows/", { following_id: userId }).then((r) => r.data as FollowModel),
  unfollow: (userId: string) =>
    api.delete<unknown>(`/social/follows/${userId}/`).then((r) => r.data),
};

const profileApi = {
  get: (userId: string) =>
    api.get<unknown>(`/social/users/${userId}/profile/`).then((r) => r.data as UserProfile),
  update: (data: { bio?: string; avatar_url?: string }) =>
    api.patch<unknown>("/social/profile/", data).then((r) => r.data as UserProfile),
};

const feedApi = {
  get: (userId: string, params?: { cursor?: string; limit?: number }) =>
    api.get<unknown>("/social/feed/", { params: { user_id: userId, ...params } }).then((r) => r.data as PostModel[]),
};

// ── Invalidation Helpers ──────────────────────────────────────────────

/**
 * Invalidate all list queries that might contain a given post.
 * This is the core of the "no manual refetch" rule — events drive invalidation.
 */
function invalidatePostLists(queryClient: ReturnType<typeof useQueryClient>, postId: string) {
  // Invalidate all feed queries (prefix match)
  queryClient.invalidateQueries({ queryKey: socialFeedKeys.all });
  // Invalidate all post list queries
  queryClient.invalidateQueries({ queryKey: socialPostKeys.all });
  // Invalidate post detail
  queryClient.invalidateQueries({ queryKey: socialPostKeys.detail(postId) });
}

/**
 * Invalidate comment queries for a post.
 */
function invalidateComments(queryClient: ReturnType<typeof useQueryClient>, postId: string) {
  queryClient.invalidateQueries({ queryKey: socialCommentKeys.byPost(postId) });
  // Also invalidate post detail (comment count changed)
  queryClient.invalidateQueries({ queryKey: socialPostKeys.detail(postId) });
}

/**
 * Invalidate reaction queries for a post.
 */
function invalidateReactions(queryClient: ReturnType<typeof useQueryClient>, postId: string) {
  queryClient.invalidateQueries({ queryKey: socialReactionKeys.byPost(postId) });
  queryClient.invalidateQueries({ queryKey: socialPostKeys.detail(postId) });
}

/**
 * Invalidate follow queries for a user.
 */
function invalidateFollows(queryClient: ReturnType<typeof useQueryClient>, userId: string) {
  queryClient.invalidateQueries({ queryKey: socialFollowKeys.all });
  queryClient.invalidateQueries({ queryKey: socialProfileKeys.detail(userId) });
}

// ── Merge Strategy ────────────────────────────────────────────────────

/**
 * Merge incoming event data into the cache.
 * Strategy: replace the specific entry, keep the list order intact.
 */
function mergePostIntoCache(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: string,
  updates: Partial<PostModel>,
) {
  // Update detail cache
  queryClient.setQueryData(socialPostKeys.detail(postId), (old: PostModel | undefined) => {
    if (!old) return old;
    return { ...old, ...updates, _pending: false };
  });

  // Update in feed lists (optimistic, no refetch needed)
  for (const queryKey of [socialFeedKeys.all, socialPostKeys.all]) {
    queryClient.setQueriesData({ queryKey }, (old: PostModel[] | undefined) => {
      if (!old) return old;
      return old.map((p) => (p.id === postId ? { ...p, ...updates } : p));
    });
  }
}

// ── Feed Queries ──────────────────────────────────────────────────────

export function useSocialFeed(userId: string, enabled = true) {
  return useQuery({
    queryKey: socialFeedKeys.list(userId),
    queryFn: () => feedApi.get(userId),
    enabled,
    staleTime: 30_000,
    refetchInterval: false, // No manual refetch — event-driven only
  });
}

// ── Post Queries ──────────────────────────────────────────────────────

export function usePostDetail(id: string) {
  return useQuery({
    queryKey: socialPostKeys.detail(id),
    queryFn: () => postApi.get(id),
    enabled: !!id,
    staleTime: 60_000,
    refetchInterval: false,
  });
}

export function usePostsByAuthor(authorId: string) {
  return useQuery({
    queryKey: socialPostKeys.byAuthor(authorId),
    queryFn: () => postApi.list({ author_id: authorId }),
    enabled: !!authorId,
    staleTime: 30_000,
    refetchInterval: false,
  });
}

// ── Post Mutations (optimistic) ───────────────────────────────────────

export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { content: string; visibility?: PostVisibility; media_url?: string }) =>
      postApi.create(data),

    onMutate: async (data) => {
      // Optimistic: prepend temp post to feed
      await queryClient.cancelQueries({ queryKey: socialFeedKeys.all });

      const optimisticPost: PostModel = {
        id: `temp-${Date.now()}`,
        authorId: "current",
        authorName: "You",
        content: data.content,
        visibility: data.visibility || "PUBLIC",
        commentCount: 0,
        reactionCount: 0,
        _pending: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Prepend to all feed queries
      queryClient.setQueriesData({ queryKey: socialFeedKeys.all }, (old: PostModel[] | undefined) => {
        return old ? [optimisticPost, ...old] : [optimisticPost];
      });

      return { optimisticPost };
    },

    onError: (_err, _data, context) => {
      // Rollback: remove optimistic post
      if (context?.optimisticPost) {
        queryClient.setQueriesData({ queryKey: socialFeedKeys.all }, (old: PostModel[] | undefined) => {
          return old ? old.filter((p) => p.id !== context.optimisticPost.id) : [];
        });
      }
    },

    onSuccess: (newPost, _data, context) => {
      // Replace optimistic with real post
      queryClient.setQueriesData({ queryKey: socialFeedKeys.all }, (old: PostModel[] | undefined) => {
        if (!old) return [newPost];
        return old.map((p) => (p.id === context?.optimisticPost?.id ? newPost : p));
      });
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; content?: string; visibility?: PostVisibility }) =>
      postApi.update(id, data),

    onMutate: async ({ id, content }) => {
      // Optimistic: update content immediately
      await queryClient.cancelQueries({ queryKey: socialPostKeys.detail(id) });

      const previous = queryClient.getQueryData<PostModel>(socialPostKeys.detail(id));
      if (previous && content) {
        mergePostIntoCache(queryClient, id, { content, _pending: true });
      }

      return { previous, postId: id };
    },

    onError: (_err, _data, context) => {
      // Rollback
      if (context?.previous) {
        queryClient.setQueryData(socialPostKeys.detail(context.postId), context.previous);
        queryClient.setQueriesData({ queryKey: socialFeedKeys.all }, (old: PostModel[] | undefined) => {
          if (!old) return old;
          return old.map((p) =>
            p.id === context.postId && context.previous ? context.previous : p,
          );
        });
      }
    },

    onSettled: (_data, _error, { id }) => {
      // Event-driven invalidation will handle refresh
      invalidatePostLists(queryClient, id);
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postApi.delete(id),

    onMutate: async (id) => {
      // Optimistic: remove from feed immediately
      await queryClient.cancelQueries({ queryKey: socialFeedKeys.all });

      const previous = queryClient.getQueriesData({ queryKey: socialFeedKeys.all });
      queryClient.setQueriesData({ queryKey: socialFeedKeys.all }, (old: PostModel[] | undefined) => {
        return old ? old.filter((p) => p.id !== id) : [];
      });

      return { previous, postId: id };
    },

    onError: (_err, _id, context) => {
      // Rollback: restore feed
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
    },

    onSettled: (_data, _error, id) => {
      queryClient.removeQueries({ queryKey: socialPostKeys.detail(id) });
      invalidatePostLists(queryClient, id);
    },
  });
}

// ── Comment Mutations (optimistic) ────────────────────────────────────

export function useCreateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, content, parentId }: { postId: string; content: string; parentId?: string }) =>
      commentApi.create(postId, { content, parent_id: parentId }),

    onMutate: async ({ postId, content }) => {
      // Optimistic: append temp comment
      await queryClient.cancelQueries({ queryKey: socialCommentKeys.byPost(postId) });

      const previous = queryClient.getQueryData<CommentModel[]>(socialCommentKeys.byPost(postId));
      const optimisticComment: CommentModel = {
        id: `temp-${Date.now()}`,
        postId,
        authorId: "current",
        authorName: "You",
        content,
        parentId: null,
        _pending: true,
        createdAt: new Date().toISOString(),
      };

      queryClient.setQueryData(socialCommentKeys.byPost(postId), (old: CommentModel[] | undefined) => {
        return old ? [...old, optimisticComment] : [optimisticComment];
      });

      // Increment comment count on post
      mergePostIntoCache(queryClient, postId, {
        commentCount: (previous?.length || 0) + 1,
      });

      return { optimisticComment, postId };
    },

    onError: (_err, _data, context) => {
      // Rollback comments
      if (context) {
        queryClient.invalidateQueries({ queryKey: socialCommentKeys.byPost(context.postId) });
      }
    },

    onSuccess: (newComment, { postId }, context) => {
      // Replace optimistic with real comment
      queryClient.setQueryData(socialCommentKeys.byPost(postId), (old: CommentModel[] | undefined) => {
        if (!old) return [newComment];
        return old.map((c) => (c.id === context?.optimisticComment?.id ? newComment : c));
      });
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, commentId }: { postId: string; commentId: string }) =>
      commentApi.delete(postId, commentId),

    onMutate: async ({ postId, commentId }) => {
      // Optimistic: remove comment
      await queryClient.cancelQueries({ queryKey: socialCommentKeys.byPost(postId) });

      const previous = queryClient.getQueryData<CommentModel[]>(socialCommentKeys.byPost(postId));
      queryClient.setQueryData(socialCommentKeys.byPost(postId), (old: CommentModel[] | undefined) => {
        return old ? old.filter((c) => c.id !== commentId) : [];
      });

      // Decrement comment count
      const post = queryClient.getQueryData<PostModel>(socialPostKeys.detail(postId));
      if (post) {
        mergePostIntoCache(queryClient, postId, {
          commentCount: Math.max(0, post.commentCount - 1),
        });
      }

      return { previous, postId, commentId };
    },

    onError: (_err, _data, context) => {
      if (context) {
        queryClient.invalidateQueries({ queryKey: socialCommentKeys.byPost(context.postId) });
      }
    },
  });
}

// ── Reaction Mutations (optimistic) ───────────────────────────────────

export function useToggleReaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, reactionType }: { postId: string; reactionType: ReactionType }) =>
      reactionApi.toggle(postId, reactionType),

    onMutate: async ({ postId }) => {
      // Optimistic: increment reaction count
      await queryClient.cancelQueries({ queryKey: socialPostKeys.detail(postId) });
      const previous = queryClient.getQueryData<PostModel>(socialPostKeys.detail(postId));
      if (previous) {
        mergePostIntoCache(queryClient, postId, {
          reactionCount: previous.reactionCount + 1,
        });
      }
      return { previous, postId };
    },

    onError: (_err, _data, context) => {
      if (context?.previous) {
        queryClient.setQueryData(socialPostKeys.detail(context.postId), context.previous);
      }
    },

    onSettled: (_data, _error, { postId }) => {
      invalidateReactions(queryClient, postId);
    },
  });
}

export function useRemoveReaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => reactionApi.remove(postId),

    onMutate: async (postId) => {
      // Optimistic: decrement reaction count
      await queryClient.cancelQueries({ queryKey: socialPostKeys.detail(postId) });
      const previous = queryClient.getQueryData<PostModel>(socialPostKeys.detail(postId));
      if (previous) {
        mergePostIntoCache(queryClient, postId, {
          reactionCount: Math.max(0, previous.reactionCount - 1),
        });
      }
      return { previous, postId };
    },

    onError: (_err, _postId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(socialPostKeys.detail(context.postId), context.previous);
      }
    },

    onSettled: (_data, _error, postId) => {
      invalidateReactions(queryClient, postId);
    },
  });
}

// ── Follow Mutations (optimistic) ─────────────────────────────────────

export function useFollowUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => followApi.follow(userId),

    onMutate: async (userId) => {
      // Optimistic: increment followers count, set isFollowing
      await queryClient.cancelQueries({ queryKey: socialProfileKeys.detail(userId) });
      const previous = queryClient.getQueryData<UserProfile>(socialProfileKeys.detail(userId));
      if (previous) {
        queryClient.setQueryData(socialProfileKeys.detail(userId), {
          ...previous,
          followersCount: previous.followersCount + 1,
          isFollowing: true,
        });
      }
      return { previous, userId };
    },

    onError: (_err, userId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(socialProfileKeys.detail(userId), context.previous);
      }
    },

    onSettled: (_data, _error, userId) => {
      invalidateFollows(queryClient, userId);
    },
  });
}

export function useUnfollowUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => followApi.unfollow(userId),

    onMutate: async (userId) => {
      // Optimistic: decrement followers count, clear isFollowing
      await queryClient.cancelQueries({ queryKey: socialProfileKeys.detail(userId) });
      const previous = queryClient.getQueryData<UserProfile>(socialProfileKeys.detail(userId));
      if (previous) {
        queryClient.setQueryData(socialProfileKeys.detail(userId), {
          ...previous,
          followersCount: Math.max(0, previous.followersCount - 1),
          isFollowing: false,
        });
      }
      return { previous, userId };
    },

    onError: (_err, userId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(socialProfileKeys.detail(userId), context.previous);
      }
    },

    onSettled: (_data, _error, userId) => {
      invalidateFollows(queryClient, userId);
    },
  });
}

// ── Profile Queries ───────────────────────────────────────────────────

export function useProfile(userId: string) {
  return useQuery({
    queryKey: socialProfileKeys.detail(userId),
    queryFn: () => profileApi.get(userId),
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: false,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { bio?: string; avatar_url?: string }) => profileApi.update(data),

    onMutate: async (data) => {
      // Optimistic: update profile immediately
      // Note: we don't know the current user ID here, so we invalidate all profiles
      queryClient.setQueriesData({ queryKey: socialProfileKeys.all }, (old: UserProfile | undefined) => {
        if (!old) return old;
        return { ...old, ...data };
      });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: socialProfileKeys.all });
    },
  });
}

// ── Comment Queries ───────────────────────────────────────────────────

export function useComments(postId: string) {
  return useQuery({
    queryKey: socialCommentKeys.byPost(postId),
    queryFn: () => commentApi.listByPost(postId),
    enabled: !!postId,
    staleTime: 30_000,
    refetchInterval: false,
  });
}

// ── Reaction Queries ──────────────────────────────────────────────────

export function useReactionsByPost(postId: string) {
  return useQuery({
    queryKey: socialReactionKeys.byPost(postId),
    queryFn: async () => {
      // Placeholder — actual API TBD
      return [] as ReactionModel[];
    },
    enabled: !!postId,
    staleTime: 30_000,
    refetchInterval: false,
  });
}

// ── Follow Queries ────────────────────────────────────────────────────

export function useFollowers(userId: string) {
  return useQuery({
    queryKey: socialFollowKeys.followers(userId),
    queryFn: async () => {
      const res = await api.get(`/social/users/${userId}/followers/`);
      return res.data;
    },
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: false,
  });
}

export function useFollowing(userId: string) {
  return useQuery({
    queryKey: socialFollowKeys.following(userId),
    queryFn: async () => {
      const res = await api.get(`/social/users/${userId}/following/`);
      return res.data;
    },
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: false,
  });
}
