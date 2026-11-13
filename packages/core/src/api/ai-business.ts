import { api } from "./client";

/**
 * Business AI on the judging desk and the moderation queue (docs/audit/2026-11-12-portfolio-ai-ideas.md part two,
 * points 1, 2 and 4). Every answer is a suggestion: citing still goes through `POST judgment/<id>/citations/`, the
 * verdict text through `PATCH judgment/<id>/draft/`, and moderation through the existing actions. What a person did
 * with a suggestion is reported with `officerAssistApi.decideDraft(draft_id, …)`.
 *
 * Contracts: backend/apps/judgment/ai_views.py and backend/apps/social/moderation_serializers.py
 * (`AIScreenResponse`). Hand-written until `openapi/schema.yml` is regenerated with them.
 */
export interface StatuteSuggestion {
  statute: string;
  code: string;
  title: string;
  /** The article itself: the judge reads it before citing. */
  text: string;
  /** The model's reason; empty for keyword matches. */
  why: string;
  source: "model" | "keyword";
}

export interface StatuteSuggestions {
  suggestions: StatuteSuggestion[];
  /** Codes the model gave that it never saw, or that are already cited. */
  dropped: string[];
  /** AIDraft id; null when nothing came from a model. */
  draft_id: number | null;
  model: string;
  /** True: no model answered; keyword matches only. */
  fallback: boolean;
}

export type ChosenVerdict = "PASSED" | "FAILED" | "PURGATORY" | "RETRY";

export interface VerdictDraftChecks {
  /** Article codes in the text that are not among the adopted citations. */
  unknown_codes: string[];
  /** Words of a verdict other than the chosen one. */
  contrary_verdict_words: string[];
  names_soul: boolean;
}

export interface VerdictDraft {
  text: string;
  draft_id: number | null;
  model: string;
  /** True: a template sentence, not a model. */
  fallback: boolean;
  checks: VerdictDraftChecks;
}

export type AIScreenSignal = "sensitive_word" | "reported" | "injection_phrase" | "media";

export interface AIScreenScore {
  id: string;
  /** 0–100; only ever used to sort. */
  score: number;
  /** The model's one-line reason; empty for a rule-only score. */
  reason: string;
  signals: AIScreenSignal[];
  source: "model" | "rule";
}

export interface AIScreenResult {
  items: AIScreenScore[];
  model: string;
  fallback: boolean;
}

export const judgmentAiApi = {
  /** 409 `concluded`; 403 `not_claimant` when someone else holds the case. */
  statuteSuggestions: (id: string) =>
    api.post<StatuteSuggestions>(`/judgment/${id}/statute-suggestions/`, {}).then((r) => r.data),
  /** Only once the judge has chosen `verdict`. The text goes into the editor, never straight into `notes`. */
  verdictDraft: (id: string, verdict: ChosenVerdict) =>
    api.post<VerdictDraft>(`/judgment/${id}/verdict-draft/`, { verdict }).then((r) => r.data),
};

export const moderationAiApi = {
  /** Scores the first 30 PENDING rows of the queue (stored ones are reused). Changes no row's status. */
  // Two literal paths, not `${kind}`: the schema serves exactly these two, and the endpoint contract test checks
  // each path the client can ask for.
  screen: (kind: "posts" | "comments") =>
    api
      .post<AIScreenResult>(kind === "posts" ? "/social-moderation/posts/ai-screen/" : "/social-moderation/comments/ai-screen/", {})
      .then((r) => r.data),
};
