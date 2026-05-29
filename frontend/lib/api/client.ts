import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
export const API_BASE = API_BASE_URL;

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
          const { data } = await axios.post(`${API_BASE_URL}/auth/refresh/`, { refresh });
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

export { getCookie, getTenantId };
