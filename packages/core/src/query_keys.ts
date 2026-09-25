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
  /** 行程. Under `souls` so a state change that invalidates the soul refreshes its route. */
  path: (id: string) => [...soulKeys.all, "path", id] as const,
};

/**
 * The global recycle bin. Same literal `app/recycle-bin/page.tsx` has always
 * used for its list query (`["recycle-bin"]`), so invalidating this reaches it
 * without touching the page.
 */
export const recycleBinKeys = {
  all: ["recycle-bin"] as const,
};

/**
 * Dispatch records. `["dispatch", …]` is the literal the dispatch pages already
 * key their lists and detail on (`app/dispatch/**`), so an invalidate of `all`
 * reaches them unchanged.
 */
export const dispatchKeys = {
  all: ["dispatch"] as const,
  detail: (id: string) => [...dispatchKeys.all, "detail", id] as const,
  realmOptions: (targetTenantCode: string) => [...dispatchKeys.all, "realm-options", targetTenantCode] as const,
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
  /**
   * 「据 · 先例」. Under `judgmentKeys.all` because a verdict landing anywhere
   * in the tenant can change the ranking, and concluding already invalidates
   * that root.
   */
  precedents: (id: string, limit?: number) => [...judgmentKeys.all, "precedents", id, limit ?? null] as const,
  /** 「下一件」 after `after`. Under `all` so a conclusion's invalidate reaches it. */
  after: (after: string, skip: string[] = []) => [...judgmentKeys.all, "after", { after, skip }] as const,
  /** 「上一件」 from `at`. Under `all` so a conclusion's invalidate reaches it. */
  previous: (at: string, skip: string[] = []) => [...judgmentKeys.all, "previous", { at, skip }] as const,
  /** 「戊 · 发落」 options. Under `all`: a conclusion elsewhere changes occupancy. */
  destinations: (id: string, verdict: string) => [...judgmentKeys.all, "destinations", id, verdict] as const,
  /** The four queue groups' sizes. Under `all` so a claim's invalidate reaches it. */
  queueCounts: (params?: { court?: string; search?: string }) =>
    [...judgmentKeys.all, "queue-counts", params ?? null] as const,
  /** The court filter's options. Under `all`: a new case in a new court should show up. */
  courts: () => [...judgmentKeys.all, "courts"] as const,
  /** Who the given cases may be reassigned to. Keyed by the ids: the tenant comes from the cases. */
  assignableOfficers: (ids: readonly string[]) => [...judgmentKeys.all, "assignable-officers", [...ids]] as const,
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
  list: (params?: Record<string, string | undefined>) => [...dispositionKeys.all, "list", params] as const,
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

/**
 * One root for both resources, because scheduler writes touch both: a manual
 * run adds a TaskRun AND changes the job row's `last_run`; a PATCH or rebuild
 * changes rows whose runs the drawer may be showing. The realtime handler
 * invalidates `all`; `jobs` / `runs.list` are what the reads key under.
 */
export const schedulerKeys = {
  all: ["scheduler"] as const,
  jobs: ["scheduler", "jobs"] as const,
  runs: {
    all: ["scheduler", "runs"] as const,
    list: (params: Record<string, string | number | undefined>) => ["scheduler", "runs", "list", params] as const,
  },
};

/**
 * One root: a reset writes a credential AND changes the account row; a reveal
 * or delivery changes a credential a soul's account card may be summarising.
 *
 * There is deliberately no key for a revealed password. It is never cached.
 */
export const soulAccountKeys = {
  all: ["soul-accounts"] as const,
  chain: (soulId: string) => ["soul-accounts", "chain", soulId] as const,
  credentials: (params: Record<string, string | number | undefined>) => ["soul-accounts", "credentials", params] as const,
  rebirthApplications: (params: Record<string, string | number | undefined>) =>
    ["soul-accounts", "rebirth-applications", params] as const,
};

/**
 * The officer moderation backend. One root: resolving a report can hide a post
 * (content queue), mute its author (mutes) and close sibling reports — every
 * write invalidates the whole tree rather than guessing which lists moved.
 */
export const socialModerationKeys = {
  all: ["social-moderation"] as const,
  reports: (params: Record<string, string | number | undefined>) => ["social-moderation", "reports", params] as const,
  content: (kind: "posts" | "comments", params: Record<string, string | number | undefined>) =>
    ["social-moderation", kind, params] as const,
  words: (params: Record<string, string | number | undefined>) => ["social-moderation", "words", params] as const,
  mutes: (params: Record<string, string | number | undefined>) => ["social-moderation", "mutes", params] as const,
  handled: (params: Record<string, string | number | undefined>) => ["social-moderation", "handled", params] as const,
  /** One post or comment, full text — the review detail. Under `all`, so every write refreshes it. */
  item: (kind: "posts" | "comments", id: string) => ["social-moderation", "item", kind, id] as const,
};

/** The hall inbox (officer side of soul chat). One root; a reply invalidates all of it. */
export const soulInboxKeys = {
  all: ["soul-inbox"] as const,
  list: (params: Record<string, string | number | undefined>) => ["soul-inbox", "list", params] as const,
  lists: () => ["soul-inbox", "list"] as const,
  folders: () => ["soul-inbox", "folders"] as const,
  messages: (id: string) => ["soul-inbox", "messages", id] as const,
  draft: (id: string) => ["soul-inbox", "draft", id] as const,
  templates: () => ["soul-inbox", "templates"] as const,
};

/**
 * Sentence plans (officer side). One root: deciding a request, withdrawing it
 * or cancelling the plan changes both the soul's plan panel and the inbox.
 */
export const sentencePlanKeys = {
  all: ["sentence-plans"] as const,
  list: (params: Record<string, string | number | boolean | undefined>) => ["sentence-plans", "list", params] as const,
  detail: (id: string) => ["sentence-plans", "detail", id] as const,
};

/** Soul chat, soul side. Opening a conversation invalidates the list. */
export const soulChatKeys = {
  all: ["soul-chat"] as const,
  conversations: () => ["soul-chat", "conversations"] as const,
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

/**
 * The permissions page. The two literals are the ones
 * `frontend/app/permissions/page.tsx` already reads under (`["roles"]`,
 * `["role-permissions", name]`), so an invalidation from these hooks reaches
 * the queries that page owns.
 */
export const permKeys = {
  roles: ["roles"] as const,
  rolePermissions: (roleName: string) => ["role-permissions", roleName] as const,
};
