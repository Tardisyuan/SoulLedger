"use client";

import { useTenant } from "@/src/contexts/TenantContext";

/**
 * Hook for checking user permissions
 */
export function usePermissions() {
  const { user } = useTenant();

  const hasPermission = (permission: string): boolean => {
    if (user?.role === "ADMIN") return true;
    return user?.permissions?.includes(permission) ?? false;
  };

  const hasAnyPermission = (permissions: string[]): boolean => {
    return permissions.some((p) => hasPermission(p));
  };

  const hasAllPermissions = (permissions: string[]): boolean => {
    return permissions.every((p) => hasPermission(p));
  };

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    // Exposed so a gate that really is about the role can say so, instead of
    // passing the string "ADMIN" to a codename check and relying on the
    // short-circuit above. See RequireAdmin.
    isAdmin: user?.role === "ADMIN",
    permissions: user?.permissions ?? [],
  };
}
