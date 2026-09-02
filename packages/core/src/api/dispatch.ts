import { api } from "./client";
import type { PaginatedResponse } from "./users";

export interface DispatchRecord {
  id: string;
  source_tenant: number;
  source_tenant_code: string;
  target_tenant: number;
  target_tenant_code: string;
  soul: string;
  soul_name: string;
  /**
   * The proposing user's **integer primary key**, or null.
   *
   * WAS `string`, AND THAT IS WHY `app/dispatch/[id]/page.tsx:202` RENDERS AN
   * ID. `DispatchRecord.dispatched_by` is a plain `ForeignKey` to
   * `authentication.User` with `on_delete=SET_NULL, null=True` and no `source=`
   * override, so DRF serialises it as the pk — a number. Two independent
   * derivations agree: the model declaration, and the generated
   * `components["schemas"]["DispatchRecord"]["dispatched_by"]`, which is
   * `number | null`.
   *
   * The page renders `{dispatch.dispatched_by_name || dispatch.dispatched_by}`.
   * `dispatched_by_name` is `CharField(source="dispatched_by.username",
   * allow_null=True)`, so when the proposing account is gone the fallback fires
   * and the screen shows a bare user id where a username belongs. Typing this
   * `string` is what made that read as a sensible fallback. The render site is
   * in `frontend/app/`, out of scope for this change and left alone
   * deliberately — the type now tells the truth, and the defect is visible.
   */
  dispatched_by: number | null;
  /** Null when the proposing account has been deleted — `allow_null=True` on
   *  `CharField(source="dispatched_by.username")`. */
  dispatched_by_name: string | null;
  status: string;
  reason: string;
  proposed_at: string;
  decided_at: string | null;
  executed_at: string | null;
  create_time: string;
  update_time: string;
}

/**
 * CrossTenantJudgmentListSerializer (backend/apps/dispatch/serializers.py:148) —
 * the element type of GET /dispatch/cross-tenant-judgments/. It carries six
 * fields and no more: `description`, `participants`, `create_time` and
 * `update_time` are detail-only.
 */
export interface CrossTenantJudgmentListItem {
  id: string;
  title: string;
  initiating_tenant: number;
  initiating_tenant_code: string;
  status: string;
  concluded_at: string | null;
  conclusion_type: string | null;
}

/**
 * CrossTenantJudgmentSerializer — the DETAIL shape
 * (backend/apps/dispatch/serializers.py:125).
 */
export interface CrossTenantJudgment extends CrossTenantJudgmentListItem {
  description: string;
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
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<DispatchRecord>>("/dispatch/records/", { params }),
  get: (id: string) => api.get<DispatchRecord>(`/dispatch/records/${id}/`),
  propose: (data: {
    source_tenant?: number;
    target_tenant?: number;
    source_tenant_code?: string;
    target_tenant_code?: string;
    // Soul PKs are UUIDs (see DispatchRecord.soul above); this was typed as
    // `number` and callers were doing parseInt() on a UUID, which sent NaN.
    soul: string;
    reason: string;
  }) => api.post<DispatchRecord>("/dispatch/records/", data),
  approve: (id: string) => api.post<DispatchRecord>(`/dispatch/records/${id}/approve/`),
  reject: (id: string, reason?: string) => api.post<DispatchRecord>(`/dispatch/records/${id}/reject/`, { reason }),
  execute: (id: string) => api.post<DispatchRecord>(`/dispatch/records/${id}/execute/`),
  proposed: (params?: Record<string, string>) => api.get<PaginatedResponse<DispatchRecord>>("/dispatch/records/", { params: { ...params, status: "PROPOSED" } }),
  history: (params?: Record<string, string>) => api.get<PaginatedResponse<DispatchRecord>>("/dispatch/records/", { params }),
};

export const crossTenantJudgmentsApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<CrossTenantJudgmentListItem>>("/dispatch/cross-tenant-judgments/", { params }),
  get: (id: string) => api.get<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/`),
  create: (data: { title: string; description: string }) => api.post<CrossTenantJudgment>("/dispatch/cross-tenant-judgments/", data),
  participate: (id: string, data: { participant_tenant: number; participant_actor?: number; role?: string }) =>
    api.post<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/participate/`, data),
  // `activate` was deleted 2026-08-31. `CrossTenantJudgmentViewSet` declares
  // only `participate` and `conclude`, so the call 404'd — and the comment
  // above it **said so**, in the file, next to the code, for as long as it
  // existed. A method that documents its own uselessness is still a method the
  // next person will call.
  conclude: (id: string, data: { conclusion_type: string }) =>
    api.post<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/conclude/`, data),
};
