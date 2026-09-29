import { api } from "./client";
import type { PaginatedResponse } from "./users";

export interface Tenant {
  id: number;
  code: string;
  display_name: string;
  description?: string;
  is_active?: boolean;
  dispatch_enabled?: boolean;
  api_endpoint?: string;
  settings?: Record<string, unknown>;
  /** `TENANT_CIVILIZATION[code]`, or `"UNKNOWN"` for a tenant outside that map. */
  civilization?: string;
  /** 匾上的印字,0–2 个;空 = 用文明默认字。只有 ADMIN 能改(`updateSealGlyphs`)。 */
  seal_glyphs?: string[];
  created_at?: string;
}

export const tenantsApi = {
  list: () => api.get<PaginatedResponse<Tenant>>("/tenants/"),
  // TenantViewSet sets lookup_field = "code" (backend/apps/tenants/views.py:9),
  // so the detail route is /tenants/{code}/ — a numeric id does not address it.
  get: (code: string) => api.get<Tenant>(`/tenants/${code}/`),
  /** ADMIN only. Wrong script or too many glyphs is a 400 on `seal_glyphs`, never truncated. */
  updateSealGlyphs: (code: string, sealGlyphs: string[]) =>
    api.patch<Tenant>(`/tenants/${code}/seal-glyphs/`, { seal_glyphs: sealGlyphs }),
};
