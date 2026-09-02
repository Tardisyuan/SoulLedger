import axios from "axios";
import {
  ACCESS_TOKEN_KEY,
  getAccessToken,
  getRefreshToken,
  REFRESH_TOKEN_KEY,
  getTenantId,
  platform,
  setAccessToken,
  setRefreshToken,
} from "../platform/index";
// Type-only import: erased at compile time, so this does not create a runtime
// import cycle with users.ts (which imports `api` from here as a value).
import type { PaginatedResponse } from "./users";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
export const API_BASE = API_BASE_URL;

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
 * `getCookie`, `getTenantId`, `getAccessToken`, `clearAccessCookie` and
 * `refreshCookie` used to be defined right here, reading `document.cookie`,
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
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Add JWT token and tenant ID to every request
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const tenantId = getTenantId();
  if (tenantId) {
    config.headers["X-Tenant-ID"] = tenantId;
  }
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

export async function rotateRefreshToken(refresh: string): Promise<string> {
  // SIMPLE_JWT has ROTATE_REFRESH_TOKENS=True and BLACKLIST_AFTER_ROTATION=True,
  // so the server blacklists the refresh token we just sent and issues a new
  // one in `data.refresh`. It MUST be persisted (same place the login flow
  // writes to — on web that is the `soulledger_refresh` cookie) or the next
  // refresh will present an already-blacklisted token and the user gets
  // silently booted to /login.
  const { data } = await axios.post<TokenRefreshResponse>(
    `${API_BASE_URL}/auth/refresh/`,
    { refresh }
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
  setAccessToken(data.access);
  // The removal below is not tidiness — a browser that has been through the old
  // code still has that cookie, and a persistent-first reader would keep
  // preferring it over the fresh token in the session store.
  platform().persistent.remove(ACCESS_TOKEN_KEY);
  setRefreshToken(data.refresh);
  return data.access;
}

// Handle 401 → redirect to login (skip for auth endpoints which handle their own errors)
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      if (isAuthEndpoint(error.config.url)) {
        return Promise.reject(error);
      }

      error.config._retry = true;
      const refresh = getRefreshToken();
      if (refresh) {
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
        } catch {
          // Refresh failed — clear tokens and hand the host the decision about
          // where the user goes. `window.location.href = "/login"` was the one
          // line in this file that assumed a browser with a URL bar; a native
          // client resets its navigator instead.
          platform().session.remove(ACCESS_TOKEN_KEY);
          platform().persistent.remove(ACCESS_TOKEN_KEY);
          platform().persistent.remove(REFRESH_TOKEN_KEY);
          platform().onUnauthorized();
        }
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Walk every page of a DRF-paginated list endpoint and return the flattened
 * results. Callers that need the whole collection (realms, actors) rather than
 * one page use this instead of `api.get`.
 */
export async function fetchAllPages<T>(url: string, params: Record<string, string> = {}): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = `${API_BASE}${url}?${new URLSearchParams(params)}`;
  while (nextUrl) {
    const parsed: URL = new URL(nextUrl);
    const searchParams: Record<string, string> = {};
    parsed.searchParams.forEach((v: string, k: string) => { searchParams[k] = v; });
    const relativePath: string = nextUrl.replace(API_BASE, "");
    const resp = await api.get<PaginatedResponse<T>>(relativePath, { params: searchParams });
    results.push(...resp.data.results);
    nextUrl = resp.data.next ? (resp.data.next.startsWith("http") ? resp.data.next : `${API_BASE}${resp.data.next}`) : null;
  }
  return results;
}

export { getTenantId };
