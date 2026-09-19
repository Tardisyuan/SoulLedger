import { api } from "./client";
import type { components } from "./generated/schema";
import type { PaginatedResponse } from "./users";

/**
 * `/api/v1/sentence-plans/` — the ordered stops a soul serves after its case
 * is concluded (docs/ARCHITECTURE-sentence-plan.md; backend/apps/sentence_plan/views.py).
 *
 * Readable by the soul's home tenant and by any tenant that has a node on the
 * plan (a third tenant gets 404). Deciding a request and cancelling the plan
 * are home-only (403 `not_home`); withdrawing is the filing tenant's only
 * (403 `not_requester`). A refusal carries `code` and, for `open_judgment`,
 * `open_judgment_ids`.
 */
type Schemas = components["schemas"];
export type SentencePlan = Schemas["SentencePlan"];
export type SentenceNode = Schemas["SentenceNode"];
export type SentencePlanRequest = Schemas["SentencePlanRequest"];
export type SentencePlanStatus = Schemas["SentencePlanStatusEnum"];
export type SentenceNodeStatus = Schemas["SentenceNodeStatusEnum"];

/**
 * `changes` is a free JSON column on the wire (`unknown` in the schema). This
 * is the shape `apps/sentence_plan/requests.py::normalize_changes` writes back:
 * added nodes carry the filing tenant's code, removals are node ids.
 */
export interface SentenceRequestChanges {
  add?: { tenant_code?: string; realm_code: string; sentence_years?: number | null; reason?: string }[];
  remove?: string[];
}

export interface SentencePlanFilters {
  soul?: string;
  status?: SentencePlanStatus;
  /** `true`: plans with a request awaiting the original judge — the request inbox. */
  pending_request?: boolean;
  page?: number;
}

/**
 * Situations 2.1 / 2.2: the filing tenant's judge asks the original judge
 * (`POST /{id}/requests/`). REOPEN carries no `changes`; its reason is required.
 * Refusals: 400 `soul_is_here` (open an amendment judgment instead),
 * `foreign_node` / `foreign_realm` (N2=(a): only stops in your own civilization),
 * `node_not_pending`, `unknown_node`, `empty_changes`, `invalid_changes`,
 * `reason_required`; 409 `request_pending`, `plan_held`, `plan_in_retrial`, `plan_closed`.
 */
export interface FileSentenceRequestBody {
  kind: "AMEND" | "REOPEN";
  changes?: SentenceRequestChanges;
  reason?: string;
}

export const sentencePlansApi = {
  list: (params: SentencePlanFilters) =>
    api.get<PaginatedResponse<SentencePlan>>("/sentence-plans/", { params }),
  get: (planId: string) => api.get<SentencePlan>(`/sentence-plans/${planId}/`),
  file: (planId: string, body: FileSentenceRequestBody) =>
    api.post<SentencePlanRequest>(`/sentence-plans/${planId}/requests/`, body),
  decide: (planId: string, requestId: string, body: { decision: "ACCEPT" | "REJECT"; reason?: string }) =>
    api.post<SentencePlan>(`/sentence-plans/${planId}/requests/${requestId}/decide/`, body),
  withdraw: (planId: string, requestId: string) =>
    api.post<SentencePlan>(`/sentence-plans/${planId}/requests/${requestId}/withdraw/`),
  /** Pardons the rest of the sentence (D1). `reason` is required and audited. */
  cancel: (planId: string, reason: string) =>
    api.post<SentencePlan>(`/sentence-plans/${planId}/cancel/`, { reason }),
};
