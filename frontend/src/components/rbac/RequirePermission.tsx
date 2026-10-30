"use client";

import { usePermissions } from "@/src/hooks/usePermissions";
import { ViewingLock } from "@/src/components/impersonation/ViewingLock";
import { ListSkeleton } from "@/components/ui/skeleton";

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
  const { hasAnyPermission, hasAllPermissions, permissionsReady } = usePermissions();

  const permArray = Array.isArray(permissions) ? permissions : [permissions];

  const hasAccess = requireAll
    ? hasAllPermissions(permArray, { evenWhileViewing: true })
    : hasAnyPermission(permArray, { evenWhileViewing: true });

  // 刷新时权限还在路上:没有码不等于无权。有 fallback(拒绝页)的地方先画骨架，不闪 403;
  // 没有 fallback 的(藏一个按钮)本来就什么都不画。`!== false`:测试里手搓的 usePermissions 没有这一项。
  if (!hasAccess) return <>{permissionsReady === false && fallback !== null ? <PermissionsPending /> : fallback}</>;
  // 代看(只读)期间写类控件置灰,见 ViewingLock。
  return <ViewingLock permissions={permArray}>{children}</ViewingLock>;
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
  const { isAdmin, permissionsReady } = usePermissions();
  if (!isAdmin) return <>{permissionsReady === false && fallback !== null ? <PermissionsPending /> : fallback}</>;
  return <>{children}</>;
}

/** 权限未就绪时代替拒绝页的骨架(骨架自带 400 ms 延迟，快的刷新什么都看不见)。 */
export function PermissionsPending() {
  return (
    <div data-testid="permissions-pending" aria-busy="true">
      <ListSkeleton count={3} />
    </div>
  );
}
