"use client";

import { usePermissions } from "@/src/hooks/usePermissions";

interface RequirePermissionProps {
  permissions: string | string[];
  requireAll?: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RequirePermission({
  permissions,
  requireAll = false,
  children,
  fallback = null,
}: RequirePermissionProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();

  const permArray = Array.isArray(permissions) ? permissions : [permissions];

  const hasAccess = requireAll
    ? hasAllPermissions(permArray)
    : hasAnyPermission(permArray);

  if (!hasAccess) return <>{fallback}</>;
  return <>{children}</>;
}

/**
 * Gate on the ADMIN role itself, for the handful of endpoints whose backend
 * check is a hardcoded `role == "ADMIN"` rather than a codename.
 *
 * Three call sites used `<RequirePermission permissions="ADMIN">` for this.
 * That worked by coincidence: `hasPermission` short-circuits to `true` for
 * ADMIN before it ever looks at the string, and for anyone else it asks
 * whether `permissions` contains the literal "ADMIN" -- which is never true,
 * because "ADMIN" is a role and the list holds codenames. So the behaviour was
 * *exactly* "ADMIN only", by two accidents that happened to cancel.
 *
 * Removing that short-circuit is the most obvious hardening this file invites,
 * and it would have closed those gates on **everyone, ADMIN included**, with
 * no test going red. Saying what is meant costs nothing and survives that
 * change.
 */
export function RequireAdmin({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { isAdmin } = usePermissions();
  if (!isAdmin) return <>{fallback}</>;
  return <>{children}</>;
}
