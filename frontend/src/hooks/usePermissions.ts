"use client";

import { useTenant } from "@/src/contexts/TenantContext";
import { READ_ONLY_CODENAME, useImpersonation } from "@/src/components/impersonation/useImpersonation";
import { isAdminRole, isSystemAdminRole } from "@soulledger/core/domain/roles";
import { TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";

type ViewingOpt = { evenWhileViewing?: boolean };

/**
 * 后端 `perm/checker.py` 的 `GLOBAL_ONLY_CODENAMES` 镜像:全站共用的配置(菜单是所有殿共用的一棵树),
 * 只有 SYSTEM_ADMIN 持有(后端 `is_tenant_exempt`,分殿 1A 起不含无殿 ADMIN),任何角色都授不到 —— 绑殿 ADMIN、
 * 文明 ADMIN 都不行。此前前端对 ADMIN 一律放行,绑殿 ADMIN 看得到菜单的增改删,点下去 403(P-07)。后端加一个码,这里跟着加。
 */
export const GLOBAL_ONLY_CODENAMES: ReadonlySet<string> = new Set(["menu.manage", "system.cross_civilization"]);

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
  const { user, permissionsReady = true, permissionsFailed = false } = useTenant();
  const viewing = useImpersonation() !== null;

  // One expression, read twice. It used to be written out twice — once here as
  // the short-circuit and once in the returned object — so "what counts as an
  // administrator" had two definitions inside a single 34-line file. They could
  // not disagree, which is exactly why nothing would have reported it if they
  // started to.
  // SYSTEM_ADMIN 过每一道 ADMIN 的门(分殿 1A)。
  const roleIsAdmin = isAdminRole(user?.role);
  // 后端 `is_tenant_exempt`:无殿的 SYSTEM_ADMIN。
  const hallLessSystem = isSystemAdminRole(user?.role) && !user?.tenant;

  const hasPermission = (permission: string, opts?: ViewingOpt): boolean => {
    if (viewing && !opts?.evenWhileViewing && !READ_ONLY_CODENAME.test(permission)) return false;
    // 不读上报的清单(双保险):后端上报曾对绑殿 ADMIN 也含这个码(RoleHolder 没有殿),2026-11-11 起按用户的殿报。
    // 与后端集合一致由 roleForbiddenCodenamesMatchBackend.test.ts 守着。
    if (GLOBAL_ONLY_CODENAMES.has(permission)) return hallLessSystem;
    if (roleIsAdmin) return true;
    return user?.permissions?.includes(permission) ?? false;
  };

  const hasAnyPermission = (permissions: string[], opts?: ViewingOpt): boolean => {
    return permissions.some((p) => hasPermission(p, opts));
  };

  const hasAllPermissions = (permissions: string[], opts?: ViewingOpt): boolean => {
    return permissions.every((p) => hasPermission(p, opts));
  };

  const isSystemAdmin = hallLessSystem && !viewing;
  const isCivilizationAdmin = user?.role === "ADMIN" && !user?.tenant && !viewing;
  /** `hallCivilization`:这一殿的文明(后端 `Tenant.civilization`,殿列表的行带着)。不给时只认得四个种子殿
   *  (`TENANT_CODE_TO_CIVILIZATION`),别的殿答假(按钮不出,不会误开)。 */
  const ownsHall = (hallCode: string | null | undefined, hallCivilization?: string | null): boolean => {
    if (isSystemAdmin) return true;
    if (!hallCode) return false;
    if (user?.tenant?.code === hallCode) return true;
    const civ = hallCivilization || TENANT_CODE_TO_CIVILIZATION[hallCode];
    return isCivilizationAdmin && !!user?.civilization && civ === user.civilization;
  };

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    // Exposed so a gate that really is about the role can say so, instead of
    // passing the string "ADMIN" to a codename check and relying on the
    // short-circuit above. See RequireAdmin. 代看 / 进殿查看时为假(后端 is_tenant_exempt 同样为假)。
    isAdmin: roleIsAdmin && !viewing,
    // 两个 helper 对应后端 tests/tenancy_exempt_sites.py 的两种标签,代看 / 进殿查看时都为假(那时看的是别的殿)。
    // SYSTEM_ONLY(菜单、权限配置导入与数据范围、开殿与建殿、调度重建、跨殿复制敏感词、助手供应商):只问 `isSystemAdmin`。
    isSystemAdmin,
    // 无殿 ADMIN = 文明管理员(后端 `is_civilization_admin`):本文明各殿算自己的,别的文明与无殿的行不算。
    isCivilizationAdmin,
    // CIVILIZATION(移交详情 / 撤回、联审「发起方」……):这一殿算不算「本殿」。后端 `reaches_hall` 加上绑殿者自己那一殿。
    ownsHall,
    permissions: user?.permissions ?? [],
    /** 刷新后权限还没从服务端回来(见 TenantContext)。`hasPermission` 不看它;画拒绝页之前看。 */
    permissionsReady,
    /** 加载时那一次没读到权限(第六十一批 E2):拒绝页换成「权限没读到」。`hasPermission` 不看它。 */
    permissionsFailed,
  };
}
