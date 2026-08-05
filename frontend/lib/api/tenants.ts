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
  created_at?: string;
}

export const tenantsApi = {
  list: () => api.get<PaginatedResponse<Tenant>>("/tenants/"),
  // TenantViewSet sets lookup_field = "code" (backend/apps/tenants/views.py:9),
  // so the detail route is /tenants/{code}/ — a numeric id does not address it.
  get: (code: string) => api.get<Tenant>(`/tenants/${code}/`),
};
