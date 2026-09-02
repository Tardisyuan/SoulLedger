"use client";

import axios from "axios";
import { drfNonFieldError } from "@soulledger/core/validations/drfErrors";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socialApi, type UserProfile } from "@soulledger/core/api";
import { useToast } from "@/src/contexts/ToastContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { socialKeys } from "@/lib/query_keys";

/**
 * Was a private reader for DRF's `non_field_errors` shape. It now delegates to
 * `lib/validations/drfErrors`, which also reads the per-field shape nothing in
 * the app used to read — see that file for why the two are separate functions.
 */
const extractErrorMessage = drfNonFieldError;

// ── Posts ────────────────────────────────────────────────────────────

/**
 * `options.enabled` exists because `app/social/page.tsx` shows one of two tabs
 * and was running BOTH queries. It passed `undefined` params to the inactive
 * one, which changes the query key and does not stop the fetch — the page hit
 * `/social/posts/` and `/social/feed/` on every visit and every page turn,
 * always discarding one of the two answers.
 */
export function usePosts(
  params?: Record<string, string | number | undefined>,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: socialKeys.posts.list(params),
    queryFn: async () => {
      const res = await socialApi.listPosts(params);
      return res.data;
    },
    enabled: options?.enabled ?? true,
    // Keep the previous page rendered while the next one loads, so a page
    // turn or a filter change does not flash a skeleton over data that is
    // about to be replaced by more of the same. `useJudgmentQueue` was the
    // only list in the app doing this; every other one blanked.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: socialKeys.posts.detail(id),
    queryFn: async () => {
      const res = await socialApi.getPost(id);
      return res.data;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** See `usePosts` for why this takes `enabled`. */
export function useFeed(
  params?: Record<string, string | number | undefined>,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: socialKeys.posts.feed(params),
    queryFn: async () => {
      const res = await socialApi.feed(params);
      return res.data;
    },
    enabled: options?.enabled ?? true,
    // Keep the previous page rendered while the next one loads, so a page
    // turn or a filter change does not flash a skeleton over data that is
    // about to be replaced by more of the same. `useJudgmentQueue` was the
    // only list in the app doing this; every other one blanked.
    placeholderData: (previous) => previous,
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
      return res.data;
    },
    enabled: !!postId,
    staleTime: 30_000,
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: (data: { post: string; content: string; parent?: string }) =>
      socialApi.createComment(data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: socialKeys.comments.all });
      qc.invalidateQueries({ queryKey: socialKeys.posts.detail(vars.post) });
    },
    onError: (error) => {
      showToast(extractErrorMessage(error, t("social.comment_error") || "Failed to add comment"), "error");
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
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useToggleReaction() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: (data: { post?: string; comment?: string; reaction_type: string }) =>
      socialApi.addReaction(data),
    onSuccess: (_data, vars) => {
      // The target's reaction list, not every reaction list in the cache.
      // Each PostCard mounts its own ReactionBar with its own
      // `useReactions({ post })` query, so `reactions.all` meant one click
      // refetched the reaction list of every post on screen.
      //
      // `posts.all` STAYS, and is not the same mistake: `Post.reaction_count`
      // is rendered in the card (PostCard.tsx:91), so the feed's own rows go
      // stale on a reaction. Checked before narrowing it.
      const target = vars.post ? { post: vars.post } : { comment: vars.comment };
      qc.invalidateQueries({ queryKey: [...socialKeys.reactions.all, target] });
      qc.invalidateQueries({ queryKey: socialKeys.posts.all });
    },
    onError: (error) => {
      showToast(extractErrorMessage(error, t("social.reaction_error") || "Failed to react"), "error");
    },
  });
}

// ── Follows ──────────────────────────────────────────────────────────

export function useToggleFollow() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: (followingId: string) => socialApi.toggleFollow(followingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.follows.all });
      qc.invalidateQueries({ queryKey: socialKeys.profiles.all });
    },
    // This was the only social mutation with no onError. A failed follow left
    // the button reading "Follow" with nothing said, which is indistinguishable
    // from a click that never registered — so the natural response was to click
    // again, and fail again, silently.
    onError: (error) => {
      showToast(extractErrorMessage(error, t("social.follow_error")), "error");
    },
  });
}

export function useFollowing() {
  return useQuery({
    queryKey: socialKeys.follows.following,
    queryFn: async () => {
      const res = await socialApi.following();
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useFollowers() {
  return useQuery({
    queryKey: socialKeys.follows.followers,
    queryFn: async () => {
      const res = await socialApi.followers();
      return res.data;
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
      return res.data;
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
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<UserProfile> }) =>
      socialApi.updateProfile(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.profiles.all });
      showToast(t("social.profile_updated") || "Profile updated", "success");
    },
    onError: (error) => {
      showToast(extractErrorMessage(error, t("social.profile_update_error") || "Failed to update profile"), "error");
    },
  });
}
