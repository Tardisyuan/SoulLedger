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
export type Todo = components["schemas"]["Todo"];
export type TodoItemDetail = components["schemas"]["TodoItemDetail"];
export type SignerCandidate = components["schemas"]["SignerCandidate"];
export type OfficerPushToken = components["schemas"]["OfficerPushToken"];

/** The four kinds of waiting item; `target` on a row is `{ kind, id }`. */
export type TodoKind = "approval" | "reassignment" | "cooldown" | "rebirth";

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

export const officerAppApi = {
  todo: () => api.get<Todo>("/officer-app/todo/"),
  item: (kind: TodoKind, id: string) => api.get<TodoItemDetail>(`/officer-app/items/${kind}/${id}/`),
  /** 加签候选人: same hall only. */
  signerCandidates: (q?: string) => api.get<SignerCandidate[]>("/officer-app/signer-candidates/", { params: q ? { q } : undefined }),
  registerPush: (data: OfficerPushToken) => api.post<void>("/officer-app/push-tokens/", data),
  unregisterPush: (token: string) => api.post<void>("/officer-app/push-tokens/unregister/", { token }),
};
