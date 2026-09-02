import { api } from "./client";
import { getRefreshToken } from "../platform/index";

/** User.role choices (backend/apps/authentication/models.py:17). */
/**
 * `apps.authentication.models.UserRole`, all five members.
 *
 * MODERATOR WAS MISSING, AGAIN. This repository has been here before: the
 * model's own docstring records that "MODERATOR was missing here while three
 * other places already knew about it", `app/users/page.tsx` carries a note
 * about a MODERATOR row rendering as "unrecognised value", and
 * `app/audit/page.tsx` records a MODERATOR being shown "仅管理员可查看审计"
 * for a permission the backend grants them. Each of those was fixed where it
 * was found. **This declaration — the shared type both clients now compile
 * against — was not**, and it was the last copy still short a member.
 *
 * Found by comparing this union against
 * `components["schemas"]["UserRoleEnum"]` in the generated schema, which has
 * had five members all along. `enumsMatchTheSchema.test.ts` now holds them
 * equal, so the sixth role cannot land in the backend and stop here.
 *
 * Written as a literal union rather than an alias to the generated enum on
 * purpose: `domainDisplayContract.test.tsx` derives its subject list by
 * scanning these files for `field: "A" | "B"`, and an alias is invisible to
 * that regex. See the header of `enumsMatchTheSchema.test.ts`.
 */
export type UserRole =
  | "ADMIN"
  | "MODERATOR"
  | "JUDGE"
  | "GUARDIAN"
  | "VIEWER";

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
