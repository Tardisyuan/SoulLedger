import { api } from "./client";

/**
 * UserManagementSerializer (backend/apps/authentication/serializers.py:154) —
 * the read shape for every /users/ route.
 *
 * `tenant` and `organization` are both SerializerMethodFields returning an
 * object or null, not FK ids. `organization` was declared here as `number`.
 *
 * first_name/last_name are now in the serializer's field list (fixed
 * alongside UserCreateSerializer/UserUpdateSerializer — all three admin-
 * management serializers were missing them; the self-profile serializer in
 * the same file always had them). display_name/permissions/tenant_id are
 * still NOT in the field list and never arrive; kept optional for that
 * reason only.
 */
export interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  tenant?: { id?: number; code: string; display_name: string } | null;
  tenant_id?: number;
  display_name?: string;
  permissions?: string[];
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
  organization?: { id: number; code: string; name: string } | null;
  position?: string;
  avatar?: string;
  create_time?: string;
}

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  tenant?: number;
  tenant_id?: number;
  display_name?: string;
  organization?: number;
  position?: string;
}

export interface UpdateUserInput {
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  is_active?: boolean;
  tenant?: number;
  tenant_id?: number;
  organization?: number;
  position?: string;
  password?: string;
}

export interface UserFilters {
  page?: number;
  role?: string;
  is_active?: boolean;
  search?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** 200 body of POST /users/import_csv/. */
export interface UserImportResult {
  created: number;
  errors: string[];
}

export const usersApi = {
  list: (params?: Record<string, string | number | undefined>) => api.get<PaginatedResponse<User>>("/users/", { params }),
  get: (id: string) => api.get<User>(`/users/${id}/`),
  create: (data: CreateUserInput) => api.post<User>("/users/", data),
  update: (id: string, data: UpdateUserInput) => api.patch<User>(`/users/${id}/`, data),
  delete: (id: string) => api.delete<void>(`/users/${id}/`),
  activate: (id: string) => api.post<User>(`/users/${id}/activate/`),
  deactivate: (id: string) => api.post<User>(`/users/${id}/deactivate/`),
  export: () => api.get<Blob>("/users/export_csv/", { responseType: "blob" }),
  import: (data: FormData) => api.post<UserImportResult>("/users/import_csv/", data, {
    headers: { "Content-Type": "multipart/form-data" },
  }),
};
