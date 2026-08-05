import { api } from "./client";

/** User.role choices (backend/apps/authentication/models.py:17). */
export type UserRole = "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER";

/** The `user` object embedded in the login response (CustomTokenObtainPairSerializer). */
export interface LoginUser {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  tenant: { code: string; display_name: string } | null;
  display_name: string;
  permissions: string[];
}

/** 200 body of POST /auth/login/ (backend/apps/authentication/serializers.py:94). */
export interface LoginResponse {
  access: string;
  refresh: string;
  user: LoginUser;
}

/**
 * UserSerializer (backend/apps/authentication/serializers.py:142) — the
 * /auth/profile/ shape. Note `organization` is the raw FK id here, unlike
 * UserManagementSerializer on /users/ where it is an object.
 */
export interface AuthProfile {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  first_name: string;
  last_name: string;
  is_active: boolean;
  display_name: string;
  organization: number | null;
  position: string;
}

export const authApi = {
  login: (usernameOrData: string | { username: string; password: string }, password?: string) => {
    const data = typeof usernameOrData === "string"
      ? { username: usernameOrData, password: password! }
      : usernameOrData;
    return api.post<LoginResponse>("/auth/login/", data);
  },
  // 201 body is UserSerializer, not the login envelope — registering does not
  // hand back tokens (backend/apps/authentication/views.py:492).
  register: (data: object) => api.post<AuthProfile>("/auth/register/", data),
  // SIMPLE_JWT rotates refresh tokens, so the body carries a new `refresh`
  // as well as `access`.
  refresh: (data: { refresh: string }) => api.post<{ access: string; refresh: string }>("/auth/refresh/", data),
  logout: () => api.post<{ detail: string }>("/auth/logout/"),
  profile: () => api.get<AuthProfile>("/auth/profile/"),
  updateProfile: (data: object) => api.patch<AuthProfile>("/auth/profile/", data),
  changePassword: (oldPasswordOrData: string | { old_password: string; new_password: string }, newPassword?: string) => {
    const data = typeof oldPasswordOrData === "string"
      ? { old_password: oldPasswordOrData, new_password: newPassword! }
      : oldPasswordOrData;
    return api.post<{ detail: string }>("/auth/change-password/", data);
  },
};
