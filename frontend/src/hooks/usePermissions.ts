"use client";

import { useTenant } from "@/src/contexts/TenantContext";
import { READ_ONLY_CODENAME, useImpersonation } from "@/src/components/impersonation/useImpersonation";

type ViewingOpt = { evenWhileViewing?: boolean };

/**
 * Hook for checking user permissions
 *
 * 代看 / 进殿查看(`useImpersonation()` 非空)期间:`hasPermission` 只认读码,`isAdmin` 为假 ——
 * 与后端一致(写请求被 `impersonation_read_only` 拒;进殿查看时 `is_tenant_exempt` 为假)。
 * 一处改动覆盖所有直接用 `hasPermission()` / `isAdmin` 判的控件(rbac-web M-4)。
 * `RequirePermission` / `RequireButton` 传 `{ evenWhileViewing: true }` 拿原始答案,
 * 好让 ViewingLock 把写按钮画成置灰而不是藏掉(Design 第二十八批 W6)。
 */
export function usePermissions() {
  const { user } = useTenant();
  const viewing = useImpersonation() !== null;

  // One expression, read twice. It used to be written out twice — once here as
  // the short-circuit and once in the returned object — so "what counts as an
  // administrator" had two definitions inside a single 34-line file. They could
  // not disagree, which is exactly why nothing would have reported it if they
  // started to.
  const roleIsAdmin = user?.role === "ADMIN";

  const hasPermission = (permission: string, opts?: ViewingOpt): boolean => {
    if (viewing && !opts?.evenWhileViewing && !READ_ONLY_CODENAME.test(permission)) return false;
    if (roleIsAdmin) return true;
    return user?.permissions?.includes(permission) ?? false;
  };

  const hasAnyPermission = (permissions: string[], opts?: ViewingOpt): boolean => {
    return permissions.some((p) => hasPermission(p, opts));
  };

  const hasAllPermissions = (permissions: string[], opts?: ViewingOpt): boolean => {
    return permissions.every((p) => hasPermission(p, opts));
  };

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    // Exposed so a gate that really is about the role can say so, instead of
    // passing the string "ADMIN" to a codename check and relying on the
    // short-circuit above. See RequireAdmin. 代看 / 进殿查看时为假(后端 is_tenant_exempt 同样为假)。
    isAdmin: roleIsAdmin && !viewing,
    permissions: user?.permissions ?? [],
  };
}
