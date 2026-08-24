import axios from "axios";
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

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift() || null;
  return null;
}

function getTenantId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("tenant_id") || getCookie("tenant_id") || "";
}

/** 200 body of POST /auth/refresh/ (SimpleJWT TokenRefreshView). */
interface TokenRefreshResponse {
  access: string;
  refresh: string;
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Add JWT token and tenant ID to every request
api.interceptors.request.use((config) => {
  const token = getCookie("soulledger_access") || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("soulledger_access") : null);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const tenantId = getTenantId();
  if (tenantId) {
    config.headers["X-Tenant-ID"] = tenantId;
  }
  return config;
});

// Handle 401 → redirect to login (skip for auth endpoints which handle their own errors)
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      const isAuthEndpoint = /^\/api\/v1\/auth\/(login|register|refresh)\/?$/.test(error.config.url || '');
      if (isAuthEndpoint) {
        return Promise.reject(error);
      }

      error.config._retry = true;
      const refresh = getCookie("soulledger_refresh");
      if (refresh) {
        try {
          // SIMPLE_JWT has ROTATE_REFRESH_TOKENS=True and BLACKLIST_AFTER_ROTATION=True,
          // so the server blacklists the refresh token we just sent and issues a new
          // one in `data.refresh`. It MUST be persisted (same cookie the login flow
          // writes to) or the next refresh will present an already-blacklisted token
          // and the user gets silently booted to /login.
          const { data } = await axios.post<TokenRefreshResponse>(`${API_BASE_URL}/auth/refresh/`, { refresh });
          if (typeof document !== "undefined") {
            document.cookie = `soulledger_access=${data.access}; path=/; max-age=86400; SameSite=Lax`;
            document.cookie = `soulledger_refresh=${data.refresh}; path=/; max-age=604800; SameSite=Lax`;
          }
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem("soulledger_access", data.access);
          }
          error.config.headers.Authorization = `Bearer ${data.access}`;
          return api(error.config);
        } catch {
          // Refresh failed — clear tokens and redirect
          if (typeof document !== "undefined") {
            document.cookie = "soulledger_access=; path=/; max-age=0";
            document.cookie = "soulledger_refresh=; path=/; max-age=0";
          }
          if (typeof window !== "undefined") {
            window.location.href = "/login";
          }
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

export { getCookie, getTenantId };
