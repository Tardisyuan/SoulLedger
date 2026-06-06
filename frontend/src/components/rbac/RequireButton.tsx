"use client";

import { usePermissions } from "@/src/hooks/usePermissions";

interface RequireButtonProps {
  /** Permission codename(s) required to show the button */
  permission?: string | string[];
  /** Button code from MenuButton (alternative to permission) */
  code?: string;
  /** Menu buttons array (from tree API) to check code against */
  buttons?: Array<{ code: string; permission: string }>;
  /** Require all permissions (AND) vs any (OR) */
  requireAll?: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Conditionally renders children based on button permission.
 *
 * Usage with permission codename:
 *   <RequireButton permission="soul.create">
 *     <button>Add Soul</button>
 *   </RequireButton>
 *
 * Usage with button code (from MenuButton):
 *   <RequireButton code="add" buttons={menuButtons}>
 *     <button>Add</button>
 *   </RequireButton>
 */
export function RequireButton({
  permission,
  code,
  buttons,
  requireAll = false,
  children,
  fallback = null,
}: RequireButtonProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();

  // If code + buttons provided, look up the permission for that button code
  if (code && buttons) {
    const button = buttons.find((b) => b.code === code);
    if (!button || !button.permission) {
      // Button not found or has no permission — hide by default
      return <>{fallback}</>;
    }
    if (!hasPermission(button.permission)) {
      return <>{fallback}</>;
    }
    return <>{children}</>;
  }

  // Direct permission check
  if (permission) {
    const permArray = Array.isArray(permission) ? permission : [permission];
    const hasAccess = requireAll
      ? hasAllPermissions(permArray)
      : hasAnyPermission(permArray);

    if (!hasAccess) return <>{fallback}</>;
    return <>{children}</>;
  }

  // No permission or code specified — FAIL CLOSED: hide by default
  // Security: never render without explicit permission check
  return <>{fallback}</>;
}
