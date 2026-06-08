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
  karma: (id: string) => [...soulKeys.all, "karma", id] as const,
};

export const judgmentKeys = {
  all: ["judgments"] as const,
  list: (params?: Record<string, string>) => [...judgmentKeys.all, "list", params] as const,
  detail: (id: string) => [...judgmentKeys.all, "detail", id] as const,
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
