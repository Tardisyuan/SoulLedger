import type { UserFilters } from "./api";

export const userKeys = {
  all: ["users"] as const,
  list: (params?: UserFilters) => [...userKeys.all, "list", params] as const,
  detail: (id: string) => [...userKeys.all, "detail", id] as const,
};

export const soulKeys = {
  all: ["souls"] as const,
  list: (params?: Record<string, string | number | undefined>) => [...soulKeys.all, "list", params] as const,
  detail: (id: string) => [...soulKeys.all, "detail", id] as const,
  ledger: (id: string) => [...soulKeys.all, "ledger", id] as const,
};

export const judgmentKeys = {
  all: ["judgments"] as const,
  list: (params?: Record<string, string>) => [...judgmentKeys.all, "list", params] as const,
  detail: (id: string) => [...judgmentKeys.all, "detail", id] as const,
  /**
   * The triage cursor. The skip list is part of the key on purpose: skipping
   * an item *is* the query changing, so TanStack refetches the head of the
   * queue with no imperative invalidate, and undo — which removes an id from
   * that list — walks straight back to a cached response.
   */
  queue: (skip: string[], at?: string) => [...judgmentKeys.all, "queue", { skip, at: at ?? null }] as const,
  /**
   * A page of the corpus. Under `judgmentKeys.all` rather than a key family of
   * its own because `citation_count` is annotated from `JudgmentCitation`:
   * filing a verdict's grounds changes a statute row's number, so an
   * invalidate of `judgmentKeys.all` has to reach these pages too.
   */
  statutes: (params?: Record<string, string>) => [...judgmentKeys.all, "statutes", params] as const,
};

export const workflowKeys = {
  all: ["workflows"] as const,
  list: (params?: Record<string, string>) => [...workflowKeys.all, "list", params] as const,
  detail: (id: string) => [...workflowKeys.all, "detail", id] as const,
  templates: {
    all: ["workflow-templates"] as const,
    list: (params?: Record<string, string>) => [...workflowKeys.templates.all, "list", params] as const,
    detail: (id: string) => [...workflowKeys.templates.all, "detail", id] as const,
  },
};

export const permissionKeys = {
  all: ["permissions"] as const,
  list: ["permissions", "list"] as const,
  roles: ["permissions", "roles"] as const,
  rolePermissions: (role?: string) =>
    ["permissions", "role-permissions", role] as const,
};

export const dispositionKeys = {
  all: ["dispositions"] as const,
  list: (params?: Record<string, string>) => [...dispositionKeys.all, "list", params] as const,
};

export const notificationKeys = {
  all: ["notifications"] as const,
  list: (params?: Record<string, string>) => [...notificationKeys.all, "list", params] as const,
  /**
   * The masthead badge. NOT under `all`: it is a separate endpoint with its own
   * cache entry, and putting it under `["notifications", …]` would make every
   * list invalidation refetch the badge too. It lives here rather than as a
   * literal in two files so the WS handler and the badge cannot drift apart —
   * which is exactly what happened to four other pairs (see eventHandlers.ts).
   */
  unreadCount: ["notifications-unread-count"] as const,
};

export const socialKeys = {
  all: ["social"] as const,
  posts: {
    all: ["social", "posts"] as const,
    list: (params?: Record<string, string | number | undefined>) =>
      [...socialKeys.posts.all, "list", params] as const,
    detail: (id: string) => [...socialKeys.posts.all, "detail", id] as const,
    feed: (params?: Record<string, string | number | undefined>) =>
      [...socialKeys.posts.all, "feed", params] as const,
  },
  comments: {
    all: ["social", "comments"] as const,
    list: (params?: Record<string, string | number | undefined>) =>
      [...socialKeys.comments.all, "list", params] as const,
  },
  reactions: {
    all: ["social", "reactions"] as const,
  },
  follows: {
    all: ["social", "follows"] as const,
    following: ["social", "follows", "following"] as const,
    followers: ["social", "follows", "followers"] as const,
  },
  profiles: {
    all: ["social", "profiles"] as const,
    detail: (id: string) => [...socialKeys.profiles.all, "detail", id] as const,
    me: ["social", "profiles", "me"] as const,
  },
};
