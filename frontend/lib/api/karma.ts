import { api } from "./client";

export interface KarmaStatsOverview {
  total_souls: number;
  state_distribution: { state: string; label: string; count: number }[];
  tenants: {
    tenant_id: number;
    tenant_code: string;
    tenant_name: string;
    total_souls: number;
    state_breakdown: Record<string, number>;
  }[];
  karma_distribution: { label: string; count: number }[];
  recent_activity: {
    id: number;
    action: string;
    resource: string;
    resource_id: string;
    description: string;
    user: string;
    timestamp: string;
  }[];
  souls_by_realm: {
    realm_code: string;
    realm_name: string;
    civilization?: string;
    count: number;
  }[];
}

export interface KarmaRecord {
  id: string;
  soul: string;
  type?: string;
  record_type: string;
  category: string;
  description: string;
  weight: number;
  effective_weight: number;
  event_date: string | null;
  recorded_at: string;
  create_time?: string;
}

export interface KarmaSummary {
  soul_id: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  record_count?: number;
  records: KarmaRecord[];
}

export const karmaApi = {
  balance: (soulId: number) => api.get(`/karma/balance/${soulId}/`),
  effective: (soulId: number) => api.get(`/karma/effective/${soulId}/`),
  recalculate: (soulId: number) => api.post(`/karma/calculate/${soulId}/`),
  statsOverview: () => api.get<KarmaStatsOverview>("/karma/stats/overview/"),
  exportStats: (params?: Record<string, string>) => api.get("/karma/stats/export/", { params, responseType: "blob" }),
};
