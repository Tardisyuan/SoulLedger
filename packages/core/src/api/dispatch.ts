import { api } from "./client";
import type { components } from "./generated/schema";
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
  /** When the residence ended and the soul went back to its home tenant (status RETURNED). */
  returned_at: string | null;
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
  /** The initiating tenant's pk — an id, not something to show. */
  initiating_tenant: number;
  initiating_tenant_code: string;
  /** `Tenant.display_name`, beside the code (added 2026-09-24): the detail page
   *  printed the pk under 「发起方」 for want of it. */
  initiating_tenant_display_name: string;
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
  /** The original judgment this bench sets a sentence plan for; null = a plain
   *  meeting with no soul and no sentence nodes (every pre-plan row). */
  judgment: string | null;
  participants: CrossTenantJudgmentParticipant[];
  create_time: string;
  update_time: string;
}

export interface CrossTenantJudgmentParticipant {
  id: string;
  judgment: string;
  /** The seat tenant's pk — an id, not something to show. */
  participant_tenant: number;
  participant_tenant_code: string;
  /** `Tenant.display_name` of the seat's tenant (added 2026-09-24). */
  participant_tenant_display_name: string;
  participant_actor: string | null;
  participant_actor_name: string | null;
  role: string;
  joined_at: string;
  /**
   * This seat's stop in the sentence plan (docs/ARCHITECTURE-sentence-plan.md
   * §2.2). The home tenant is always stop 1, so seats run from 2. Null for an
   * ADVISOR and on a bench with no judgment. The `sentence_*` fields are
   * written only through `sentence/` (the seat's own tenant); `is_eternal` and
   * `memory_reset` are copied from the realm server-side.
   */
  node_order: number | null;
  sentence_realm_code: string;
  sentence_years: number | null;
  sentence_is_eternal: boolean;
  sentence_memory_reset: string;
  sentence_notes: string;
  /** Null until the seat's tenant has filled its stop; `conclude` refuses until every node seat has. */
  sentence_submitted_at: string | null;
}

/**
 * `DispatchRecordSerializer.validate_reason`: a proposal's reason, trimmed,
 * must be at least this many characters (`DISPATCH_REASON_MIN_CHARS` in
 * backend/apps/dispatch/serializers.py).
 */
export const DISPATCH_REASON_MIN_CHARS = 20;

/**
 * The length the server counts: Python `len` of the trimmed str, i.e. code
 * points. `String.length` counts UTF-16 units and would call a 19-character
 * reason with one astral character 20.
 */
export const dispatchReasonLength = (reason: string) => [...reason.trim()].length;

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
  // A dispatch is a residence, not a change of citizenship (2026-09-17). An
  // EXECUTED record is an ongoing residence; the soul goes home by itself when
  // its disposition there is executed. This ends it early. Home tenant or ADMIN
  // only (403 otherwise); `reason` is required and lands in the audit log.
  returnHome: (id: string, reason: string) =>
    api.post<DispatchRecord>(`/dispatch/records/${id}/return-home/`, { reason }),
  // `/dispatch/records/proposed/`, not the list filtered by status. The list
  // returns both sides of a transfer — `Q(source_tenant=…) | Q(target_tenant=…)`
  // — while `approve` refuses anyone but the target. So filtering the list by
  // status built an approval inbox containing this tenant's own outgoing
  // proposals, each with an Approve button that could only ever 403 into a
  // generic toast. The dedicated action filters `target_tenant=<caller>` and
  // has existed, unused, the whole time.
  //
  // The predicate belongs on the server: expressing it here would mean the
  // client has to know its own tenant code to ask "what is waiting on me".
  proposed: (params?: Record<string, string>) => api.get<PaginatedResponse<DispatchRecord>>("/dispatch/records/proposed/", { params }),
  history: (params?: Record<string, string>) => api.get<PaginatedResponse<DispatchRecord>>("/dispatch/records/", { params }),
};

/** `seatable-actors/`: a deity who may hold a seat, as the seat form needs it. */
export type SeatableActor = components["schemas"]["SeatableActor"];

export const crossTenantJudgmentsApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<CrossTenantJudgmentListItem>>("/dispatch/cross-tenant-judgments/", { params }),
  get: (id: string) => api.get<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/`),
  /** `judgment`: the home tenant's own open ORIGINAL case this bench sets the stops for (fixed once given). */
  create: (data: { title: string; description: string; judgment?: string }) =>
    api.post<CrossTenantJudgment>("/dispatch/cross-tenant-judgments/", data),
  /**
   * Initiator only, while PROPOSED. The seat's tenant by id **or** by code — a
   * non-ADMIN cannot list other tenants' ids. `node_order` (2, 3, …) is required
   * for a CO_JUDGE / CHAIRMAN on a bench attached to a judgment, refused for an ADVISOR.
   */
  participate: (
    id: string,
    data: ({ participant_tenant: number } | { participant_tenant_code: string }) & {
      /** An Actor id (UUID) from `seatableActors` for the same tenant; anything else is 400. */
      participant_actor?: string;
      role?: string;
      node_order?: number | null;
    }
  ) =>
    api.post<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/participate/`, data),
  // `activate` was deleted 2026-08-31 because the backend had no such route
  // and the call 404'd. It is back 2026-09-12 with a real route behind it:
  // activation used to be a side effect of the first `participate`, which
  // capped the bench at one participant (BD-06). Now the initiating tenant
  // convenes explicitly, once at least one participant is seated. 403 for any
  // other tenant, 400 on an empty bench or a judgment past PROPOSED.
  activate: (id: string) => api.post<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/activate/`),
  /**
   * Initiator only, while PROPOSED: the invited tenant's active deities who may
   * hold this kind of seat (design doc D13) — CO_JUDGE / CHAIRMAN take JUDGE
   * actors only, ADVISOR any role. 403 for anyone else, 400 without a seat role.
   */
  seatableActors: (id: string, tenantCode: string, seatRole: "ADVISOR" | "CO_JUDGE" | "CHAIRMAN") =>
    api.get<SeatableActor[]>(`/dispatch/cross-tenant-judgments/${id}/seatable-actors/`, {
      params: { tenant_code: tenantCode, role: seatRole },
    }),
  /** The seat's own tenant fills its stop: a realm of its own civilization, and a term (null = unrecorded). */
  sentence: (id: string, data: { participant: string; realm_code: string; sentence_years: number | null; notes?: string }) =>
    api.post<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/sentence/`, data),
  /** Initiator only, while PROPOSED: every node seat's id in the new order; they become stops 2, 3, …
   *  400 when a filled eternal stop would not be last (Q5). */
  order: (id: string, participants: string[]) =>
    api.post<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/order/`, { participants }),
  conclude: (id: string, data: { conclusion_type: string }) =>
    api.post<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/conclude/`, data),
};
