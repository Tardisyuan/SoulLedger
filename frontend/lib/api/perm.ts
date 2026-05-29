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
  // Permission CRUD (flat structure for backward compatibility)
  list: () => api.get("/perm/permissions/"),
  create: (data: Partial<Permission>) => api.post("/perm/permissions/", data),
  update: (id: number, data: Partial<Permission>) => api.patch(`/perm/permissions/${id}/`, data),
  delete: (id: number) => api.delete(`/perm/permissions/${id}/`),

  // Role CRUD
  roles: {
    list: () => api.get("/perm/roles/"),
    create: (data: Partial<Role>) => api.post("/perm/roles/", data),
    update: (id: number, data: Partial<Role>) => api.patch(`/perm/roles/${id}/`, data),
    delete: (id: number) => api.delete(`/perm/roles/${id}/`),
    getPermissions: (name: string) => api.get(`/perm/roles/${name}/permissions/`),
    assignPermissions: (name: string, data: { permission_ids: number[] }) =>
      api.post(`/perm/roles/${name}/assign/`, data),
  },

  // Role-Permission assignment
  rolePermissions: (roleName: string) => api.get(`/perm/roles/${roleName}/permissions/`),
  assign: (roleName: string, permissionIds: number[]) =>
    api.post(`/perm/roles/${roleName}/assign/`, { permission_ids: permissionIds }),

  // Export/Import
  export: () => api.get("/perm/export/", { responseType: "blob" }),
  import: (data: FormData) => api.post("/perm/import/", data, {
    headers: { "Content-Type": "multipart/form-data" },
  }),
};
