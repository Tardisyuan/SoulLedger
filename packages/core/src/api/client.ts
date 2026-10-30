import axios from "axios";
import {
  ACCESS_TOKEN_KEY,
  getAccessToken,
  getApiBaseUrl,
  getRefreshToken,
  REFRESH_TOKEN_KEY,
  getLocale,
  platform,
  setAccessToken,
  setRefreshToken,
  usesRefreshCookie,
} from "../platform/index";
// Type-only import: erased at compile time, so this does not create a runtime
// import cycle with users.ts (which imports `api` from here as a value).
import type { PaginatedResponse } from "./users";
import { getImpersonation } from "./impersonationState";
import { stampRequest } from "./requestStamp";

/**
 * Where the API lives, resolved per call rather than captured at import.
 *
 * This was `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"`
 * at module scope — a Next.js build-time variable, read from a package that
 * declares itself platform-independent. Expo defines no `NEXT_PUBLIC_*` and a
 * Tauri webview reads `import.meta.env.VITE_*`, so both would have taken the
 * localhost fallback in silence, and on a phone `localhost` is the phone. It
 * is a host capability, so it is a port: `PlatformAdapter.baseUrl`.
 *
 * Module scope was the mechanical half of the problem: the adapter is
 * installed after this module is evaluated, so anything captured here
 * predates it. Hence a call, and hence `baseURL` set in the interceptor
 * below rather than on `axios.create`.
 *
 * `API_BASE` is gone rather than reassigned. It was a string, and a value
 * resolved per call cannot be one; re-exporting `getApiBaseUrl` under the old
 * name would have kept every call site compiling while changing what it
 * returns.
 */
export { getApiBaseUrl };

/**
 * Rows per page. Mirrors DRF's REST_FRAMEWORK["PAGE_SIZE"] in
 * backend/config/settings.py — the server decides how many results a page
 * holds, and this is only how the client derives the page count from `count`.
 *
 * That mirroring is held by `backend/tests/test_frontend_page_size.py`, which
 * reads this declaration as text and compares it to the setting. Said here
 * because this comment used to read "Must match" and nothing made it true: two
 * integers in two languages joined by a sentence, which is the shape that has
 * already cost this repository the colour tokens, lib/chart-colors.ts, and a
 * test helper claiming to be a single source from a directory the app cannot
 * import. A comment cannot fail; naming the check that can is the difference.
 *
 * A mismatch raises nothing at runtime. Every paginator computes
 * `Math.ceil(count / PAGE_SIZE)` and would simply draw the wrong number of
 * pages, with the last one or two unreachable — and app/audit/page.tsx sends
 * `page_size: String(PAGE_SIZE)` on the request, so there a stale value changes
 * what comes back rather than how it is described.
 */
export const PAGE_SIZE = 20;

/** 200 body of POST /auth/refresh/ (SimpleJWT TokenRefreshView). */
interface TokenRefreshResponse {
  access: string;
  refresh: string;
}

/**
 * WHERE THE FOUR BROWSER HELPERS WENT.
 *
 * `getCookie`, `getTenantId` (since deleted, FL-12), `getAccessToken`,
 * `clearAccessCookie` and `refreshCookie` used to be defined right here, reading `document.cookie`,
 * `localStorage` and `sessionStorage` directly. They are now the two stores in
 * `../platform`, and the web build supplies them from
 * `frontend/lib/platform/web.ts`.
 *
 * NOTHING ABOUT THE RULES THEY ENCODED CHANGED, and each rule is still written
 * down at the place that now enforces it:
 *
 *   - The access token reads from the **session** store and never the
 *     persistent one. That is `getAccessToken` in `../platform/index.ts`,
 *     which carries the note about the 24-hour cookie that used to outrank it.
 *   - `Secure` on the refresh cookie is conditional on the page protocol,
 *     because `Secure` cookies are dropped on the plain http that `npm run dev`
 *     and Playwright serve. `HttpOnly` is deliberately absent, because the API
 *     is cross-origin and takes its credential in an `Authorization` header, so
 *     JS must be able to read it. Both live in `frontend/lib/platform/web.ts`,
 *     which is the only place that knows what a cookie is.
 *   - `typeof document === "undefined"` guards are gone from this file on
 *     purpose: server rendering now reads the null adapter, which is the
 *     package default, so there is one guard instead of five.
 */

export { getAccessToken };

export const api = axios.create({
  headers: { "Content-Type": "application/json" },
});

// Add the JWT and the locale to every request.
//
// No tenant header. Until 2026-09-13 this also sent `X-Tenant-ID` from a
// `tenant_id` key that nothing in the app wrote, to a backend that never read
// it: the tenant comes from the JWT's `tenant_code` claim
// (`backend/apps/tenants/middleware.py`), and the header's only backend
// occurrence was the CORS allow-list (FL-12). `api.test.ts` asserts it stays
// absent even when a legacy `tenant_id` is still sitting in a browser.
api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // The locale the user chose, not the one their browser prefers.
  //
  // Three serializers pick a name column from this header
  // (`RealmLocalizedSerializer.get_display_name`, `actors/serializers.py`'s
  // `_locale_from_context`, and the judgment queue's `realm_options`), and until
  // 2026-09-10 **nothing sent it** — so `lang` fell to its `"en"` default and
  // `name_egy` was unreachable over HTTP. An `egy` user read `Mekher Tepy - Aalu`
  // on `/realms` (that page reads the bundle) and `幽冥边境` or
  // `First Circle - Limbo` on every page fed by the API, picked by the browser.
  //
  // Pinned from both sides by `backend/tests/test_the_locale_header_reaches_the_name.py`:
  // this line, and the three-locale round trip it enables. A guard on either
  // side alone is worthless — a backend honouring a header nobody sends, or a
  // header the backend ignores.
  config.headers["Accept-Language"] = getLocale();
  // Web: the refresh token is an httpOnly cookie on the API origin (decision 16). Credentials on every call so
  // refresh / logout / change-password carry it, and the opt-in header so token answers set it instead of
  // putting `refresh` in the body. The cookie's path is `/api/v1/auth/`; nothing else ever receives it.
  if (usesRefreshCookie()) {
    config.withCredentials = true;
    config.headers["X-Auth-Cookie"] = "1";
  }
  stampRequest(config.headers, config.method);
  return config;
});

/**
 * The single in-flight refresh.
 *
 * WHY A MODULE-LEVEL PROMISE AND NOT A PER-REQUEST FLAG. `error.config._retry`
 * lives on **each request's own config**, so two requests that 401 at the same
 * moment both saw `_retry === false`, both read the same refresh token, and
 * both POSTed `/auth/refresh/`. The backend runs
 * `ROTATE_REFRESH_TOKENS: True` with `BLACKLIST_AFTER_ROTATION: True`
 * (config/settings.py), so the first one succeeds **and blacklists the token
 * the second one is still holding** — the second necessarily 401s, falls into
 * the catch, clears the cookies and sends the user to `/login`.
 *
 * The access token lasts 30 minutes. Any page that fires several queries at
 * once — which is most of them — meets this condition on its first load after
 * expiry. Nothing about it is rare.
 *
 * Concurrent 401s now await the same promise, so exactly one rotation happens
 * and every waiter retries with the token it produced.
 */
let refreshInFlight: Promise<string> | null = null;

/** `true` for the three endpoints that must never be retried after a 401.
 *
 * The regex used to be anchored as `/^\/api\/v1\/auth\/...` and matched
 * **nothing**: `baseURL` already carries `/api/v1`, so axios hands the
 * interceptor `config.url === "/auth/login/"`. Measured in node:
 *
 *     "/auth/login/"         -> false
 *     "/auth/register/"      -> false
 *     "/auth/refresh/"       -> false
 *     "/api/v1/auth/login/"  -> true
 *
 * and `src/__tests__/api.test.ts` fed it the last of those in three tests
 * while asserting fifty lines further down that the real call is
 * `mockInstance.post('/auth/login/')` — **the file carried its own
 * refutation.**
 *
 * With the guard dead, a failed login (401) while a still-valid refresh cookie
 * sat in the browser sent the interceptor off to rotate the refresh token and
 * **replay the login request**. Every mistyped password burned a rotation.
 *
 * Matching on the suffix rather than the whole path keeps it correct whether or
 * not `/api/v1` is part of `config.url`, which is the thing that broke.
 */
function isAuthEndpoint(url: string | undefined): boolean {
  return /\/auth\/(login|register|refresh)\/?$/.test(url || "");
}

export async function rotateRefreshToken(refresh: string | null): Promise<string> {
  // SIMPLE_JWT has ROTATE_REFRESH_TOKENS=True and BLACKLIST_AFTER_ROTATION=True,
  // so the server blacklists the refresh token we just sent and issues a new
  // one in `data.refresh`. It MUST be persisted (same place the login flow
  // writes to — on web that is the `soulledger_refresh` cookie) or the next
  // refresh will present an already-blacklisted token and the user gets
  // silently booted to /login.
  // Cookie mode (web): no body; the httpOnly cookie is the credential and comes back rotated.
  const cookie = usesRefreshCookie();
  const { data } = await axios.post<TokenRefreshResponse>(
    `${getApiBaseUrl()}/auth/refresh/`,
    cookie ? {} : { refresh },
    cookie ? { withCredentials: true, headers: { "X-Auth-Cookie": "1" } } : undefined
  );
  // THE ACCESS TOKEN DOES NOT GO IN THE PERSISTENT STORE.
  //
  // On web that store is a cookie, and this line used to write
  // `soulledger_access` into it with `max-age=86400` — **24 hours, for a token
  // that lives 30 minutes** — while the readers preferred the cookie over
  // sessionStorage. The login path never did that; it wrote sessionStorage
  // only. So the design's own rule ("the access token lives in the session
  // store and dies with the tab") held until the first silent refresh and then
  // quietly stopped holding: from that moment the token survived tab closes and
  // browser restarts for a day, and was readable by any script on the page.
  //
  // That history is why the port is split by **lifetime** rather than by
  // storage mechanism (see ../platform/types.ts): "session vs persistent" is a
  // sentence this package can state and check, and "sessionStorage vs cookie"
  // is not.
  // `setAccessToken` also notifies `onAccessTokenChanged` subscribers — the
  // realtime provider re-opens a socket that 4001'd on the old token. See the
  // doc on that port in `../platform/index.ts` (FL-04).
  setAccessToken(data.access);
  // The removal below is not tidiness — a browser that has been through the old
  // code still has that cookie, and a persistent-first reader would keep
  // preferring it over the fresh token in the session store.
  platform().persistent.remove(ACCESS_TOKEN_KEY);
  setRefreshToken(data.refresh);
  return data.access;
}

/**
 * Clear the tokens and hand the host the decision about where the user goes.
 * `window.location.href = "/login"` was the one line in this file that assumed
 * a browser with a URL bar; a native client resets its navigator instead.
 */
function endSession(): void {
  platform().session.remove(ACCESS_TOKEN_KEY);
  platform().persistent.remove(ACCESS_TOKEN_KEY);
  platform().persistent.remove(REFRESH_TOKEN_KEY);
  // The refresh token is read from `secure` (getRefreshToken). On web that is the same jar as `persistent`;
  // on a phone it is the keychain, and the line above never reached it -- a still-valid refresh token stayed
  // behind after the session was ended.
  platform().secure.remove(REFRESH_TOKEN_KEY);
  platform().onUnauthorized();
}

let passwordChangeListener: (() => void) | null = null;

/**
 * The host's answer to a 403 `password_change_required` (first sign-in, an administrator's reset, or the password
 * aged out while the session was open): it routes to its change-password page. One listener; `null` removes it.
 */
export function onPasswordChangeRequired(listener: (() => void) | null): void {
  passwordChangeListener = listener;
}

let mfaSetupListener: (() => void) | null = null;

/**
 * The host's answer to a 403 `mfa_setup_required` (the role requires two-step verification and it is not on; the
 * server refuses everything but setting it up, signing out and reading oneself): it routes to its setup page.
 * One listener; `null` removes it.
 */
export function onMfaSetupRequired(listener: (() => void) | null): void {
  mfaSetupListener = listener;
}

// Handle 401 → redirect to login (skip for auth endpoints which handle their own errors)
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 403 && error.response.data?.code === "password_change_required") {
      passwordChangeListener?.();
    }
    if (error.response?.status === 403 && error.response.data?.code === "mfa_setup_required") {
      mfaSetupListener?.();
    }
    if (error.response?.status === 401 && !error.config._retry) {
      if (isAuthEndpoint(error.config.url)) {
        return Promise.reject(error);
      }
      // 代看期间(只读,令牌比记录多活 60 秒)的 401 不刷新:刷新会把管理员的新 access 写进 access 位置,
      // 悄悄结束代看;代看的收场只有一条路(`endImpersonation`)。
      if (getImpersonation()) {
        return Promise.reject(error);
      }

      error.config._retry = true;
      // On web this is only the signed-in marker (the httpOnly cookie is what gets sent); no marker = not signed in.
      const refresh = getRefreshToken();
      if (!refresh) {
        // FL-20: nothing to refresh with. This branch used to fall through to
        // the rejection below without telling the host, so every query went
        // red and the user stayed on a page that could no longer load anything.
        endSession();
      } else {
        try {
          // Whoever gets here first starts the rotation; everyone else waits on
          // the same promise rather than starting a second one.
          if (!refreshInFlight) {
            refreshInFlight = rotateRefreshToken(refresh).finally(() => {
              refreshInFlight = null;
            });
          }
          const access = await refreshInFlight;
          error.config.headers.Authorization = `Bearer ${access}`;
          return api(error.config);
        } catch (refreshError) {
          // Only the server refusing the refresh token ends the session. No response at all (offline, timeout)
          // or a 5xx says nothing about the token: ending the session there threw an officer on a bad
          // connection back to sign-in. The original request is rejected below and can be retried.
          const status = (refreshError as { response?: { status?: number } })?.response?.status;
          if (status !== undefined && status >= 400 && status < 500 && status !== 429) endSession();
        }
      }
    }
    return Promise.reject(error);
  }
);

/** 取全部分页时同时在路上的请求数上限。 */
export const FETCH_ALL_CONCURRENCY = 4;

/**
 * Every page of a DRF-paginated list, flattened, in page order — through any per-page fetcher
 * (`(n) => someApi.list({ page: n })`), so a caller keeps its own typed API module.
 *
 * Page 1 first; its `count` and length give the number of pages, and the rest go out together,
 * at most `concurrency` at a time (2026-10-30 D5: the statute corpus was nine round trips one
 * after another, and there were four copies of the serial walk). A first page without `next`
 * is the whole answer. A first page with `next` but no usable `count` (an older or hand-written
 * response) falls back to following `next` one page at a time, so nothing is cut short.
 *
 * Pages are numbered, not followed by their `next` URL — which is also why the old string
 * surgery on `next` (and its note about React Native's partial `URL`) is gone.
 */
export async function collectPages<T>(
  fetchPage: (page: number) => Promise<PaginatedResponse<T>>,
  concurrency: number = FETCH_ALL_CONCURRENCY
): Promise<T[]> {
  const first = await fetchPage(1);
  if (!first.next) return first.results;
  const size = first.results.length;
  if (!(typeof first.count === "number" && size > 0)) {
    const rows = [...first.results];
    for (let n = 2, page = first; page.next; n += 1) {
      page = await fetchPage(n);
      rows.push(...page.results);
    }
    return rows;
  }
  const last = Math.ceil(first.count / size);
  const pages: T[][] = [first.results];
  let next = 2;
  const worker = async () => {
    while (next <= last) {
      const n = next++;
      pages[n - 1] = (await fetchPage(n)).results;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, last - 1)) }, worker));
  return pages.flat();
}

/**
 * Walk every page of a DRF-paginated list endpoint and return the flattened
 * results. Callers that need the whole collection (realms, actors, menus) rather
 * than one page use this instead of `api.get`. Page 1 is requested with exactly
 * `params`; later pages add `page=N` (see `collectPages`).
 */
export async function fetchAllPages<T>(url: string, params: Record<string, string> = {}): Promise<T[]> {
  return collectPages<T>(async (page) => {
    const pageParams = page === 1 ? params : { ...params, page: String(page) };
    return (await api.get<PaginatedResponse<T>>(url, { params: pageParams })).data;
  });
}

/**
 * Why reading ONE thing failed, for a screen that opened it (Design 第四十批 O-c, both apps):
 * `gone` = the server answered 404 or 403 -- deleted, or no longer this account's to see. One answer
 * for both on purpose: saying "no permission" tells the reader it still exists. `network` = no answer
 * at all (offline, timeout); `other` = any other answer (5xx, 400...), which a retry may fix.
 */
export type FetchFailure = "gone" | "network" | "other";

/**
 * The `code` of a failed request's `{detail, code}` / `{error, code}` body, or `null` (no response,
 * no body, a non-string code). Reads any rejection shaped like an axios error, so tests' plain
 * `{ response: { data } }` objects work too.
 */
export function responseCode(error: unknown): string | null {
  const code = responseData<{ code: unknown }>(error)?.code;
  return typeof code === "string" ? code : null;
}

/** The HTTP status of a failed request, or `null` when there was no answer (same shapes as `responseCode`). */
export function responseStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === "number" ? status : null;
}

/**
 * The body of a failed request, for a refusal that carries more than its `code` (`count`, `retry_after`,
 * `missing_roles` …). Every field is optional because nothing checks the server sent it; read the `code` with
 * `responseCode`, which also checks its type.
 */
export function responseData<T extends object = Record<string, unknown>>(error: unknown): Partial<T> | undefined {
  return (error as { response?: { data?: Partial<T> } } | null)?.response?.data ?? undefined;
}

/** The legacy `{error: "..."}` sentence of a failed request, when it is a string; else `undefined`. */
export function responseError(error: unknown): string | undefined {
  const text = responseData<{ error: unknown }>(error)?.error;
  return typeof text === "string" ? text : undefined;
}

export function fetchFailureOf(error: unknown): FetchFailure {
  const response = (error as { response?: { status?: number } } | null)?.response;
  if (!response) return "network";
  return response.status === 404 || response.status === 403 ? "gone" : "other";
}

