import axios from "axios";
// Type-only import: erased at compile time, so this does not create a runtime
// import cycle with users.ts (which imports `api` from here as a value).
import type { PaginatedResponse } from "./users";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
export const API_BASE = API_BASE_URL;

/**
 * Rows per page. Must match DRF's REST_FRAMEWORK["PAGE_SIZE"] in
 * backend/config/settings.py — the server decides how many results a page
 * holds, and this is only how the client derives the page count from `count`.
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
          // SIMPLE_JWT has ROTATE_REFRESH_TOKENS=True, so the body carries a
          // fresh `refresh` alongside `access`. Only `access` is consumed below.
          const { data } = await axios.post<TokenRefreshResponse>(`${API_BASE_URL}/auth/refresh/`, { refresh });
          if (typeof document !== "undefined") {
            document.cookie = `soulledger_access=${data.access}; path=/; max-age=86400; SameSite=Lax`;
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
