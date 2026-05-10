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
