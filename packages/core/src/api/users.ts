import axios from "axios";
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
  /** 兼任角色(角色名)。权限 = `role` 与这里每个角色的并集;列表 / 详情都带。 */
  extra_roles?: string[];
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
  /** The assistant admin's eval officer (apps/soul_assist/eval_identities.py). List / retrieve only: the create and
   *  update serializers do not carry it, so it is absent on their responses. */
  is_eval_identity?: boolean;
  /** 两步验证列(A12):three states = enabled / required. List and retrieve only. */
  mfa?: UserMfaRef;
}

export interface UserMfaRef {
  enabled: boolean;
  required: boolean;
  confirmed_at: string | null;
  last_used_at: string | null;
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
}

/** POST /users/{id}/assign_roles/ —— 至少给一项。`extra_roles` 整表替换(`[]` 清空);不含 ADMIN / SOUL。 */
export interface AssignRolesInput {
  role?: string;
  extra_roles?: string[];
}

/** 200 body of POST /users/batch_activate/ and /batch_deactivate/. 管理员账号与自己不在批量范围内。 */
export interface UserBatchUpdateResult {
  updated: number;
}

export interface UserFilters {
  page?: number;
  role?: string;
  is_active?: boolean;
  search?: string;
  /** Exact username (not a contains-search): `/users?username=<u>` locates one account. */
  username?: string;
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

/** One row of the import preview (`dry_run=1`); `errors[].code` are `users.import.row_codes.*`. Never carries the password. */
export interface UserImportRow {
  row: number;
  status: "ok" | "error";
  values: { username: string; display_name: string };
  errors: { field: string; code: string }[];
}

/** 200 body of POST /users/import_csv/ with `dry_run=1`: nothing written. */
export interface UserImportPreview {
  total: number;
  ok_count: number;
  error_count: number;
  rows: UserImportRow[];
}

/** 400 body: the file as a whole is unusable (`bad_encoding` / `empty_file` / `missing_columns`). */
export interface UserImportFileError {
  code: string;
  columns?: string[];
}

export function userImportFileErrorOf(error: unknown): UserImportFileError | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 400) return null;
  const data = error.response.data as Partial<UserImportFileError> | undefined;
  return data && typeof data.code === "string" ? (data as UserImportFileError) : null;
}

export const usersApi = {
  list: (params?: Record<string, string | number | undefined>) => api.get<PaginatedResponse<User>>("/users/", { params }),
  get: (id: string) => api.get<User>(`/users/${id}/`),
  create: (data: CreateUserInput) => api.post<User>("/users/", data),
  update: (id: string, data: UpdateUserInput) => api.patch<User>(`/users/${id}/`, data),
  delete: (id: string) => api.delete<void>(`/users/${id}/`),
  activate: (id: string) => api.post<User>(`/users/${id}/activate/`),
  deactivate: (id: string) => api.post<User>(`/users/${id}/deactivate/`),
  assignRoles: (id: string, data: AssignRolesInput) => api.post<User>(`/users/${id}/assign_roles/`, data),
  batchActivate: (userIds: string[]) => api.post<UserBatchUpdateResult>("/users/batch_activate/", { user_ids: userIds }),
  batchDeactivate: (userIds: string[]) => api.post<UserBatchUpdateResult>("/users/batch_deactivate/", { user_ids: userIds }),
  export: () => api.get<Blob>("/users/export_csv/", { responseType: "blob" }),
  /** `user.manage`. 200 `{password}`: a random password, shown once; the officer must change it at next login and
   *  every other session of theirs is ended. */
  resetPassword: (id: string | number) => api.post<{ password: string }>(`/users/${id}/reset_password/`),
  /** ADMIN. Clears the authenticator, recovery codes and 「不再询问」 devices, revokes every refresh token;
   *  the reason is required and audited. 409 `not_enabled` on a row that has it off. */
  resetMfa: (id: string | number, reason: string) => api.post<{ detail: string }>(`/users/${id}/reset-mfa/`, { reason }),
  /** The import's first step: same row checks as `import`, nothing written. */
  // `dry_run` rides in the query: core has no DOM types, so the FormData it is handed can only be passed through.
  importPreview: (data: FormData) =>
    api.post<UserImportPreview>("/users/import_csv/?dry_run=1", data, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  import: (data: FormData) => api.post<UserImportResult>("/users/import_csv/", data, {
    headers: { "Content-Type": "multipart/form-data" },
  }),
};
