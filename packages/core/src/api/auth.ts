import { api } from "./client";
import { getRefreshToken } from "../platform/index";

/**
 * The five BUILT-IN roles — `apps.authentication.models.UserRole`.
 *
 * MODERATOR WAS MISSING, AGAIN. This repository has been here before: the
 * model's own docstring records that "MODERATOR was missing here while three
 * other places already knew about it", `app/users/page.tsx` carries a note
 * about a MODERATOR row rendering as "unrecognised value", and
 * `app/audit/page.tsx` records a MODERATOR being shown "仅管理员可查看审计"
 * for a permission the backend grants them. Each of those was fixed where it
 * was found; this shared type was the last copy still short a member.
 *
 * Since 2026-09-12 (BP-06/07/11) these five are the roles whose NAMES are
 * fixed — the backend compares them by literal and refuses to rename or
 * delete them — not the set of values `User.role` can hold. That set is the
 * role table, so `UserRole` below is `string` and the selectors on the users
 * screen read `permApi.roles.list()` instead of restating this list. The
 * backend no longer emits a `UserRoleEnum` component, which is why this union
 * left `enumsMatchTheSchema.test.ts`.
 */
export type BuiltinUserRole =
  | "ADMIN"
  | "MODERATOR"
  | "JUDGE"
  | "GUARDIAN"
  | "VIEWER";

/** `User.role`: a built-in, or the `name` of any live row in the role table. */
export type UserRole = BuiltinUserRole | (string & {});

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
  // logout_view (backend/apps/authentication/views.py) blacklists whatever
  // refresh token is in the body; without one it silently no-ops and the
  // token stays valid. Read it from the same cookie the login flow writes to.
  logout: () => api.post<{ detail: string }>("/auth/logout/", { refresh: getRefreshToken() }),
  profile: () => api.get<AuthProfile>("/auth/profile/"),
  updateProfile: (data: object) => api.patch<AuthProfile>("/auth/profile/", data),
  changePassword: (oldPasswordOrData: string | { old_password: string; new_password: string }, newPassword?: string) => {
    const data = typeof oldPasswordOrData === "string"
      ? { old_password: oldPasswordOrData, new_password: newPassword! }
      : oldPasswordOrData;
    return api.post<{ detail: string }>("/auth/change-password/", data);
  },
};
