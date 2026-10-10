/**
 * The soul's side of the API: `/soul-auth/*` and `/me/*`.
 *
 * WHY A SECOND AXIOS INSTANCE AND NOT `api` FROM `./client`. The officer client
 * rotates through `/auth/refresh/`, which only accepts an officer `refresh`
 * token — the backend types its tokens (`soul_access` / `soul_refresh`,
 * `backend/apps/soul_accounts/authentication.py`), so a soul refresh token sent
 * there is a 401 and the interceptor would end every soul session at the first
 * access-token expiry. Branching the officer interceptor on "which kind of
 * session is this" would put the one boundary the backend refuses to let the
 * client self-report back into a client-side flag.
 *
 * What is shared is everything below the HTTP layer: the same token keys and
 * the same three stores (`platform()`), because a host runs exactly one kind of
 * session — the web admin never holds a soul token and the soul app never holds
 * an officer one.
 *
 * WHAT THIS MODULE DECIDES, AND WHAT IT HANDS TO THE HOST.
 *   401 on a non-auth endpoint → one shared refresh via `/soul-auth/refresh/`,
 *     then the original request is replayed. A refresh the SERVER refuses ends
 *     the session (tokens cleared, `onUnauthorized`). A refresh that never
 *     reached the server (offline) does NOT end the session: the caller gets
 *     the original error and the tokens stay, so walking out of signal does not
 *     sign a soul out.
 *   403 `password_change_required` → subscribers of
 *     `onSoulPasswordChangeRequired`; the host routes to its change-password
 *     screen. Not a platform port: it is a soul-session event, and the web
 *     admin has no use for it.
 */
import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  getAccessToken,
  getApiBaseUrl,
  getLocale,
  getRefreshToken,
  platform,
  setAccessToken,
  setRefreshToken,
} from "../platform/index";
import type {
  PasswordResetAccepted,
  PasswordResetRefusal,
  PasswordResetRefusalCode,
  PasswordResetRequest,
  SetNewPasswordRequest,
} from "./auth";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type SoulLoginResponse = Schemas["SoulLoginResponse"];
export type SoulTokenPair = Schemas["SoulTokenPair"];
/** Step 1 of sign-in answers with tokens, or — when two-step verification is on — with a pending credential. */
export type SoulLoginOutcome = Schemas["SoulLoginOutcome"];
export type SoulMfaRequired = Schemas["SoulMfaRequired"];
export type SoulMfaStatus = Schemas["SoulMfaStatus"];
export type SoulMfaSetup = Schemas["SoulMfaSetupResponse"];
export type SoulMfaVerifyResponse = Schemas["SoulMfaVerifyResponse"];
/** `remember_device` defaults to false on the server (the generated type makes it required). */
export type SoulMfaVerifyRequest = Omit<Schemas["SoulMfaVerifyRequest"], "remember_device"> & { remember_device?: boolean };
export type SoulMfaDisableRequest = Schemas["SoulMfaDisableRequest"];

export function isMfaRequired(outcome: SoulLoginOutcome): outcome is SoulMfaRequired {
  return "mfa_required" in outcome && outcome.mfa_required === true;
}
/**
 * Residence (a soul dispatched to another civilization) comes with the generated
 * type: `home_tenant`, `home_civilization` and `is_residing` are always present,
 * and `is_residing` is the server's word on whether the soul is away from home.
 */
export type MeProfile = Schemas["MeProfile"];
export type MeLife = Schemas["MeLife"];
export type MeRecord = Schemas["MeRecord"];
export type MeJudgment = Schemas["MeJudgment"];
export type MeDisposition = Schemas["MeDisposition"];
export type MeReincarnation = Schemas["MeReincarnation"];
/** 「我的受刑」:本人本世的计划,节点状态已按画布 1a 合并成灵魂看的几档(REMOVED 不出现)。 */
export type MeSentencePlan = Schemas["MeSentencePlan"];
export type MeSentenceStation = Schemas["MeSentenceStation"];
export type SentenceStationStatus = Schemas["SoulSentenceStationStatusEnum"];
export type MeRebirthApplication = Schemas["MeRebirthApplication"];
export type MeRebirthApplicationList = Schemas["MeRebirthApplicationList"];
export type DesiredRebirthForm = Schemas["DesiredRebirthFormEnum"];
export type RebirthApplicationStatus = Schemas["RebirthApplicationStatusEnum"];
/** 缩短冷却申请:本世最近一份,在 `MeRebirthApplicationList.cooldown_shortening` 里。 */
export type MeCooldownShortening = Schemas["MeCooldownShortening"];
export type CooldownShorteningStatus = Schemas["CooldownShorteningStatusEnum"];
export type PushDevice = Schemas["PushDevice"];
export type PushPlatform = Schemas["PushPlatformEnum"];
export type NotificationSettings = Schemas["NotificationSettings"];
export type NotificationSettingsPatch = Schemas["PatchedNotificationSettings"];
/** One push the soul was sent, every status included (`/me/notifications/`); `data` is the tap target (`landingOf`). */
export type PushHistoryItem = Schemas["PushHistoryItem"];
export type PaginatedPushHistory = Schemas["PaginatedPushHistory"];
export type Civilization = Schemas["CivilizationEnum"];

/** The six forms a soul may ask for — the schema's enum, `OTHER` excluded server-side. */
export const DESIRED_REBIRTH_FORMS: readonly DesiredRebirthForm[] = [
  "DIVINE",
  "HUMAN",
  "ASURA",
  "ANIMAL",
  "HUNGRY_GHOST",
  "HELL_BEING",
];

export const soulHttp = axios.create({
  headers: { "Content-Type": "application/json" },
});

soulHttp.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers["Accept-Language"] = getLocale();
  return config;
});

const passwordChangeRequiredHandlers = new Set<() => void>();

export function onSoulPasswordChangeRequired(handler: () => void): () => void {
  passwordChangeRequiredHandlers.add(handler);
  return () => {
    passwordChangeRequiredHandlers.delete(handler);
  };
}

export function storeSoulTokens(pair: SoulTokenPair): void {
  setAccessToken(pair.access);
  setRefreshToken(pair.refresh);
}

/**
 * Both stores the tokens live in. `secure` for the refresh token — NOT
 * `persistent`: the officer client's `endSession` removes it from `persistent`,
 * which on the web is the same cookie jar and on a phone is a different store
 * entirely, so that line would leave the refresh token behind.
 */
export function clearSoulTokens(): void {
  platform().session.remove(ACCESS_TOKEN_KEY);
  platform().secure.remove(REFRESH_TOKEN_KEY);
}

function isSoulAuthEndpoint(url: string | undefined): boolean {
  // `mfa/verify` too: its 401 is `pending_invalid` (the step timed out), not an expired session.
  return /\/soul-auth\/(login|refresh|logout|mfa\/verify)\/?$/.test(url || "");
}

let refreshInFlight: Promise<string> | null = null;

async function rotate(refresh: string): Promise<string> {
  const { data } = await soulHttp.post<SoulTokenPair>("/soul-auth/refresh/", { refresh });
  storeSoulTokens(data);
  return data.access;
}

type RetriableConfig = InternalAxiosRequestConfig & { _soulRetry?: boolean };

soulHttp.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ code?: unknown }>) => {
    const status = error.response?.status;
    const config = error.config as RetriableConfig | undefined;

    if (status === 403 && error.response?.data?.code === "password_change_required") {
      for (const handler of [...passwordChangeRequiredHandlers]) handler();
    }

    if (status === 401 && config && !config._soulRetry && !isSoulAuthEndpoint(config.url)) {
      config._soulRetry = true;
      const refresh = getRefreshToken();
      if (refresh) {
        try {
          if (!refreshInFlight) {
            refreshInFlight = rotate(refresh).finally(() => {
              refreshInFlight = null;
            });
          }
          const access = await refreshInFlight;
          config.headers.Authorization = `Bearer ${access}`;
          return soulHttp(config);
        } catch (refreshError) {
          // Offline: keep the session, surface the original failure.
          if (!(refreshError as AxiosError).response) return Promise.reject(refreshError);
        }
      }
      clearSoulTokens();
      platform().onUnauthorized();
    }
    return Promise.reject(error);
  }
);

export const soulApi = {
  /**
   * `deviceToken`: the opaque value an earlier 「这部手机 30 天内不再询问」 returned. When it is still good
   * the server skips the second step and this answers with tokens; when it is not (expired, voided, another
   * account's), the answer is the pending credential, as if none had been sent.
   */
  login: (soul_code: string, password: string, deviceToken?: string) =>
    soulHttp
      .post<SoulLoginOutcome>("/soul-auth/login/", {
        soul_code,
        password,
        ...(deviceToken ? { device_token: deviceToken } : {}),
      })
      .then((r) => r.data),
  /** Sign-in step 2. `device_token` in the answer only when `remember_device` was asked for. */
  mfaVerify: (body: SoulMfaVerifyRequest) =>
    soulHttp.post<SoulMfaVerifyResponse>("/soul-auth/mfa/verify/", body).then((r) => r.data),
  mfaStatus: () => soulHttp.get<SoulMfaStatus>("/me/mfa/").then((r) => r.data),
  /** A new secret (and the previous unconfirmed one is void). Not enabled until `mfaConfirm`. */
  mfaSetup: () => soulHttp.post<SoulMfaSetup>("/me/mfa/setup/").then((r) => r.data),
  mfaCancelSetup: () => soulHttp.delete("/me/mfa/setup/").then(() => undefined),
  /** Right digits → enabled, and the ten recovery codes, ONCE. Hold them in component state only. */
  mfaConfirm: (code: string) =>
    soulHttp.post<Schemas["SoulMfaRecoveryCodes"]>("/me/mfa/confirm/", { code }).then((r) => r.data.recovery_codes),
  /** The old set is void at once; the new ten are shown once. */
  mfaRegenerate: () =>
    soulHttp.post<Schemas["SoulMfaRecoveryCodes"]>("/me/mfa/recovery-codes/").then((r) => r.data.recovery_codes),
  mfaDisable: (body: SoulMfaDisableRequest) =>
    soulHttp.post<SoulMfaStatus>("/me/mfa/disable/", body).then((r) => r.data),
  /** Best effort: the server answers 204 whatever the token's state. */
  logout: (refresh: string) => soulHttp.post("/soul-auth/logout/", { refresh }),
  /** 200 is a NEW token pair; the old refresh token is dead the moment this returns. */
  changePassword: (old_password: string, new_password: string) =>
    soulHttp.post<SoulTokenPair>("/me/password/", { old_password, new_password }).then((r) => r.data),
  /**
   * 「忘记密码」, step 1: mail a six-digit code (valid 5 minutes) to the contact
   * email on the soul's account. `/auth/*`, not `/soul-auth/*` — the email-code
   * reset is the backend's one reset flow — but it rides `soulHttp` because this
   * is the soul app's transport: the officer client's 401 path would end an
   * officer session this host never holds. Called signed out, so no token goes.
   * 200 whether or not the address has an account; the screen must not branch
   * on anything but the status.
   */
  requestPasswordReset: (email: string) =>
    soulHttp
      .post<PasswordResetAccepted>("/auth/reset-password/", { email } satisfies PasswordResetRequest)
      .then((r) => r.data),
  /** Step 2. Does NOT sign in: 200 is `{detail}` only, no tokens. */
  setNewPassword: (body: SetNewPasswordRequest) =>
    soulHttp.post<PasswordResetAccepted>("/auth/set-new-password/", body).then((r) => r.data),
  me: () => soulHttp.get<MeProfile>("/me/").then((r) => r.data),
  life: () => soulHttp.get<MeLife>("/me/life/").then((r) => r.data),
  pastLives: () => soulHttp.get<MeLife[]>("/me/past-lives/").then((r) => r.data),
  sentencePlan: () => soulHttp.get<MeSentencePlan>("/me/sentence-plan/").then((r) => r.data),
  applications: () =>
    soulHttp.get<MeRebirthApplicationList>("/me/rebirth-applications/").then((r) => r.data),
  application: (id: string) =>
    soulHttp.get<MeRebirthApplication>(`/me/rebirth-applications/${id}/`).then((r) => r.data),
  submitApplication: (desired_form: DesiredRebirthForm, statement: string) =>
    soulHttp
      .post<MeRebirthApplication>("/me/rebirth-applications/", { desired_form, statement })
      .then((r) => r.data),
  appeal: (id: string, statement: string) =>
    soulHttp
      .post<MeRebirthApplication>(`/me/rebirth-applications/${id}/appeal/`, { statement })
      .then((r) => r.data),
  /** Optional `desiredRemainingDays`: 0 <= n < days left; 400 `invalid_days` otherwise. Only while `reason === "cooldown"` and `can_shorten_cooldown`; 409 `not_in_cooldown` / `shortening_pending` / `shortening_used`. */
  requestCooldownShortening: (reason: string, desiredRemainingDays?: number) =>
    soulHttp
      .post<MeCooldownShortening>("/me/rebirth-applications/cooldown-shortening/", {
        reason,
        ...(desiredRemainingDays === undefined ? {} : { desired_remaining_days: desiredRemainingDays }),
      })
      .then((r) => r.data),
  /**
   * The welcome transition has played for `civilization` (App「文明气质」1b). Idempotent;
   * the answer is the whole list, most recent welcome last (`/me/`'s `welcomed_civilizations`).
   */
  markWelcomed: (civilization: Civilization) =>
    soulHttp
      .post<Schemas["MeWelcomed"]>("/me/welcomed/", { civilization } satisfies Schemas["MeWelcomedRequest"])
      .then((r) => r.data.welcomed_civilizations),
  /**
   * Register this device's Expo push token for the signed-in soul. Idempotent:
   * 201 the first time, 200 after. A token already held by another soul account
   * moves to this one. The token itself comes from the host (on a phone,
   * `expo-notifications`); this package never imports it.
   */
  registerPushToken: (token: string, platform: PushPlatform) =>
    soulHttp.post<PushDevice>("/me/push-tokens/", { token, platform }).then((r) => r.data),
  /** Call BEFORE `logout`: it needs the soul's access token. 204 whether or not the token was known. */
  unregisterPushToken: (token: string) =>
    soulHttp.post("/me/push-tokens/unregister/", { token }).then(() => undefined),
  notificationSettings: () =>
    soulHttp.get<NotificationSettings>("/me/notification-settings/").then((r) => r.data),
  updateNotificationSettings: (patch: NotificationSettingsPatch) =>
    soulHttp.patch<NotificationSettings>("/me/notification-settings/", patch).then((r) => r.data),
  /**
   * What this soul has been sent, newest first, 20 a page. Read-only and about the
   * CONTENT: a push the OS dropped, or one the soul had switched off, is still here.
   */
  notifications: (page = 1) =>
    soulHttp.get<PaginatedPushHistory>("/me/notifications/", { params: { page } }).then((r) => r.data),
};

/**
 * THE ONE PLACE THE REJECTION REASON IS READ: the MOST RECENT decision's reason
 * (the appeal's, once there has been one). An appeal clears it; the first
 * rejection is kept apart in `first_rejection_reason` / `first_decided_at`.
 */
export function rejectionReasonOf(application: MeRebirthApplication): string {
  return application.rejection_reason ?? "";
}

/**
 * Every `code` the soul endpoints are documented to return, plus the three
 * client-side classes. Keyed to `soul_app.errors.<code>` in all three bundles.
 */
export const SOUL_ERROR_CODES = [
  "invalid_credentials",
  "initial_password_expired",
  "rate_limited",
  "invalid_old_password",
  "password_unchanged",
  "weak_password",
  "password_change_required",
  "account_retired",
  "application_open",
  "cooldown",
  "terminal_cosmology",
  "soul_state",
  "application_approved",
  "sentence_in_progress",
  "appeal_used",
  "not_appealable",
  "not_in_cooldown",
  "shortening_pending",
  "shortening_used",
  "past_life_read_only",
  "not_found",
  "network",
  "validation",
] as const;


export interface SoulErrorMessage {
  key: string;
  params?: Record<string, string>;
}

/** The HTTP status of a failed soul request; `null` when no response arrived (or not an HTTP error). */
export function soulErrorStatus(error: unknown): number | null {
  return axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
}

/** The `code` of a `{detail, code}` body, or `null`. */
export function soulErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Classify a failure into something a screen can say.
 *
 *   no response at all        → `network` (offline, DNS, timeout)
 *   a known `code` in the body → that code's copy
 *   a 400 without a `code`     → `validation` (DRF field errors)
 *   anything else              → `unknown`, CARRYING the raw code or status so
 *                                an unmapped value is shown, not swallowed
 */
export function soulErrorMessage(error: unknown): SoulErrorMessage {
  if (!axios.isAxiosError(error)) {
    return { key: "soul_app.errors.unknown", params: { code: "client" } };
  }
  const response = (error as AxiosError<{ code?: unknown }>).response;
  if (!response) return { key: "soul_app.errors.network" };
  const code = response.data?.code;
  if (typeof code === "string") return soulCodeMessage(code);
  if (response.status === 400) return { key: "soul_app.errors.validation" };
  return { key: "soul_app.errors.unknown", params: { code: String(response.status) } };
}

/** A bare reason code (e.g. `can_apply=false`'s `reason`) → copy; unmapped codes are carried, not dropped. */
export function soulCodeMessage(code: string): SoulErrorMessage {
  return (SOUL_ERROR_CODES as readonly string[]).includes(code)
    ? { key: `soul_app.errors.${code}` }
    : { key: "soul_app.errors.unknown", params: { code } };
}

/**
 * Copy for each `code` a refused reset request carries (backend
 * `PASSWORD_RESET_REFUSAL_CODES`). Typed on the generated enum, so a code the
 * backend adds fails to compile here until it is given copy.
 */
const PASSWORD_RESET_REFUSAL_KEY: Record<PasswordResetRefusalCode, string> = {
  rate_limited: "soul_app.errors.rate_limited",
  reset_code_expired: "soul_app.forgot_password.err_expired_title",
  reset_code_wrong: "soul_app.forgot_password.err_wrong_title",
  // Five wrong codes: the backend deleted the code, only a new one helps.
  reset_code_attempts_exceeded: "soul_app.forgot_password.err_exhausted_title",
  weak_password: "soul_app.errors.weak_password",
  // No soul account, or several on one address: only a hall can help.
  no_soul_account: "soul_app.forgot_password.ask_hall",
  ambiguous_email: "soul_app.forgot_password.ask_hall",
};

/**
 * Classify a failed `setNewPassword` into `soul_app.*` copy — by the body's
 * `code`, never by its `error` sentence.
 *
 *   no response                → `errors.network`
 *   a known `code`             → `PASSWORD_RESET_REFUSAL_KEY`
 *   400 {new_password: [...]}  → `errors.weak_password`       DRF field errors:
 *   400 {code: [...]}          → `forgot_password.err_wrong_title`  `code` is a list
 *   any other 400              → `errors.validation`
 *   anything else              → `soulErrorMessage`: an unmapped code or status
 *                                is carried, not swallowed
 */
export function passwordResetErrorMessage(error: unknown): SoulErrorMessage {
  if (!axios.isAxiosError(error)) return soulErrorMessage(error);
  const response = error.response;
  if (!response) return { key: "soul_app.errors.network" };
  const code = soulErrorCode(error);
  if (code !== null && Object.prototype.hasOwnProperty.call(PASSWORD_RESET_REFUSAL_KEY, code)) {
    return { key: PASSWORD_RESET_REFUSAL_KEY[code as PasswordResetRefusalCode] };
  }
  if (response.status === 400 && code === null) {
    const body = (response.data ?? {}) as Record<string, unknown>;
    if ("new_password" in body) return { key: "soul_app.errors.weak_password" };
    if ("code" in body) return { key: "soul_app.forgot_password.err_wrong_title" };
    return { key: "soul_app.errors.validation" };
  }
  return soulErrorMessage(error);
}

/** How many more checks a wrong code will take (`attempts_left` on `reset_code_wrong`), or `null`. */
export function passwordResetAttemptsLeft(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;
  const left = (error.response?.data as Partial<PasswordResetRefusal> | undefined)?.attempts_left;
  return typeof left === "number" && left >= 0 ? left : null;
}

/** Seconds a throttled reset request was told to wait (`retry_after`), or `null`. */
export function passwordResetRetryAfter(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;
  const wait = (error.response?.data as Partial<PasswordResetRefusal> | undefined)?.retry_after;
  return typeof wait === "number" && wait > 0 ? wait : null;
}

/**
 * What went wrong with a two-step call, by the body's stable `code`. `network`: no response at all (the
 * digits typed are still in the box). `pending_invalid`: the step timed out — start again from the password.
 */
export type SoulMfaFailureCode =
  | "wrong"
  | "expired"
  | "locked"
  | "pending_invalid"
  | "rate_limited"
  | "wrong_password"
  | "not_enabled"
  | "already_enabled"
  | "not_started"
  | "network"
  | "other";

export interface SoulMfaFailure {
  code: SoulMfaFailureCode;
  /** `wrong` / `wrong_password`: tries left before the lock. */
  remainingAttempts: number | null;
  /** `locked`: server time after which it can be tried again (ISO). */
  lockedUntil: string | null;
  /** `locked` / `rate_limited`: seconds. */
  retryAfter: number | null;
}

const MFA_CODES: readonly string[] = [
  "wrong", "expired", "locked", "pending_invalid", "rate_limited", "wrong_password",
  "not_enabled", "already_enabled", "not_started",
];

export function soulMfaFailure(error: unknown): SoulMfaFailure {
  const none = { remainingAttempts: null, lockedUntil: null, retryAfter: null };
  if (!axios.isAxiosError(error)) return { code: "other", ...none };
  const response = error.response;
  if (!response) return { code: "network", ...none };
  const body = (response.data ?? {}) as Record<string, unknown>;
  const code = typeof body.code === "string" && MFA_CODES.includes(body.code) ? (body.code as SoulMfaFailureCode) : "other";
  return {
    code,
    remainingAttempts: typeof body.remaining_attempts === "number" ? body.remaining_attempts : null,
    lockedUntil: typeof body.locked_until === "string" ? body.locked_until : null,
    retryAfter: typeof body.retry_after === "number" ? body.retry_after : null,
  };
}
