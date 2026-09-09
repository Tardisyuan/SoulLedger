import type { UserFilters } from "./api/index";

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

/**
 * Menus are cached under TWO unrelated roots, and that is the whole reason this
 * factory exists.
 *
 * `["menus", …]` is the admin CRUD list on `/menus`. The sidebar is a different
 * request — `menusApi.all()` for ADMIN, `menusApi.list()` for everyone else,
 * normalised into a tree — so it has always had its own entry, and the entry is
 * role-scoped because the two endpoints return different shapes.
 *
 * The two roots share no prefix, so `invalidateQueries({queryKey: ["menus"]})`
 * does not touch the sidebar. Measured 2026-09-06: all three mutations on
 * `/menus` invalidated only `["menus"]`, and `useSidebarMenus` sets
 * `staleTime: 5 * 60 * 1000`, so an admin who added, renamed or deleted a menu
 * saw the old sidebar — and the old breadcrumbs, and the old `MenuGloss`
 * titles, which read the same cache entry — for up to five minutes. `AppLayout`
 * never unmounts, so nothing remounted to paper over it.
 *
 * `invalidateAll` exists so a caller cannot fix one root and forget the other,
 * which is the same failure `notificationKeys.unreadCount` was extracted to
 * prevent. Pinned by `menuCacheRootsAreInvalidatedTogether.test.ts`.
 */
export const menuKeys = {
  all: ["menus"] as const,
  sidebar: (role?: string, signedIn?: boolean) => ["menus-sidebar", role, signedIn] as const,
  /**
   * Both roots a menu write touches. Spread into separate invalidate calls —
   * TanStack matches one key per call, so a single call cannot cover two roots.
   *
   * `["menu-buttons"]` is deliberately NOT here. Buttons are a separate resource
   * with its own page and its own root; `normalizeMenus` keeps only
   * `parent == null` rows, so buttons never enter the sidebar tree and a button
   * write has nothing to invalidate here.
   */
  invalidateAll: [["menus"], ["menus-sidebar"]] as const,
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
