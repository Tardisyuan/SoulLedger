import { api } from "./client";

export interface Permission {
  id: number;
  codename: string;
  name: string;
  category: string;
}

export interface Role {
  id: number;
  name: string;
  display_name: string;
  parent: number | null;
  scope: string;
  organization: number | null;
}

export const permApi = {
  // Current user's own role permissions (self only — see backend docstring
  // on get_role_permissions for the enumeration guard). Used to refetch the
  // permission list after session rehydration, since it's deliberately not
  // persisted to localStorage.
  myRolePermissions: () => api.get("/perm/role-permissions/"),

  // Permission CRUD (flat structure for backward compatibility)
  list: () => api.get("/perm/permissions/"),
  create: (data: Partial<Permission>) => api.post("/perm/permissions/", data),
  update: (id: number, data: Partial<Permission>) => api.put(`/perm/permissions/${id}/`, data),
  delete: (id: number) => api.delete(`/perm/permissions/${id}/`),

  // Role CRUD
  roles: {
    list: () => api.get("/perm/roles/"),
    create: (data: Partial<Role>) => api.post("/perm/roles/", data),
    update: (id: number, data: Partial<Role>) => api.put(`/perm/roles/${id}/`, data),
    delete: (id: number) => api.delete(`/perm/roles/${id}/`),
  },

  // Role-Permission assignment.
  // Read and write sit on different routes: the reader is ADMIN-only and keyed
  // by role name in the path, while the writer takes the role in its body.
  rolePermissions: (roleName: string) => api.get(`/perm/roles/${roleName}/permissions/`),
  assign: (roleName: string, permissionIds: number[]) =>
    api.post("/perm/role-permissions/assign/", {
      role: roleName,
      permission_ids: permissionIds,
    }),

  // Export/Import
  export: () => api.get("/perm/export/", { responseType: "blob" }),
  import: (data: FormData) => api.post("/perm/import/", data, {
    headers: { "Content-Type": "multipart/form-data" },
  }),
};
