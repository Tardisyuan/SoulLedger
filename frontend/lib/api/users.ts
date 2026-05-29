import { api } from "./client";

export interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  tenant?: { code: string; display_name: string };
  display_name?: string;
  permissions?: string[];
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
  organization?: number;
  position?: string;
  avatar?: string;
  create_time?: string;
}

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  role?: string;
  tenant?: number;
  display_name?: string;
}

export interface UpdateUserInput {
  email?: string;
  role?: string;
  is_active?: boolean;
  organization?: number;
  position?: string;
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

export const usersApi = {
  list: (params?: Record<string, string | number | undefined>) => api.get("/users/", { params }),
  get: (id: string) => api.get(`/users/${id}/`),
  create: (data: CreateUserInput) => api.post("/users/", data),
  update: (id: string, data: UpdateUserInput) => api.patch(`/users/${id}/`, data),
  delete: (id: string) => api.delete(`/users/${id}/`),
  activate: (id: string) => api.post(`/users/${id}/activate/`),
  deactivate: (id: string) => api.post(`/users/${id}/deactivate/`),
  export: () => api.get("/users/export_csv/", { responseType: "blob" }),
  import: (data: FormData) => api.post("/users/import_csv/", data, {
    headers: { "Content-Type": "multipart/form-data" },
  }),
};
