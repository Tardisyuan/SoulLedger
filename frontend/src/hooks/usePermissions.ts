"use client";

import { useTenant } from "@/src/contexts/TenantContext";

/**
 * Hook for checking user permissions
 */
export function usePermissions() {
  const { user } = useTenant();

  // One expression, read twice. It used to be written out twice — once here as
  // the short-circuit and once in the returned object — so "what counts as an
  // administrator" had two definitions inside a single 34-line file. They could
  // not disagree, which is exactly why nothing would have reported it if they
  // started to.
  const isAdmin = user?.role === "ADMIN";

  const hasPermission = (permission: string): boolean => {
    if (isAdmin) return true;
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
    isAdmin,
    permissions: user?.permissions ?? [],
  };
}
