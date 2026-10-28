/**
 * The officer mobile app's endpoints: `/api/v1/officer-app/*`
 * (backend/apps/officer_app/views.py). Decisions themselves use the existing
 * endpoints -- `workflowApi.approveNode` (send `require_reason: true`),
 * cooldown-shortening and dispatch -- this module is the aggregate, the
 * per-item "still mine?" answer, add-signer candidates and push devices.
 */
import { api } from "./client";
import type { components } from "./generated/schema";

export type TodoItem = components["schemas"]["TodoItem"];
export type TodoGroup = components["schemas"]["TodoGroup"];
/**
 * Spelled out until the schema is regenerated (Design 第四十批); once it is, each intersection is a no-op:
 * `sentence_changes` (O-f), a row's `request_kind`, a rebirth's `cross_civilization` (O-b), a dispatch's `status` (O-f).
 */
export type Todo = components["schemas"]["Todo"] & { sentence_changes?: TodoGroup; pick_nodes?: TodoGroup };
export type TodoItemDetail = components["schemas"]["TodoItemDetail"];
export type SignerCandidate = components["schemas"]["SignerCandidate"];
export type OfficerPushToken = components["schemas"]["OfficerPushToken"];
export type TodoFacts = components["schemas"]["TodoFacts"] & { cross_civilization?: boolean | null; status?: string };
/**
 * Per-kind row fields. A `pick` row (待我选站, 第四十三批): `title` is the soul, `target.id` the workflow; this
 * realm's `segment_order`, its stations to run / all (`go` / `total`), the convening hall (`realm` code, `hall`
 * name -- the database's English, a fallback only; `court` the judgment's court), and `gate_days` when the flow
 * already waits at this realm's gate, else `stations_ahead`. Read the hall through `pickHall`.
 */
export type TodoItemExtra = {
  request_kind?: string;
  segment_order?: number;
  go?: number;
  total?: number;
  realm?: string;
  hall?: string;
  court?: string;
  gate_days?: number | null;
  stations_ahead?: number | null;
  /** 城隍初审(kind = city_god):PENDING / RETURNED、城隍名、出身地、枉死。 */
  city_god_status?: string;
  city_god_name?: string;
  origin_location?: string;
  untimely?: boolean;
  /** 枉死申诉(kind = wangsi,第五十九批 M-3):冤情等级(未登记为空串);城隍名在 `city_god_name`。 */
  grievance_level?: string;
};
export type FactHistory = components["schemas"]["FactHistory"];
export type FactAttachment = components["schemas"]["FactAttachment"];
export type FactSoul = components["schemas"]["FactSoul"];
export type Cosigner = components["schemas"]["Cosigner"];

/**
 * The kinds of waiting item; `target` on a row is `{ kind, id }`. `letter` (待回书信) is a soul's
 * letter assigned to me: its id is the inbox conversation's, and it has no `item()` detail --
 * the thread is read and answered through `soulInboxApi`. `sentence_change` (受刑计划变更请求) is view-only and
 * has no `item()` detail either: it is decided on the desk. `pick` (待我选站, 第四十三批) has no `item()` detail:
 * its id is the workflow's, read through `workflowApi.get` and picked through `workflowApi.pickSegment`.
 * `city_god` (城隍初审, 第五十三批) has no `item()` detail: its id is the judgment's, read through
 * `cityGodCasesApi.get` and decided through `sendOn` / `returnCase`. `wangsi` (枉死申诉, 第五十九批) has no `item()`
 * detail either: its id is the judgment's, read through `judgmentApi.get` and decided through `wangsiApi.decideGrievance`.
 */
export type TodoKind = "approval" | "reassignment" | "cooldown" | "rebirth" | "letter" | "sentence_change" | "pick" | "city_god" | "wangsi";

/**
 * Why a decision (approve / reject) did not go through. `code` on the error body of
 * `workflows/<id>/approve_node/`. A bare 403 with no `code` comes from the permission
 * layer (the role lost `workflow.approve`) and means the same as `permission_changed`.
 */
export const DECISION_FAILURE_CODES = [
  "already_handled", // body also has `handled_by: { id, name }`
  "deadline_passed",
  "permission_changed",
  "no_approver",
  "reason_required",
] as const;
export type DecisionFailureCode = (typeof DECISION_FAILURE_CODES)[number];

/** The failure code on an axios-style error, or null when it is not one of ours
 *  (network error, 5xx, ...). 403 without a code reads as `permission_changed`. */
export function decisionFailureOf(error: unknown): { code: DecisionFailureCode; handledBy: { id: number | null; name: string } | null } | null {
  const response = (error as { response?: { status?: number; data?: { code?: string; handled_by?: { id: number | null; name: string } | null } } })?.response;
  if (!response) return null;
  const code = response.data?.code;
  if (code && (DECISION_FAILURE_CODES as readonly string[]).includes(code)) {
    return { code: code as DecisionFailureCode, handledBy: response.data?.handled_by ?? null };
  }
  return response.status === 403 ? { code: "permission_changed", handledBy: null } : null;
}

/** The refusal body of `addCosigner`, or null when the error is not one (network, 5xx...). */
export function cosignRefusalOf(error: unknown): "not_allowed" | "not_eligible" | "duplicate" | null {
  const response = (error as { response?: { data?: { code?: string } } })?.response;
  const code = response?.data?.code;
  return code === "not_allowed" || code === "not_eligible" || code === "duplicate" ? code : null;
}

/** 我的数(`GET /officer-app/stats/`):只数调用者自己的。 */
export type OfficerStats = {
  concluded_this_month: number;
  concluded_total: number;
  open_claims: number;
  appeals_reviewed: number;
  appeals_in_review: number;
};

export const officerAppApi = {
  stats: () => api.get<OfficerStats>("/officer-app/stats/"),
  todo: () => api.get<Todo>("/officer-app/todo/"),
  /** 加载更多: one group from item `offset` on (10 a page), `{ count, items }`. */
  todoGroup: (kind: TodoKind | "unassigned_letter", offset: number) => api.get<TodoGroup>("/officer-app/todo/", { params: { kind, offset } }),
  item: (kind: TodoKind, id: string) => api.get<TodoItemDetail>(`/officer-app/items/${kind}/${id}/`),
  /** 加签候选人: same hall only. */
  signerCandidates: (q?: string) => api.get<SignerCandidate[]>("/officer-app/signer-candidates/", { params: q ? { q } : undefined }),
  /**
   * 加签: add a same-hall colleague as co-signer of the current node. 403 `not_allowed` = adding is not
   * possible right now (read it with `cosignRefusalOf`); 400 `not_eligible` / `duplicate` = this person.
   */
  addCosigner: (kind: TodoKind, id: string, userId: number) =>
    api.post<Cosigner>(`/officer-app/items/${kind}/${id}/cosigners/`, { user_id: userId }),
  registerPush: (data: OfficerPushToken) => api.post<void>("/officer-app/push-tokens/", data),
  unregisterPush: (token: string) => api.post<void>("/officer-app/push-tokens/unregister/", { token }),
};
