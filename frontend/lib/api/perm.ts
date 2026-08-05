import { api } from "./client";

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

export const permApi = {
  // Current user's own role permissions (self only — see backend docstring
  // on get_role_permissions for the enumeration guard). Used to refetch the
  // permission list after session rehydration, since it's deliberately not
  // persisted to localStorage.
  myRolePermissions: () => api.get<RolePermissions>("/perm/role-permissions/"),

  // Permission CRUD (flat structure for backward compatibility).
  // Both list routes are plain @api_view(["GET"]) functions, so they answer
  // with a bare array rather than a pagination envelope.
  list: () => api.get<Permission[]>("/perm/permissions/"),
  create: (data: Partial<Permission>) => api.post<Permission>("/perm/permissions/", data),
  update: (id: number, data: Partial<Permission>) => api.put<Permission>(`/perm/permissions/${id}/`, data),
  delete: (id: number) => api.delete<void>(`/perm/permissions/${id}/`),

  // Role CRUD
  roles: {
    list: () => api.get<Role[]>("/perm/roles/"),
    create: (data: Partial<Role>) => api.post<Role>("/perm/roles/", data),
    update: (id: number, data: Partial<Role>) => api.put<Role>(`/perm/roles/${id}/`, data),
    delete: (id: number) => api.delete<void>(`/perm/roles/${id}/`),
  },

  // Role-Permission assignment.
  // Read and write sit on different routes: the reader is ADMIN-only and keyed
  // by role name in the path, while the writer takes the role in its body.
  rolePermissions: (roleName: string) => api.get<RolePermissions>(`/perm/roles/${roleName}/permissions/`),
  assign: (roleName: string, permissionIds: number[]) =>
    api.post<PermissionAssignResult>("/perm/role-permissions/assign/", {
      role: roleName,
      permission_ids: permissionIds,
    }),

  // Export/Import
  export: () => api.get<Blob>("/perm/export/", { responseType: "blob" }),
  import: (data: FormData) => api.post<PermissionImportResult>("/perm/import/", data, {
    headers: { "Content-Type": "multipart/form-data" },
  }),
};
