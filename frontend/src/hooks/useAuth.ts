"use client";
import { useTenant } from "@/src/contexts/TenantContext";

export type Operation = string;

export function useAuth() {
  const { user, isAdmin, isJudge, isGuardian, isViewer } = useTenant();

  function hasPermission(operation: string): boolean {
    if (!user) return false;
    if (user.role === "ADMIN") return true;  // ADMIN has all permissions
    return user.permissions?.includes(operation) ?? false;
  }

  function hasRole(role: string): boolean {
    return user?.role === role;
  }

  return { user, isAdmin, isJudge, isGuardian, isViewer, hasPermission, hasRole };
}
