"use client";

import { drfFieldErrors, drfNonFieldError } from "../validations/drfErrors";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socialApi, type PaginatedResponse, type Post, type Reaction, type ScreeningOutcome, type UserProfile } from "../api/index";
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

/**
 * What the author is told after a write that went through the word list. The server answers
 * with the outcome only, never the word. `clean` / absent: the caller's own message.
 */
const SCREENING_MESSAGE = {
  masked: "social.screening.masked",
  pending_review: "social.screening.pending_review",
  hidden: "social.screening.hidden",
} as const;

function tellScreening(outcome: ScreeningOutcome | null | undefined, fallbackKey?: string) {
  // A value this build does not know (the server grew a fourth outcome) is treated as clean:
  // the caller's own message, never an empty toast.
  const key = outcome && outcome !== "clean" ? (SCREENING_MESSAGE as Record<string, string | undefined>)[outcome] : undefined;
  if (key) notify(key, "info");
  else if (fallbackKey) notify(fallbackKey, "success");
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

/**
 * Re-fetch every post list and detail — what a card's「重新获取」does when a
 * signed image URL has expired (the server signs a fresh one per response).
 */
export function useRefreshPosts() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: socialKeys.posts.all });
  };
}

/** The composer's upload limits (`GET /social/media/`); they change only with a deploy. */
export function usePostMediaLimits() {
  return useQuery({
    queryKey: socialKeys.mediaLimits,
    queryFn: socialApi.mediaLimits,
    staleTime: Infinity,
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { content: string; visibility?: string; media?: string[] }) =>
      socialApi.createPost(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: socialKeys.posts.all });
      tellScreening(res.data.screening, "social.post_created");
    },
    onError: () => {
      notify("social.post_error", "error");
    },
  });
}

/**
 * The author's own edit (`PATCH /social/posts/:id/`): text and visibility only —
 * the serializer's `media` is read-only. Same invalidation as create/delete.
 * A server-said reason (DRF non-field error) wins over the generic key.
 */
export function useUpdatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Pick<Partial<Post>, "content" | "visibility"> }) =>
      socialApi.updatePost(id, data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: socialKeys.posts.all });
      tellScreening(res.data.screening, "social.post_updated");
    },
    onError: (error) => {
      notify(serverSaidOr(error, "social.post_update_error"), "error");
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

type ListParams = Record<string, string | number | undefined>;

/**
 * Every page of a list, flattened into the shape of one.
 *
 * `CommentThread` builds a tree from `results`; it read ONE page — the
 * server's 20 — so the 21st comment was never in the thread (FL-09). (The
 * reaction half of FL-09 is now the server's `my_reaction` annotation.) Following `next` here,
 * inside the hook, keeps both consumers reading `data.results` exactly as
 * before. The first request is sent with the caller's params untouched so the
 * scoping is unchanged; later pages carry `page`. Not `fetchAllPages` from
 * `../api/client`: that walks a path, and these go through `socialApi` so the
 * existing call-site assertions stay true.
 */
async function everyPage<T>(
  fetchPage: (params?: ListParams) => Promise<{ data: PaginatedResponse<T> }>,
  params?: ListParams
): Promise<PaginatedResponse<T>> {
  const first = await fetchPage(params);
  const results = [...first.data.results];
  let next = first.data.next;
  for (let page = 2; next; page++) {
    const res = await fetchPage({ ...(params ?? {}), page: String(page) });
    results.push(...res.data.results);
    next = res.data.next;
  }
  return { ...first.data, next: null, previous: null, results };
}

export function useComments(postId: string) {
  return useQuery({
    queryKey: socialKeys.comments.list({ post: postId }),
    queryFn: () => everyPage((p) => socialApi.listComments(p), { post: postId }),
    enabled: !!postId,
    staleTime: 30_000,
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { post: string; content: string; parent?: string }) =>
      socialApi.createComment(data),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: socialKeys.comments.all });
      qc.invalidateQueries({ queryKey: socialKeys.posts.detail(vars.post) });
      tellScreening(res.data.screening);
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

type ReactionKind = Reaction["reaction_type"];
type ReactionVars = { post?: string; comment?: string; reaction_type: string };
type ReactableRow = { id: string; my_reaction?: ReactionKind | null; reaction_count?: number };

/**
 * What one toggle does to one cached row, mirroring `ReactionService.add_reaction`:
 * the same kind again takes it off, another kind switches it, none adds it.
 * Only the counts the row carries move — a comment has `reaction_count`, a post
 * also `reaction_counts`.
 */
function toggledRow<T extends { my_reaction?: ReactionKind | null; reaction_count?: number }>(
  row: T,
  type: ReactionKind,
): T {
  const before = row.my_reaction ?? null;
  const after = before === type ? null : type;
  const next = { ...row, my_reaction: after } as T & { reaction_counts?: Record<ReactionKind, number> };
  if (typeof row.reaction_count === "number") {
    next.reaction_count = row.reaction_count + (after ? 1 : 0) - (before ? 1 : 0);
  }
  const counts = (row as { reaction_counts?: Record<ReactionKind, number> }).reaction_counts;
  if (counts) {
    const c = { ...counts };
    if (before) c[before] = Math.max(0, (c[before] ?? 0) - 1);
    if (after) c[after] = (c[after] ?? 0) + 1;
    next.reaction_counts = c;
  }
  return next;
}

/** Apply `fn` to the row with `id` in a cached list page or a cached single row. */
function patchCached(data: unknown, id: string, fn: (row: ReactableRow) => unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const page = data as PaginatedResponse<ReactableRow>;
  if (Array.isArray(page.results)) {
    return page.results.some((r) => r.id === id)
      ? { ...page, results: page.results.map((r) => (r.id === id ? fn(r) : r)) }
      : data;
  }
  return (data as { id?: string }).id === id ? fn(data as ReactableRow) : data;
}

function holds(data: unknown, id: string): boolean {
  return patchCached(data, id, (r) => ({ ...r })) !== data;
}

/**
 * Optimistic: the bar reads `my_reaction` / the counts off the cached post or
 * comment (the server annotates them on every list row), so the cache is
 * changed in `onMutate`, put back in `onError`, and only the queries that hold
 * that post or comment are refetched in `onSettled`. There is no per-card
 * reaction list any more — that was one request (or several pages) per post and
 * per comment on screen.
 */
export function useToggleReaction() {
  const qc = useQueryClient();
  const scopeOf = (vars: ReactionVars) => (vars.post ? socialKeys.posts.all : socialKeys.comments.all);
  const idOf = (vars: ReactionVars) => (vars.post ?? vars.comment) as string;
  return useMutation({
    mutationFn: (data: ReactionVars) => socialApi.addReaction(data),
    onMutate: async (vars) => {
      const queryKey = scopeOf(vars);
      const id = idOf(vars);
      await qc.cancelQueries({ queryKey });
      const before = qc.getQueriesData({ queryKey });
      for (const [key, data] of before) {
        qc.setQueryData(key, patchCached(data, id, (r) => toggledRow(r, vars.reaction_type as ReactionKind)));
      }
      return { before };
    },
    onError: (error, _vars, ctx) => {
      for (const [key, data] of ctx?.before ?? []) qc.setQueryData(key, data);
      notify(serverSaidOr(error, "social.reaction_error"), "error");
    },
    onSettled: (_data, _error, vars) => {
      const id = idOf(vars);
      qc.invalidateQueries({ queryKey: scopeOf(vars), predicate: (q) => holds(q.state.data, id) });
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

/**
 * Upload the current user's avatar. `body` is the host's multipart body
 * (see `socialApi.uploadAvatar`). A rejected file comes back as a FIELD error
 * on `avatar` ("Avatar must be at most 5 MB.", "Upload a PNG, JPEG or WebP
 * image."), which `serverSaidOr` alone would not read — so that is tried first.
 */
export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => socialApi.uploadAvatar(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.profiles.all });
      notify("social.avatar_uploaded", "success");
    },
    onError: (error) => {
      const said = drfFieldErrors(error).avatar;
      notify(said ? { text: said } : serverSaidOr(error, "social.avatar_upload_error"), "error");
    },
  });
}
