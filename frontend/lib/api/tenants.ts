import { api } from "./client";

export interface Tenant {
  id: number;
  code: string;
  display_name: string;
  api_endpoint?: string;
  settings?: Record<string, unknown>;
  created_at?: string;
}

export const tenantsApi = {
  list: () => api.get("/tenants/"),
  get: (id: number) => api.get(`/tenants/${id}/`),
};
