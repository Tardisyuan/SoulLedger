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
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type SoulLoginResponse = Schemas["SoulLoginResponse"];
export type SoulTokenPair = Schemas["SoulTokenPair"];
/**
 * Residence (a soul temporarily dispatched to another civilization) is being
 * added to `/me/` on backend branch `feat/dispatch-residence`, not merged yet.
 * Declared here as OPTIONAL so the app shows it when present and treats its
 * absence as "at home". When that branch lands and `schema:generate` emits the
 * fields, delete this and use the generated `MeProfile` as-is.
 */
export interface MeResidenceFields {
  home_tenant?: { code: string; display_name: string } | null;
}
export type MeProfile = Schemas["MeProfile"] & MeResidenceFields;
export type MeLife = Schemas["MeLife"];
export type MeRecord = Schemas["MeRecord"];
export type MeJudgment = Schemas["MeJudgment"];
export type MeDisposition = Schemas["MeDisposition"];
export type MeReincarnation = Schemas["MeReincarnation"];
export type MeRebirthApplication = Schemas["MeRebirthApplication"];
export type MeRebirthApplicationList = Schemas["MeRebirthApplicationList"];
export type DesiredRebirthForm = Schemas["DesiredRebirthFormEnum"];
export type RebirthApplicationStatus = Schemas["RebirthApplicationStatusEnum"];

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
  return /\/soul-auth\/(login|refresh|logout)\/?$/.test(url || "");
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
  login: (soul_code: string, password: string) =>
    soulHttp.post<SoulLoginResponse>("/soul-auth/login/", { soul_code, password }).then((r) => r.data),
  /** Best effort: the server answers 204 whatever the token's state. */
  logout: (refresh: string) => soulHttp.post("/soul-auth/logout/", { refresh }),
  /** 200 is a NEW token pair; the old refresh token is dead the moment this returns. */
  changePassword: (old_password: string, new_password: string) =>
    soulHttp.post<SoulTokenPair>("/me/password/", { old_password, new_password }).then((r) => r.data),
  me: () => soulHttp.get<MeProfile>("/me/").then((r) => r.data),
  life: () => soulHttp.get<MeLife>("/me/life/").then((r) => r.data),
  pastLives: () => soulHttp.get<MeLife[]>("/me/past-lives/").then((r) => r.data),
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
};

/**
 * THE ONE PLACE THE REJECTION REASON IS READ. The backend is moving it to a
 * dedicated field (name not yet fixed); when it lands, this line changes and no
 * screen does.
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
  "appeal_used",
  "not_appealable",
  "past_life_read_only",
  "not_found",
  "network",
  "validation",
] as const;

export type SoulErrorCode = (typeof SOUL_ERROR_CODES)[number];

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
