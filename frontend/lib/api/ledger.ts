import { api } from "./client";

export interface LedgerStatsOverview {
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

export interface LedgerRecord {
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

export interface LedgerSummary {
  soul_id: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  record_count?: number;
  records: LedgerRecord[];
}

// 200 body of GET /ledger/inheritance/{soul_id}/.
export interface LedgerInheritance {
  soul_id: string;
  inherited_merit: number;
  inherited_demerit: number;
  inheritance_note: string;
}

// 409 body — the soul's cosmology is terminal (e.g. Egyptian judgment ending
// at Aaru/Ammit, or European judgment ending at Heaven/Hell/Purgatory-then-
// Heaven), so there is no next life to inherit into.
export interface LedgerInheritanceNotApplicable {
  code: string;
  civilization: string;
  detail: string;
}

export const ledgerApi = {
  balance: (soulId: number) => api.get(`/ledger/balance/${soulId}/`),
  effective: (soulId: number) => api.get(`/ledger/effective/${soulId}/`),
  recalculate: (soulId: number) => api.post(`/ledger/calculate/${soulId}/`),
  // Note the ordering: inheritance/ comes before the soul id in the URLconf.
  inheritance: (soulId: string) => api.get<LedgerInheritance>(`/ledger/inheritance/${soulId}/`),
  statsOverview: () => api.get<LedgerStatsOverview>("/ledger/stats/overview/"),
  exportStats: (params?: Record<string, string>) => api.get("/ledger/stats/export/", { params, responseType: "blob" }),
};
