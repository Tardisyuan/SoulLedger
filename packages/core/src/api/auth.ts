import { api } from "./client";
import { ACCESS_TOKEN_KEY, getRefreshToken, platform, setAccessToken, setRefreshToken } from "../platform/index";
import type { components } from "./generated/schema";

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
  /** `civilization` picks the 匾 skin; `seal_glyphs` empty = civilization default. Optional: a
   *  user rehydrated from a pre-v2 stored session (24h TTL) has neither — fall back to defaults. */
  tenant: { code: string; display_name: string; civilization?: string; seal_glyphs?: string[] } | null;
  display_name: string;
  permissions: string[];
  /** 两步验证(A12)。`mfa_required`: the role is made to use it (ADMIN always); login is NOT blocked,
   *  the shell shows a standing banner until `mfa_enabled`. Optional: a pre-A12 cached session has neither. */
  mfa_enabled?: boolean;
  mfa_required?: boolean;
}

/** 200 body of POST /auth/login/ (backend/apps/authentication/serializers.py:94). */
export interface LoginResponse {
  access: string;
  refresh: string;
  user: LoginUser;
}

/**
 * The OTHER 200 body of POST /auth/login/: the password was right, the account has two-step
 * verification on, and this browser holds no valid 「不再询问」 device cookie. No tokens —
 * `pending_token` lives 5 minutes and is accepted by `/auth/mfa/verify/` only.
 */
export interface MfaRequiredResponse {
  mfa_required: true;
  pending_token: string;
  username: string;
}

export type LoginOutcome = LoginResponse | MfaRequiredResponse;

export function isMfaRequired(outcome: LoginOutcome): outcome is MfaRequiredResponse {
  return (outcome as MfaRequiredResponse).mfa_required === true;
}

export type MfaStatus = components["schemas"]["MfaStatus"];
/** `{error, code, …}`; branch on `code`: wrong (+remaining_attempts, lock_minutes) / expired / locked (+retry_after). */
export type MfaRefusal = components["schemas"]["MfaRefusal"];
export type MfaSetupResponse = components["schemas"]["MfaSetupResponse"];
export type MfaRecoveryCodes = components["schemas"]["MfaRecoveryCodes"];

export interface MfaVerifyRequest {
  pending_token: string;
  code?: string;
  recovery_code?: string;
  /** 「在此设备上 30 天内不再询问」: a separate httpOnly device cookie, not the refresh token. */
  remember_device?: boolean;
}

/**
 * Officer two-step verification (backend/apps/authentication/mfa_views.py). Officers only — soul
 * accounts never reach these. `login` and `verify` send credentials so the API origin can set / read
 * the device cookie (`CORS_ALLOW_CREDENTIALS`).
 */
export const mfaApi = {
  verify: (data: MfaVerifyRequest) => api.post<LoginResponse>("/auth/mfa/verify/", data, { withCredentials: true }),
  status: () => api.get<MfaStatus>("/auth/mfa/status/"),
  /** 409 `already_enabled` when it is already on; an unfinished earlier setup is discarded. */
  setup: () => api.post<MfaSetupResponse>("/auth/mfa/setup/"),
  /** Leaving the wizard at any step: the unconfirmed secret is dropped server-side. */
  cancelSetup: () => api.delete<{ detail: string }>("/auth/mfa/setup/"),
  /** Step 3. The ten recovery codes come back in plaintext here and nowhere else. */
  confirm: (code: string) => api.post<MfaRecoveryCodes>("/auth/mfa/confirm/", { code }),
  /** Step 4 完成 — the only call that turns it on. */
  complete: () => api.post<MfaStatus>("/auth/mfa/complete/"),
  regenerateRecoveryCodes: () => api.post<MfaRecoveryCodes>("/auth/mfa/recovery-codes/"),
  disable: (data: { method: "totp"; code: string } | { method: "password"; password: string }) =>
    api.post<MfaStatus>("/auth/mfa/disable/", data),
};

/** 401 body of POST /auth/login/ for wrong credentials: tries left before 429. */
export type LoginFailedBody = components["schemas"]["LoginFailedResponse"];
/** 429 body of POST /auth/login/: `code` is `login_locked`, `retry_after` in seconds. */
export type LoginLockedBody = components["schemas"]["LoginLockedResponse"];

/**
 * UserSerializer (backend/apps/authentication/serializers.py:142) — the
 * /auth/profile/ shape. Note `organization` is the raw FK id here, unlike
 * UserManagementSerializer on /users/ where it is an object.
 */
export interface AuthProfile {
  id: number;
  username: string;
  email: string;
  /** 邮箱已验证(官员邮箱重置密码的前提);改邮箱即变回 false。Optional: older payloads lack it. */
  email_verified?: boolean;
  role: UserRole;
  first_name: string;
  last_name: string;
  is_active: boolean;
  display_name: string;
  organization: number | null;
  position: string;
  mfa_enabled?: boolean;
  mfa_required?: boolean;
}

/**
 * One row of `GET /auth/civilizations/` — public, and deliberately bare: the
 * login page looks the name and shape mark up from `civilization` itself.
 * There is no tenant to *choose* here: a user has exactly one tenant, and the
 * token's `tenant_code` comes from it (see `CustomTokenObtainPairSerializer`).
 */
export interface PublicCivilization {
  code: string;
  civilization: string;
}

/** 操作员 → /judgment/queue, 管理员 → /dashboard. */
export type DefaultView = "operator" | "admin";

/** `GET/PATCH /auth/profile/preferences/` — always the caller's own. */
export interface UserPreferences {
  default_view: DefaultView | null;
  /** /welcome 的首次设置做完或跳过了。Unset reads as false. */
  onboarded: boolean;
  /** Officer email channel (action-needed notifications, `apps/notifications/tasks.py`). Default off. */
  email_notifications: boolean;
  /** Language of those emails: set from the UI locale when the switch is turned on; null = by civilization. */
  email_locale: "zh-Hans" | "en" | null;
}

/** `{error, code}` of the officer e-mail reset / verification endpoints; branch on `code`. */
export type OfficerResetRefusal = components["schemas"]["OfficerResetRefusal"];

/** The body `/auth/password-help/` answers 200 with, for every username alike. */
export interface PasswordHelpAccepted {
  detail: string;
}

/** Body of `POST /auth/reset-password/`: the contact email a code is mailed to. */
export type PasswordResetRequest = components["schemas"]["ResetPassword"];
/** Body of `POST /auth/set-new-password/`: that email, the six-digit code, the new password. */
export type SetNewPasswordRequest = components["schemas"]["SetNewPassword"];
/**
 * 200 body of both. `/auth/reset-password/` answers it for an address with no
 * account too, so nothing may branch on its text.
 */
export type PasswordResetAccepted = components["schemas"]["DetailResponse"];
/**
 * The body both answer a refusal with: `{error, code}`, plus `retry_after`
 * (seconds) when `code` is `rate_limited`. Branch on `code`; `error` is a
 * sentence for people and may be reworded.
 */
export type PasswordResetRefusal = components["schemas"]["PasswordResetRefusal"];
export type PasswordResetRefusalCode = components["schemas"]["PasswordResetRefusalCodeEnum"];

export interface LoginRequest {
  username: string;
  password: string;
  /** 「在此设备上保持登录 30 天」: a 30-day refresh token instead of 7, and a
   *  cookie that outlives the browser session. */
  remember?: boolean;
}

/** Officer-app login: no hall chosen; `tenant_code` only answers a 409 `hall_required`. */
export interface OfficerLoginRequest {
  username: string;
  password: string;
  remember?: boolean;
  tenant_code?: string;
}

/** 409 body of POST /auth/officer-login/: the password fits officers in several halls. */
export type HallChoiceBody = components["schemas"]["HallChoiceResponse"];

export const authApi = {
  officerLogin: (data: OfficerLoginRequest) => api.post<LoginResponse>("/auth/officer-login/", data),
  login: (usernameOrData: string | LoginRequest, password?: string) => {
    const data = typeof usernameOrData === "string"
      ? { username: usernameOrData, password: password! }
      : usernameOrData;
    // `withCredentials`: the 「不再询问」 device cookie lives on the API origin (see `mfaApi`).
    return api.post<LoginOutcome>("/auth/login/", data, { withCredentials: true });
  },
  civilizations: () => api.get<PublicCivilization[]>("/auth/civilizations/"),
  // Always 200 with the same body, whether or not the account exists — the
  // page must not branch on anything but the status.
  requestPasswordHelp: (username: string) =>
    api.post<PasswordHelpAccepted>("/auth/password-help/", { username }),
  // 官员「忘记密码」(邮箱重置链接,2026-10-09)。申请永远 200 同一个体 —— 账号不存在、邮箱未验证、
  // 是灵魂,都一样;页面只能按状态码分支(429 = 太频繁)。
  requestOfficerReset: (identifier: string) =>
    api.post<{ detail: string }>("/auth/officer-reset/request/", { identifier }),
  /** 400 `reset_link_invalid` / `weak_password`; 429 `rate_limited`. */
  confirmOfficerReset: (data: { uid: string; token: string; new_password: string }) =>
    api.post<{ detail: string }>("/auth/officer-reset/confirm/", data),
  /** 资料页「发送验证邮件」(每小时 5 封)。 */
  sendEmailVerification: () => api.post<{ detail: string }>("/auth/email/send-verification/"),
  /** 邮件链接落在 /verify-email,令牌本身就是凭据。 */
  verifyEmail: (data: { uid: string; token: string }) => api.post<{ detail: string }>("/auth/email/verify/", data),
  preferences: () => api.get<UserPreferences>("/auth/profile/preferences/"),
  updatePreferences: (data: Partial<UserPreferences>) =>
    api.patch<UserPreferences>("/auth/profile/preferences/", data),
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
  /**
   * Changing the password signs every OTHER device out at once. This device keeps its login:
   * its refresh token goes along, and the new `access` / `refresh` pair in the 200 body is
   * stored here, so callers have nothing to swap. 400 `{old_password: [sentence], new_password:
   * [{code, message}]}` -- read the codes with `passwordReasonKeys`.
   */
  changePassword: async (
    oldPasswordOrData: string | { old_password: string; new_password: string },
    newPassword?: string,
    /** Officer app only: this device's Expo push token. The server keeps its registration and deletes the
     *  user's others; the web sends none and so loses them all. */
    pushToken?: string
  ) => {
    const data = typeof oldPasswordOrData === "string"
      ? { old_password: oldPasswordOrData, new_password: newPassword! }
      : oldPasswordOrData;
    const refresh = getRefreshToken();
    const res = await api.post<ChangePasswordResponse>("/auth/change-password/", {
      ...data,
      ...(refresh ? { refresh } : {}),
      ...(pushToken ? { token: pushToken } : {}),
    });
    if (res.data.access && res.data.refresh) {
      setAccessToken(res.data.access);
      platform().persistent.remove(ACCESS_TOKEN_KEY); // as `rotateRefreshToken`: no stale 24 h cookie
      setRefreshToken(res.data.refresh);
    }
    return res;
  },
};

/** 200 body of `POST /auth/change-password/` (`access` / `refresh`: this device's new pair). */
export type ChangePasswordResponse = components["schemas"]["ChangePasswordResponse"];

/**
 * Why a new password was refused, as i18n keys, one per reason, from a 400 body of
 * `change-password` or `officer-reset/confirm` (`new_password: [{code, message}]`).
 * Django's English sentence is never shown: an unknown code (or a plain DRF string such as
 * "too long") reads as the generic key.
 */
const PASSWORD_REASON_KEYS: Record<string, string> = {
  password_too_short: "profile.password_too_short",
  password_too_common: "profile.password_reason_common",
  password_entirely_numeric: "profile.password_reason_numeric",
  password_too_similar: "profile.password_reason_similar",
};

export function passwordReasonKeys(body: unknown): string[] {
  const list = (body as { new_password?: unknown } | null | undefined)?.new_password;
  if (!Array.isArray(list)) return [];
  const keys = list.map((item) => {
    const code = item && typeof item === "object" ? (item as { code?: unknown }).code : undefined;
    return (typeof code === "string" && PASSWORD_REASON_KEYS[code]) || "profile.password_reason_invalid";
  });
  return [...new Set(keys)];
}

