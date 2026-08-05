import { api } from "./client";
import type { PaginatedResponse } from "./users";

/**
 * JudgmentSerializer (backend/apps/judgment/serializers.py:10). The viewset
 * has no get_serializer_class override, so list and detail return the very
 * same fields — there is no separate "judgment detail" shape.
 *
 * `judgment_method` was declared here and is not in the serializer's field
 * list; it never arrives.
 *
 * The serializer mixes in FieldPermissionMixin, which can strip fields
 * per-role from DB-configured rules, so everything past the identity fields
 * is optional in principle.
 */
export interface Judgment {
  id: string;
  soul: string;
  soul_name: string;
  civilization: string;
  /** models.py:37 — the only nullable FK on the model. */
  judge: string | null;
  judge_name: string | null;
  /** `blank=True` CharField/TextField: empty string, never null. */
  court: string;
  evidence_json: Record<string, unknown>;
  confession: string;
  verdict: "PASSED" | "FAILED" | "PURGATORY" | "RETRY" | null;
  notes: string;
  is_final: boolean;
  created_at: string;
  concluded_at: string | null;
}

export interface ConcludeJudgmentPayload {
  verdict: string;
  notes?: string;
  create_workflow?: boolean;
}

export const judgmentApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Judgment>>("/judgment/", { params }),
  create: (data: object) => api.post<Judgment>("/judgment/", data),
  conclude: (id: string, data: ConcludeJudgmentPayload | object) => api.post<Judgment>(`/judgment/${id}/conclude/`, data),
  get: (id: string) => api.get<Judgment>(`/judgment/${id}/`),
};
