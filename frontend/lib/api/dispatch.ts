import { api } from "./client";

export interface DispatchRecord {
  id: string;
  source_tenant: number;
  source_tenant_code: string;
  target_tenant: number;
  target_tenant_code: string;
  soul: string;
  soul_name: string;
  dispatched_by: string;
  dispatched_by_name: string;
  status: string;
  reason: string;
  proposed_at: string;
  decided_at: string | null;
  executed_at: string | null;
  create_time: string;
  update_time: string;
}

export interface CrossTenantJudgment {
  id: string;
  title: string;
  description: string;
  initiating_tenant: number;
  initiating_tenant_code: string;
  status: string;
  concluded_at: string | null;
  conclusion_type: string | null;
  participants: CrossTenantJudgmentParticipant[];
  create_time: string;
  update_time: string;
}

export interface CrossTenantJudgmentParticipant {
  id: string;
  judgment: string;
  participant_tenant: number;
  participant_tenant_code: string;
  participant_actor: string | null;
  participant_actor_name: string | null;
  role: string;
  joined_at: string;
}

export const dispatchApi = {
  list: (params?: Record<string, string>) => api.get<DispatchRecord[]>("/dispatch/records/", { params }),
  get: (id: string) => api.get<DispatchRecord>(`/dispatch/records/${id}/`),
  propose: (data: {
    source_tenant?: number;
    target_tenant?: number;
    source_tenant_code?: string;
    target_tenant_code?: string;
    soul: number;
    reason: string;
  }) => api.post<DispatchRecord>("/dispatch/records/", data),
  approve: (id: string) => api.post<DispatchRecord>(`/dispatch/records/${id}/approve/`),
  reject: (id: string, reason?: string) => api.post<DispatchRecord>(`/dispatch/records/${id}/reject/`, { reason }),
  execute: (id: string) => api.post<DispatchRecord>(`/dispatch/records/${id}/execute/`),
  proposed: (params?: Record<string, string>) => api.get<DispatchRecord[]>("/dispatch/records/", { params: { ...params, status: "PROPOSED" } }),
  history: (params?: Record<string, string>) => api.get<DispatchRecord[]>("/dispatch/records/", { params }),
};

export const crossTenantJudgmentsApi = {
  list: (params?: Record<string, string>) => api.get<CrossTenantJudgment[]>("/dispatch/cross-tenant-judgments/", { params }),
  get: (id: string) => api.get<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/`),
  create: (data: { title: string; description: string }) => api.post<CrossTenantJudgment>("/dispatch/cross-tenant-judgments/", data),
  participate: (id: string, data: { participant_tenant: number; participant_actor?: number; role?: string }) =>
    api.post(`/dispatch/cross-tenant-judgments/${id}/participate/`, data),
  activate: (id: string) => api.post(`/dispatch/cross-tenant-judgments/${id}/activate/`),
  conclude: (id: string, data: { conclusion_type: string }) =>
    api.post(`/dispatch/cross-tenant-judgments/${id}/conclude/`, data),
};
