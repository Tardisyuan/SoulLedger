"use client";
import { useTenant } from "@/src/contexts/TenantContext";

export type Operation = "soul.create" | "soul.update" | "soul.delete" | "soul.judge" | "dispatch.propose" | "disposition.execute" | "admin.*";

const ROLE_PERMISSIONS: Record<string, Operation[]> = {
  ADMIN: ["soul.create", "soul.update", "soul.delete", "soul.judge", "dispatch.propose", "disposition.execute", "admin.*"],
  JUDGE: ["soul.judge", "soul.create"],
  GUARDIAN: ["soul.create", "soul.update"],
  VIEWER: [],
};

export function useAuth() {
  const { user, isAdmin } = useTenant();

  function hasPermission(operation: Operation): boolean {
    if (!user) return false;
    const perms = ROLE_PERMISSIONS[user.role] ?? [];
    return perms.includes(operation) || perms.includes("admin.*" as Operation);
  }

  function hasRole(role: string): boolean {
    return user?.role === role;
  }

  return { user, isAdmin, hasPermission, hasRole };
}
