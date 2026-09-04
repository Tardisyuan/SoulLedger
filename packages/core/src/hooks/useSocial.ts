"use client";

import { drfNonFieldError } from "../validations/drfErrors";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socialApi, type UserProfile } from "../api/index";
import { notify, type NotifyMessage } from "../platform/index";
import { socialKeys } from "../query_keys";

/**
 * What DRF said, or the key to use when it said nothing usable.
 *
 * WHY THIS SHAPE. `notify` takes a message key and the host translates it, so
 * the fallback here is a key. The server's own sentence is not and can never be
 * one — DRF writes `non_field_errors` per request ("Cannot react to a post from
 * another tenant.") — so it goes through `NotifyMessage`'s `{ text }` form,
 * which exists for exactly this. See the note over `NotifyMessage` in
 * `@soulledger/core/platform`.
 *
 * `drfNonFieldError` is called with `""` and the result tested, rather than
 * being handed the key as its fallback: passing the key would make a missing
 * server message indistinguishable from a server message that happened to be
 * the key, and would send a key through the `{ text }` path where nothing would
 * translate it.
 */
function serverSaidOr(error: unknown, key: string): NotifyMessage {
  const said = drfNonFieldError(error, "");
  return said ? { text: said } : key;
}

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
  return useMutation({
    mutationFn: (data: { content: string; visibility?: string }) =>
      socialApi.createPost(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.posts.all });
      notify("social.post_created", "success");
    },
    onError: () => {
      notify("social.post_error", "error");
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => socialApi.deletePost(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.posts.all });
    },
    onError: () => {
      notify("social.post_delete_error", "error");
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
  return useMutation({
    mutationFn: (data: { post: string; content: string; parent?: string }) =>
      socialApi.createComment(data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: socialKeys.comments.all });
      qc.invalidateQueries({ queryKey: socialKeys.posts.detail(vars.post) });
    },
    onError: (error) => {
      notify(serverSaidOr(error, "social.comment_error"), "error");
    },
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => socialApi.deleteComment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.comments.all });
    },
    onError: () => {
      notify("social.comment_delete_error", "error");
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
      notify(serverSaidOr(error, "social.reaction_error"), "error");
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
    // This was the only social mutation with no onError. A failed follow left
    // the button reading "Follow" with nothing said, which is indistinguishable
    // from a click that never registered — so the natural response was to click
    // again, and fail again, silently.
    onError: (error) => {
      notify(serverSaidOr(error, "social.follow_error"), "error");
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
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<UserProfile> }) =>
      socialApi.updateProfile(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.profiles.all });
      notify("social.profile_updated", "success");
    },
    onError: (error) => {
      notify(serverSaidOr(error, "social.profile_update_error"), "error");
    },
  });
}
