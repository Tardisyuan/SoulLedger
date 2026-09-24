import { api } from "./client";
import type { components } from "./generated/schema";

export interface Permission {
  id: number;
  codename: string;
  name: string;
  category: string;
}

/**
 * RoleSerializer (backend/apps/perm/serializers.py:43).
 *
 * `parent` was declared here but is NOT in the serializer's field list — the
 * Role model has a self-FK (models.py:65) and it is simply never exposed, so
 * the field could only ever read back as undefined. `organization_name` is
 * the one the serializer does add (`source='organization.name'`).
 */
export interface Role {
  id: number;
  name: string;
  display_name: string;
  scope: string;
  organization: number | null;
  organization_name: string | null;
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

/** 200 body of POST /perm/import/ (views.py:401, stats from export.py:87). */
export interface PermissionImportResult {
  message: string;
  stats: {
    permissions: number;
    roles: number;
    role_permissions: number;
    field_permissions: number;
    data_scopes: number;
  };
}

type Schemas = components["schemas"];

/**
 * Per-cell matrix save — POST /perm/role-permissions/changes/
 * (backend/apps/perm/matrix.py). One result per change, in request order:
 * `saved`, `unchanged` (the cell was already in that state), `refused` with a
 * `code` (`role_not_found` / `permission_not_found` / `version_conflict` /
 * `admin_only_permission`: recycle-bin restore / hard delete to a non-ADMIN role) or
 * `failed` (`database_error`, that cell rolled back alone). 200 whatever the
 * mix; `versions` is each named role's version after the call.
 */
export type MatrixChange = Schemas["MatrixChange"];
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
/**
 * 400 body of DELETE /perm/roles/{id}/. `templates` comes with
 * `role_referenced_by_workflow_templates`, `user_count` with `role_in_use`.
 */
export type RoleDeleteRefusal = Schemas["RoleDeleteRefusal"];
export type RoleCopyPayload = Pick<Role, "name" | "display_name"> & Partial<Pick<Role, "scope" | "organization">>;

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
  },

  /** Per-cell save. `expectedVersions` maps role name → the version the matrix loaded. */
  applyChanges: (changes: MatrixChange[], expectedVersions?: Record<string, number>) =>
    api.post<MatrixChangesResult>("/perm/role-permissions/changes/", {
      changes,
      ...(expectedVersions ? { expected_versions: expectedVersions } : {}),
    }),
  /** Read-only pre-check: template steps these changes would leave without an approver. */
  impact: (changes: MatrixChange[]) =>
    api.post<MatrixImpactResult>("/perm/role-permissions/impact/", { changes }),

  // Role-Permission assignment.
  // Read and write sit on different routes: the reader is ADMIN-only and keyed
  // by role name in the path, while the writer takes the role in its body.
  rolePermissions: (roleName: string) => api.get<RolePermissions>(`/perm/roles/${roleName}/permissions/`),
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

  // Export/Import
  export: () => api.get<Blob>("/perm/export/", { responseType: "blob" }),
  import: (data: FormData) => api.post<PermissionImportResult>("/perm/import/", data, {
    headers: { "Content-Type": "multipart/form-data" },
  }),
};
