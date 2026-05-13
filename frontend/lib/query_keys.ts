import type { UserFilters } from "./api";

export const userKeys = {
  all: ["users"] as const,
  list: (params?: UserFilters) => [...userKeys.all, "list", params] as const,
  detail: (id: string) => [...userKeys.all, "detail", id] as const,
};

export const soulKeys = {
  all: ["souls"] as const,
  list: (params?: Record<string, string>) => [...soulKeys.all, "list", params] as const,
  detail: (id: string) => [...soulKeys.all, "detail", id] as const,
};

export const workflowKeys = {
  all: ["workflows"] as const,
  list: (params?: Record<string, string>) => [...workflowKeys.all, "list", params] as const,
  detail: (id: string) => [...workflowKeys.all, "detail", id] as const,
};

export const permissionKeys = {
  all: ["permissions"] as const,
  list: ["permissions", "list"] as const,
  roles: ["permissions", "roles"] as const,
  rolePermissions: (role?: string) =>
    ["permissions", "role-permissions", role] as const,
};
