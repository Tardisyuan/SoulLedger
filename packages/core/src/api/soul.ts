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
import type { AppealCompensation } from "../domain/appeals";
import { stampRequest } from "./requestStamp";

type Schemas = components["schemas"];
export type SoulLoginResponse = Schemas["SoulLoginResponse"];
export type SoulTokenPair = Schemas["SoulTokenPair"];
/** Step 1 of sign-in answers with tokens, or — when two-step verification is on — with a pending credential. */
export type SoulLoginOutcome = Schemas["SoulLoginOutcome"];
export type SoulMfaRequired = Schemas["SoulMfaRequired"];
export type SoulMfaStatus = Schemas["SoulMfaStatus"];
/** 登录设备与记录 (第二十八批 S1): `current` = the phone asking; `SignInRecord.count` > 1 = consecutive identical failures merged. */
export type SoulSignInSession = Schemas["SignInSession"];
export type SoulSignInRecord = Schemas["SignInRecord"];
export type SoulMfaSetup = Schemas["SoulMfaSetupResponse"];
export type SoulMfaVerifyResponse = Schemas["SoulMfaVerifyResponse"];
/** `remember_device` defaults to false on the server (the generated type makes it required). */
export type SoulMfaVerifyRequest = Omit<Schemas["SoulMfaVerifyRequest"], "remember_device"> & { remember_device?: boolean };
export type SoulMfaDisableRequest = Schemas["SoulMfaDisableRequest"];
export type SoulDeviceLoginRequest = Schemas["SoulDeviceLoginRequest"];
/** 「导出我的资料」:最近一次申请。READY 才有 `download_url`;过了有效期读作 EXPIRED。 */
export type SoulDataExport = Schemas["SoulDataExport"];
export type SoulDataExportStatus = SoulDataExport["status"];
export type SoulDataExportState = Schemas["SoulDataExportState"];

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
/** 审判申诉(第五十二批):本世已结案的审判能不能申诉,与灵魂自己的各轮。 */
export type MeAppealableJudgment = Schemas["MeAppealableJudgment"];
export type MeJudgmentAppeal = Omit<Schemas["MeJudgmentAppeal"], "compensations"> & {
  compensations: AppealCompensation[];
};
export type MeJudgmentAppealList = { judgments: MeAppealableJudgment[]; results: MeJudgmentAppeal[] };
/** 枉死城(地府):本人本世一件枉死的案子,还押与否、冤情申诉到哪一步(`GET /me/wangsi/`)。 */
export type MeWangsiCase = Schemas["MeWangsiCase"];
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
/** 设置 › 账号安全 › 联系邮箱(第四十批 S-b):打码的地址、本殿是否允许自己改、要不要 6 位数字。 */
export type ContactEmailStatus = Schemas["ContactEmailStatus"];
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
  stampRequest(config.headers, config.method);
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
  return /\/soul-auth\/(login|device-login|device-login\/revoke|refresh|logout|mfa\/verify)\/?$/.test(url || "");
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
  /**
   * 面容 / 指纹登录: 「编号 + 这部手机的凭据」 in place of 「编号 + 密码」. The answer has exactly the shape of `login`'s
   * (tokens, or `mfa_required` + the pending credential). Refusals: `soulDeviceLoginFailure`.
   */
  deviceLogin: ({ soul_code, credential, device_token }: SoulDeviceLoginRequest) =>
    soulHttp
      .post<SoulLoginOutcome>("/soul-auth/device-login/", {
        soul_code,
        credential,
        ...(device_token ? { device_token } : {}),
      })
      .then((r) => r.data),
  /** Signed in. The current password; 201 `{credential}` is shown ONCE. A new credential every call: revoke the old one first. */
  enableDeviceLogin: (password: string) =>
    soulHttp.post<Schemas["SoulDeviceLoginIssued"]>("/me/device-login/", { password }).then((r) => r.data.credential),
  /** 204 whatever the credential's state. */
  revokeDeviceLogin: (credential: string) =>
    soulHttp.post("/soul-auth/device-login/revoke/", { credential }).then(() => undefined),
  /** Sign-in step 2. `device_token` in the answer only when `remember_device` was asked for. */
  mfaVerify: (body: SoulMfaVerifyRequest) =>
    soulHttp.post<SoulMfaVerifyResponse>("/soul-auth/mfa/verify/", body).then((r) => r.data),
  mfaStatus: () => soulHttp.get<SoulMfaStatus>("/me/mfa/").then((r) => r.data),
  /** This phone first, then the rest by last activity. */
  signInSessions: () => soulHttp.get<SoulSignInSession[]>("/me/sessions/").then((r) => r.data),
  /** No password needed; the current one is refused 400 `current_session`. */
  revokeSignInSession: (id: string) => soulHttp.post<void>(`/me/sessions/${id}/revoke/`).then(() => undefined),
  /** Every session but this one; 409 `session_unknown` when this token has none. */
  revokeOtherSignInSessions: () => soulHttp.post<{ revoked: number }>("/me/sessions/revoke-others/").then((r) => r.data),
  /** The latest data-export request (`export`), which is `null` when the soul never asked. */
  dataExport: () => soulHttp.get<SoulDataExportState>("/me/export/").then((r) => r.data),
  /**
   * Ask for the export. Proof of who is asking: the current `password`, or the `credential` the phone gave up after
   * a face check. 400 `wrong_password`, 429 `rate_limited` (the password login's counters), 409 `export_in_progress`.
   */
  requestDataExport: (proof: { password: string } | { credential: string }) =>
    soulHttp.post<SoulDataExport>("/me/export/", proof).then((r) => r.data),
  /** The last 90 days, newest first. */
  signInRecords: () => soulHttp.get<SoulSignInRecord[]>("/me/sign-ins/").then((r) => r.data),
  /**
   * Needs the CURRENT PASSWORD (being signed in is not being the owner): 400 `wrong_password` makes no secret, 429
   * `rate_limited` once the password login's own counters are spent. A new secret (the previous unconfirmed one is
   * void). Not enabled until `mfaConfirm`.
   */
  mfaSetup: (password: string) => soulHttp.post<SoulMfaSetup>("/me/mfa/setup/", { password }).then((r) => r.data),
  mfaCancelSetup: () => soulHttp.delete("/me/mfa/setup/").then(() => undefined),
  /** Right digits → enabled, and the ten recovery codes, ONCE. Hold them in component state only. */
  mfaConfirm: (code: string) =>
    soulHttp.post<Schemas["SoulMfaRecoveryCodes"]>("/me/mfa/confirm/", { code }).then((r) => r.data.recovery_codes),
  /**
   * The same confirmation as `mfaDisable` (the 6-digit code or the password; one lock; a recovery code does not
   * count). Until it passes the old set stays good; then it is void at once and the new ten are shown once.
   */
  mfaRegenerate: (body: SoulMfaDisableRequest) =>
    soulHttp.post<Schemas["SoulMfaRecoveryCodes"]>("/me/mfa/recovery-codes/", body).then((r) => r.data.recovery_codes),
  mfaDisable: (body: SoulMfaDisableRequest) =>
    soulHttp.post<SoulMfaStatus>("/me/mfa/disable/", body).then((r) => r.data),
  /**
   * 改联系邮箱(第四十批 S-b),三步:当前密码(开了两步验证再带 `code`)→ 新邮箱(验证码发到新邮箱)→ 验证码。
   * Refusals carry `code`: email_in_person (403, every step: the hall does it in person), wrong_password /
   * rate_limited / mfa_required / wrong / expired / locked (verify), proof_required / email_unchanged (start),
   * reset_code_wrong (+ attempts_left) / reset_code_expired / reset_code_attempts_exceeded / email_taken (confirm).
   */
  contactEmail: () => soulHttp.get<ContactEmailStatus>("/me/contact-email/").then((r) => r.data),
  contactEmailVerify: (password: string, code?: string) =>
    soulHttp.post("/me/contact-email/verify/", { password, ...(code ? { code } : {}) }).then(() => undefined),
  contactEmailStart: (email: string) =>
    soulHttp.post<Schemas["ContactEmailSent"]>("/me/contact-email/", { email }).then((r) => r.data),
  contactEmailConfirm: (code: string) =>
    soulHttp.post<ContactEmailStatus>("/me/contact-email/confirm/", { code }).then((r) => r.data),
  /** Best effort: the server answers 204 whatever the token's state. */
  logout: (refresh: string) => soulHttp.post("/soul-auth/logout/", { refresh }),
  /** 200 is a NEW token pair; the old refresh token is dead the moment this returns. */
  changePassword: (old_password: string, new_password: string, push_token?: string, device_credential?: string) =>
    soulHttp
      .post<SoulTokenPair>("/me/password/", {
        old_password,
        new_password,
        ...(push_token ? { push_token } : {}),
        // This phone's 面容 / 指纹 credential: it is kept; every other device's is revoked.
        ...(device_credential ? { device_credential } : {}),
      })
      .then((r) => r.data),
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
  /** 审判申诉(第五十二批):本世已结案的审判(`can_appeal` / `refusal_code` / `deadline`)与各轮申诉。 */
  judgmentAppeals: () => soulHttp.get<MeJudgmentAppealList>("/me/judgment-appeals/").then((r) => r.data),
  /** 403 `past_life_read_only`;409 `appeal_open` / `appeal_rounds_used` / `appeal_window_closed` / `not_concluded` / `not_appealable` / `no_appeal_above_minos`(希腊)/ `soul_devoured`(被阿米特吞噬)。 */
  //  `escalate`:上诉到本文明的多站申诉流程(上一轮一次复核维持原判之后;409 `not_escalatable`)。
  fileJudgmentAppeal: (judgment: string, reason: string, evidence = "", escalate = false) =>
    soulHttp
      .post<MeJudgmentAppeal>("/me/judgment-appeals/", { judgment, reason, evidence, escalate })
      .then((r) => r.data),
  /** 待复核、复核中都可以撤回;撤回也算一次。409 `appeal_closed`。 */
  withdrawJudgmentAppeal: (id: string) =>
    soulHttp.post<MeJudgmentAppeal>(`/me/judgment-appeals/${id}/withdraw/`).then((r) => r.data),
  /** 本人本世枉死的案子(新的在前);不是地府、没有枉死的案子是空表。 */
  wangsi: () => soulHttp.get<MeWangsiCase[]>("/me/wangsi/").then((r) => r.data),
  /** 枉死城的冤情申诉。404 `not_found`;409 `not_pending` / `not_in_wangsi` / `grievance_open`。 */
  fileWangsiGrievance: (judgment: string, plea: string) =>
    soulHttp.post<MeWangsiCase>("/me/wangsi/", { judgment, plea }).then((r) => r.data),
  applications: () =>
    soulHttp.get<MeRebirthApplicationList>("/me/rebirth-applications/").then((r) => r.data),
  application: (id: string) =>
    soulHttp.get<MeRebirthApplication>(`/me/rebirth-applications/${id}/`).then((r) => r.data),
  /** `desired_form` 为 null:希腊灵魂不走六道,不带这个字段,服务端记 OTHER(带了是 400)。 */
  submitApplication: (desired_form: DesiredRebirthForm | null, statement: string) =>
    soulHttp
      .post<MeRebirthApplication>(
        "/me/rebirth-applications/",
        desired_form ? { desired_form, statement } : { statement },
      )
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
/** 申诉被拒的原因 → `appeals.refusal.<code>`(列表的 `refusal_code` 与提交的 409 / 403 共用);别的 code 返回 null。 */
export const APPEAL_REFUSAL_CODES = [
  "appeal_open",
  "appeal_rounds_used",
  "appeal_window_closed",
  "not_concluded",
  "not_appealable",
  "past_life_read_only",
  // 希腊:米诺斯之上无可上诉(docs/02 希腊 §5.2,用户 2026-10-27)。
  "no_appeal_above_minos",
  // 埃及:被阿米特吞噬即不复存在，无从申诉(P2-10,用户 2026-10-27)。
  "soul_devoured",
  // 上诉到申诉流程:上一轮要是一次复核、维持原判(2026-10-27)。
  "not_escalatable",
  // 撤回被拒(apps/judgment/appeals.py `withdraw`):已有结论 / 已撤回,或已进申诉流程。
  "appeal_closed",
  "ladder_running",
  // 原审的审批流程还没走完(2026-10-29,审查 B):申诉与上诉都等它走完。
  "origin_flow_open",
] as const;

export function appealRefusalKey(code: string | null | undefined): string | null {
  return code && (APPEAL_REFUSAL_CODES as readonly string[]).includes(code) ? `appeals.refusal.${code}` : null;
}

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
  "desired_form_required",
  "rebirth_form_not_applicable",
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
  // 缩短冷却期:希望的天数不在 0 到剩余天数之间(apps/soul_accounts/rebirth.py,400)。
  "invalid_days",
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

/** A refused `deviceLogin`, by the body's stable `code`. `network`: no response. `reason`: `password_changed` / `password_reset_by_officer` / `account_reincarnated` / `account_annihilated` / `turned_off`. */
export type SoulDeviceLoginFailure =
  | { code: "revoked"; reason: string | null }
  | { code: "invalid" | "rate_limited" | "network" | "other" };

export function soulDeviceLoginFailure(error: unknown): SoulDeviceLoginFailure {
  if (!axios.isAxiosError(error)) return { code: "other" };
  const response = error.response;
  if (!response) return { code: "network" };
  const body = (response.data ?? {}) as Record<string, unknown>;
  if (body.code === "device_login_revoked") return { code: "revoked", reason: typeof body.reason === "string" ? body.reason : null };
  if (body.code === "device_login_invalid") return { code: "invalid" };
  if (body.code === "rate_limited") return { code: "rate_limited" };
  return { code: "other" };
}
