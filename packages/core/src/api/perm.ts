import { api } from "./client";
import type { components } from "./generated/schema";

export interface Permission {
  id: number;
  codename: string;
  name: string;
  category: string;
}

/**
 * RoleSerializer (backend/apps/perm/serializers.py). A role's data scope is
 * `dataScopeApi` (RoleDataScope); the old scope / organization / parent
 * columns went in 数据范围 B7.
 */
export interface Role {
  id: number;
  name: string;
  display_name: string;
  /** 角色表抽屉的「说明」(E-11b)。可空;只 ADMIN 能改。 */
  description: string;
  /**
   * Users currently assigned this role name (active only — User.role is a
   * plain CharField, not a FK, see RoleSerializer.get_user_count). Added for
   * the permissions-matrix screen's save-confirmation guard: turns a
   * grant/removal from an abstract diff into "N users affected".
   */
  user_count: number;
  /**
   * Every non-deleted holder, active or not — the number DELETE refuses over
   * (`role_in_use`). `user_count` above counts active holders only.
   */
  member_count: number;
  /** RolePermission rows — the matrix's ticks, not ADMIN's effective set. */
  permission_count: number;
  /** Workflow templates with a step whose `approver_role` is this role. */
  workflow_template_count: number;
  /**
   * One of the built-in `UserRole` constants the backend compares by literal
   * (`role === "ADMIN"` in the checker, tenant scoping, IsAdminPermission…).
   * The server refuses to delete these (400 `builtin_role`). No role's `name`
   * (its code) can change after creation — built-in or not; a PUT with a
   * different name is a 400 whose `name[0]` is the immutability message.
   * "Copy as new role" (`permApi.roles.copy`) is the way to a new code.
   */
  is_builtin: boolean;
  /**
   * Optimistic-lock counter, bumped by AuditUserFields on every save. Send
   * the value the matrix loaded back as `expected_version` on
   * assign_role_permissions — a mismatch means another admin's save landed
   * first, and the endpoint answers 409 instead of silently reverting it.
   */
  version: number;
  update_time: string;
}

/**
 * Body shared by GET /perm/role-permissions/ and
 * GET /perm/roles/{name}/permissions/ — the two views return the same three
 * keys on purpose (backend/apps/perm/views.py:110 and :140).
 */
export interface RolePermissions {
  role: string;
  permissions: string[];
  details: Permission[];
  /** `GET /perm/role-permissions/` only (the caller's own): who they are now — the web refreshes these on focus. */
  id?: number;
  tenant?: { code: string; display_name: string; civilization?: string; seal_glyphs?: string[] } | null;
  extra_roles?: string[];
}

/** 200 body of POST /perm/role-permissions/assign/ (views.py:195). */
export interface PermissionAssignResult {
  role: string;
  assigned_count: number;
  permission_ids: number[];
  /** The NEW version after this save — persist it for the next assign call. */
  version: number;
}

/**
 * 409 body of POST /perm/role-permissions/assign/ when `expected_version`
 * doesn't match the role's current version (views.py: assign_role_permissions).
 * Thrown as an axios error; `err.response.data` has this shape.
 */
export interface RolePermissionConflict {
  error: string;
  expected_version: number;
  current_version: number;
}

type Schemas = components["schemas"];

/**
 * 200 body of POST /perm/import/ - 每段 `{created, skipped}`,外加 `skipped_details`
 * (哪一段、哪个标识、为什么没加)。`dry_run` 时形状相同,但什么都没写。
 */
export type PermissionImportResult = Schemas["PermissionImportResult"];
export type PermissionImportSkipped = Schemas["PermissionImportSkipped"];

/** 导出文档(`GET /perm/export/` 的 body),去掉 `overwrite` / `dry_run` —— 导入时由 `importConfig` 的参数给。 */
export type PermissionImportDocument = Omit<Schemas["PermissionImportRequest"], "overwrite" | "dry_run">;

/**
 * Per-cell matrix save — POST /perm/role-permissions/changes/
 * (backend/apps/perm/matrix.py). One result per change, in request order:
 * `saved`, `unchanged` (the cell was already in that state), `refused` with a
 * `code` (`role_not_found` / `permission_not_found` / `version_conflict` /
 * `admin_only_permission`: recycle-bin restore / hard delete to a non-ADMIN role /
 * `admin_always_all`: any revoke on an ADMIN cell) or
 * `failed` (`database_error`, that cell rolled back alone). 200 whatever the
 * mix; `versions` is each named role's version after the call.
 */
export type MatrixChange = Schemas["MatrixChange"];

/** The role whose every cell is 「始终」: `check_permission` answers yes before reading a grant, so the matrix cannot untick it. */
export const ADMIN_ROLE_NAME = "ADMIN";
/**
 * Codenames a role may never be granted — a copy of `ROLE_FORBIDDEN_CODENAMES`
 * in backend/apps/perm/checker.py, pinned to it by `roleForbiddenCodenamesMatchBackend.test.ts`.
 * The matrix draws these 「! 禁授」 from the start, before anyone tries.
 */
export const ROLE_FORBIDDEN_CODENAMES: Readonly<Record<string, readonly string[]>> = {
  MODERATOR: ["user.manage"],
};
/**
 * 「设计流程的人不审批」按能力,不按角色名(2026-10-29 第 13 条;backend/apps/perm/checker.py 的
 * `WORKFLOW_DESIGN_CODENAMES` / `WORKFLOW_APPROVE_CODENAMES` / `capability_conflicts`):同一个角色持有设计码,
 * 就不能再持有审批码;已持审批码的角色不能再被授设计码。ADMIN 不受限。
 */
export const WORKFLOW_DESIGN_CODENAMES: readonly string[] = ["workflow.create", "workflow.update"];
export const WORKFLOW_APPROVE_CODENAMES: readonly string[] = ["workflow.approve", "workflow.advance"];

/** Whether `codename` may not be granted to `role` beside `held` (its other grants, unsaved ticks included). */
export function capabilityForbids(role: string, codename: string, held: ReadonlySet<string>): boolean {
  if (role === ADMIN_ROLE_NAME) return false;
  const holdsDesign = WORKFLOW_DESIGN_CODENAMES.some((c) => held.has(c));
  if (WORKFLOW_APPROVE_CODENAMES.includes(codename)) return holdsDesign;
  if (WORKFLOW_DESIGN_CODENAMES.includes(codename)) return !holdsDesign && WORKFLOW_APPROVE_CODENAMES.some((c) => held.has(c));
  return false;
}
export type MatrixChangeResult = Schemas["MatrixChangeResult"];
export type MatrixChangesResult = Schemas["MatrixChangesResult"];
/**
 * "What breaks" — POST /perm/role-permissions/impact/, read-only. Each
 * conflict is a template step that some role could approve before the
 * changes and none can after, with the revokes (`caused_by[].index` into the
 * request's `changes`) that cause it.
 */
export type MatrixImpactResult = Schemas["MatrixImpactResult"];
export type MatrixConflict = Schemas["MatrixConflict"];
/** A live workflow's pending ROLE node the changes would leave with no approver. */
export type MatrixWorkflowConflict = Schemas["MatrixWorkflowConflict"];
/**
 * 400 body of DELETE /perm/roles/{id}/. `templates` comes with
 * `role_referenced_by_workflow_templates`, `user_count` with `role_in_use`.
 */
export type RoleDeleteRefusal = Schemas["RoleDeleteRefusal"];
/** GET /perm/roles/{id}/members/: holders of the role, main-role holders first. */
export type RoleMembersPage = Schemas["RoleMembersPage"];
/** POST /perm/roles/{id}/members/ body. `primary` replaces the user's main role; a main role cannot be removed. */
export type RoleMembersChange = Schemas["RoleMembersChange"];
export type RoleMembersChangeResult = Schemas["RoleMembersChangeResult"];
/** 400 / 403 body of that POST: nobody in the batch was changed; one line per refused user. */
export type RoleMembersRefused = Schemas["RoleMembersRefused"];
export type RoleCopyPayload = Pick<Role, "name" | "display_name">;

export const permApi = {
  // Current user's own role permissions (self only — see backend docstring
  // on get_role_permissions for the enumeration guard). Used to refetch the
  // permission list after session rehydration, since it's deliberately not
  // persisted to localStorage.
  myRolePermissions: () => api.get<RolePermissions>("/perm/role-permissions/"),

  // Permission CRUD (flat structure for backward compatibility).
  // The list route is a plain @api_view(["GET"]) function, so it answers
  // with a bare array rather than a pagination envelope. Create is a
  // separate @api_view(["POST"]) route — /perm/permissions/ itself is
  // GET-only and 405s on POST (backend/apps/perm/urls.py).
  list: () => api.get<Permission[]>("/perm/permissions/"),
  create: (data: Partial<Permission>) => api.post<Permission>("/perm/permissions/create/", data),
  update: (id: number, data: Partial<Permission>) => api.put<Permission>(`/perm/permissions/${id}/`, data),
  delete: (id: number) => api.delete<void>(`/perm/permissions/${id}/`),

  // Role CRUD
  roles: {
    list: () => api.get<Role[]>("/perm/roles/"),
    // Same story as permissions.create — /perm/roles/ is GET-only.
    create: (data: Partial<Role>) => api.post<Role>("/perm/roles/create/", data),
    update: (id: number, data: Partial<Role>) => api.put<Role>(`/perm/roles/${id}/`, data),
    delete: (id: number) => api.delete<void>(`/perm/roles/${id}/`),
    /** 复制为新角色: same RolePermission rows, new code. 201 with the new Role. */
    copy: (id: number, data: RoleCopyPayload) => api.post<Role>(`/perm/roles/${id}/copy/`, data),
    /** ADMIN; a hall's ADMIN sees and changes its own hall's users only. */
    members: (id: number, params: { search?: string; page?: number }) =>
      api.get<RoleMembersPage>(`/perm/roles/${id}/members/`, { params }),
    changeMembers: (id: number, body: RoleMembersChange) =>
      api.post<RoleMembersChangeResult>(`/perm/roles/${id}/members/`, body),
  },

  /**
   * Per-cell save. `expectedVersions` maps role name → the version the matrix loaded.
   * Without `acknowledgeConflicts`, a revoke the impact check names as a conflict's
   * cause comes back refused `conflict_unacknowledged`.
   */
  applyChanges: (changes: MatrixChange[], expectedVersions?: Record<string, number>, acknowledgeConflicts?: boolean) =>
    api.post<MatrixChangesResult>("/perm/role-permissions/changes/", {
      changes,
      ...(expectedVersions ? { expected_versions: expectedVersions } : {}),
      ...(acknowledgeConflicts ? { acknowledge_conflicts: true } : {}),
    }),
  /** Read-only pre-check: template steps these changes would leave without an approver. */
  impact: (changes: MatrixChange[]) =>
    api.post<MatrixImpactResult>("/perm/role-permissions/impact/", { changes }),

  // Role-Permission assignment.
  // Read and write sit on different routes: the reader is ADMIN-only and keyed
  // by role name in the path, while the writer takes the role in its body.
  rolePermissions: (roleName: string) => api.get<RolePermissions>(`/perm/roles/${roleName}/permissions/`),
  /** Every role's grants in one call, same shape per role as `rolePermissions` (ADMIN only). */
  allRolePermissions: () => api.get<RolePermissions[]>("/perm/role-permissions/all/"),
  // `expectedVersion` is optional so existing callers keep working, but the
  // matrix screen always sends it — it's the stale-write guard (see
  // RolePermissionConflict above). Omitted entirely (not sent as undefined)
  // when not provided, matching RolePermissionAssignSerializer's optional field.
  assign: (roleName: string, permissionIds: number[], expectedVersion?: number) =>
    api.post<PermissionAssignResult>("/perm/role-permissions/assign/", {
      role: roleName,
      permission_ids: permissionIds,
      ...(expectedVersion !== undefined ? { expected_version: expectedVersion } : {}),
    }),

  /**
   * 导出全部权限配置(仅 ADMIN)。body 是 `PermissionExport` 这份 JSON 文档;
   * 以附件形式返回,客户端用 blob 接。不分租户:Permission / Role 两张表本身无租户字段。
   */
  exportConfig: () => api.get<Blob>("/perm/export/", { responseType: "blob" }),
  /**
   * 导入权限配置(仅 ADMIN)。body 是 JSON 文档本身(不是 multipart)。
   * `overwrite` 默认 **false**:只合并,get_or_create 语义,已有的行不动、不删。
   * 覆盖(`true`)会删光字段权限、行级数据范围与除 ADMIN 外的全部授权再按文件重建 —— 只由导入弹层
   * 在用户选了「覆盖」、对上殿名之后传;任何别的路径不传。
   * `dryRun`:后端跑完整合并再回滚,返回同形状的 stats,不留任何行(导入弹层的摘要步);
   * 与 `overwrite` 同用时 stats 里有 `updated` / `removed` / `removes_own_permissions`。
   */
  importConfig: (document: PermissionImportDocument, dryRun = false, overwrite = false) =>
    api.post<PermissionImportResult>("/perm/import/", { ...document, overwrite, dry_run: dryRun }),
};
