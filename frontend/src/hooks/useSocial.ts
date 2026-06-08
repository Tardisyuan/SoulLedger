"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  socialApi,
  type Post,
  type Comment,
  type Reaction,
  type Follow,
  type UserProfile,
} from "@/lib/api";
import { useToast } from "@/src/contexts/ToastContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { socialKeys } from "@/lib/query_keys";

// ── Posts ────────────────────────────────────────────────────────────

export function usePosts(params?: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: socialKeys.posts.list(params),
    queryFn: async () => {
      const res = await socialApi.listPosts(params);
      return res.data as { results: Post[]; count: number };
    },
    staleTime: 30_000,
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: socialKeys.posts.detail(id),
    queryFn: async () => {
      const res = await socialApi.getPost(id);
      return res.data as Post;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useFeed(params?: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: socialKeys.posts.feed(params),
    queryFn: async () => {
      const res = await socialApi.feed(params);
      return res.data as { results: Post[]; count: number } | Post[];
    },
    staleTime: 30_000,
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: (data: { content: string; visibility?: string }) =>
      socialApi.createPost(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.posts.all });
      showToast(t("social.post_created") || "Post created", "success");
    },
    onError: () => {
      showToast(t("social.post_error") || "Failed to create post", "error");
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: (id: string) => socialApi.deletePost(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.posts.all });
    },
    onError: () => {
      showToast("Failed to delete post", "error");
    },
  });
}

// ── Comments ─────────────────────────────────────────────────────────

export function useComments(postId: string) {
  return useQuery({
    queryKey: socialKeys.comments.list({ post: postId }),
    queryFn: async () => {
      const res = await socialApi.listComments({ post: postId });
      return res.data as { results: Comment[]; count: number };
    },
    enabled: !!postId,
    staleTime: 30_000,
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: (data: { post: string; content: string; parent?: string }) =>
      socialApi.createComment(data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: socialKeys.comments.all });
      qc.invalidateQueries({ queryKey: socialKeys.posts.detail(vars.post) });
    },
    onError: () => {
      showToast("Failed to add comment", "error");
    },
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: (id: string) => socialApi.deleteComment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.comments.all });
    },
    onError: () => {
      showToast("Failed to delete comment", "error");
    },
  });
}

// ── Reactions ────────────────────────────────────────────────────────

export function useReactions(params?: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...socialKeys.reactions.all, params] as const,
    queryFn: async () => {
      const res = await socialApi.listReactions(params);
      return res.data as { results: Reaction[]; count: number };
    },
    staleTime: 30_000,
  });
}

export function useToggleReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { post?: string; comment?: string; reaction_type: string }) =>
      socialApi.addReaction(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.reactions.all });
      qc.invalidateQueries({ queryKey: socialKeys.posts.all });
    },
  });
}

// ── Follows ──────────────────────────────────────────────────────────

export function useToggleFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (followingId: string) => socialApi.toggleFollow(followingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.follows.all });
      qc.invalidateQueries({ queryKey: socialKeys.profiles.all });
    },
  });
}

export function useFollowing() {
  return useQuery({
    queryKey: socialKeys.follows.following,
    queryFn: async () => {
      const res = await socialApi.following();
      return res.data as Follow[];
    },
    staleTime: 30_000,
  });
}

export function useFollowers() {
  return useQuery({
    queryKey: socialKeys.follows.followers,
    queryFn: async () => {
      const res = await socialApi.followers();
      return res.data as Follow[];
    },
    staleTime: 30_000,
  });
}

// ── Profiles ─────────────────────────────────────────────────────────

export function useProfile(userId: string) {
  return useQuery({
    queryKey: socialKeys.profiles.detail(userId),
    queryFn: async () => {
      const res = await socialApi.getProfile(userId);
      return res.data as UserProfile;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export function useMyProfile() {
  return useQuery({
    queryKey: socialKeys.profiles.me,
    queryFn: async () => {
      const res = await socialApi.myProfile();
      return res.data as UserProfile;
    },
    staleTime: 30_000,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<UserProfile> }) =>
      socialApi.updateProfile(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.profiles.all });
      showToast("Profile updated", "success");
    },
    onError: () => {
      showToast("Failed to update profile", "error");
    },
  });
}
