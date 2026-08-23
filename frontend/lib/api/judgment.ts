import { api } from "./client";
import type { LedgerSummary } from "./ledger";
import type { NumericFields } from "./ledgerQuantities";
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
  /**
   * The articles this verdict rests on, nested by JudgmentSerializer.
   * Always present, possibly empty — a judgment with no cited grounds is a
   * valid (older, or simply unfounded) record, not a loading state.
   */
  citations: JudgmentCitation[];
  is_final: boolean;
  created_at: string;
  concluded_at: string | null;
}

/**
 * `apps.judgment.models.StatuteCorpus`. Three rulebooks, not one taxonomy:
 * `HELL_LAW` is 冥律 statute, `NEGATIVE_CONFESSION` is the Forty-Two's
 * declarations of innocence, `DEADLY_SIN` is Gregory's seven with Dante's
 * circles. Each belongs to exactly one civilization.
 */
export type StatuteCorpus = "HELL_LAW" | "NEGATIVE_CONFESSION" | "DEADLY_SIN";

/** `apps.judgment.models.StatutePolarity` — which way the article cuts. */
export type StatutePolarity = "OFFENCE" | "MERIT" | "DENIAL";

export interface Statute {
  id: string;
  code: string;
  civilization: string;
  corpus: StatuteCorpus;
  ordinal: number;
  polarity: StatutePolarity;
  title_zh: string;
  title_en: string;
  title_egy: string;
  text_zh: string;
  text_en: string;
  text_egy: string;
  /** Server-resolved against Accept-Language, the way RealmLocalizedSerializer does it. */
  display_title: string;
  /**
   * The article body. For a DERIVED article (the Egyptian 42) the `text_*`
   * columns are empty by design and this is read from the linked assessor's
   * record — so render this, never `text_en`.
   */
  display_text: string;
  is_derived: boolean;
  source: string;
  source_notes: string[];
  payload_json: Record<string, unknown>;
}

export interface JudgmentCitation {
  id: string;
  statute: Statute;
  /** How this article applies to this case. */
  note: string;
  created_at: string;
}

export interface ConcludeJudgmentPayload {
  verdict: string;
  notes?: string;
  create_workflow?: boolean;
  /** Grounds filed with the verdict; refused ids abort the conclusion. */
  statute_ids?: string[];
}

/**
 * `GET /judgment/next/` — the triage queue's cursor (BRIEF §4.2).
 *
 * One response carries the whole decision surface, which is the entire point:
 * the paginated list plus five follow-up requests per row is exactly the
 * per-item navigation cost the queue exists to remove.
 *
 * `judgment` is null when the queue is exhausted — a 200, not a 404, so the
 * "nothing left" screen is a render and not an error boundary.
 */
export interface JudgmentQueueCursor {
  /** Pending judgments in scope right now. Falls as verdicts land. */
  total: number;
  /** Pending minus the ids the caller asked to skip. */
  remaining: number;
  /** How many of the requested skips are still live in scope. */
  skipped: number;
  /** 1-based index of `judgment` within `total`; null when the queue is empty. */
  position: number | null;
  judgment: Judgment | null;
  soul: QueueSoul | null;
  ledger: QueueLedger | null;
  prior_cycles: QueuePriorCycle[];
  realm_options: QueueRealm[];
}

/** SoulSerializer, narrowed to what the queue card actually renders. */
export interface QueueSoul {
  id: string;
  name: string;
  current_state: string;
  civilization: string;
  tenant_code: string | null;
  birth_date: { year: number; month: number | null; day: number | null } | null;
  death_date: { year: number; month: number | null; day: number | null } | null;
  origin_location: string;
  birth_name: string;
  description: string;
  merit_score: number | null;
  demerit_score: number | null;
  karmic_balance: number;
}

/** LedgerService.get_ledger_summary — the same body `/souls/{id}/karma/` returns. */
export interface QueueLedger {
  soul_id: string;
  soul_name: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  record_count: number;
  records: QueueLedgerRecord[];
  reading?: { kind: string; civilization: string; [key: string]: unknown };
}

/** `true` only when two types have the same numeric fields. */
type SameNumbers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * The triage card draws this payload's three sums with `SUMMARY_QUANTITIES`,
 * which is declared over `LedgerSummary`. That is legitimate only for as long
 * as the two payloads carry the same numbers under the same names — which they
 * do, because both are `LedgerService.get_ledger_summary`'s body, declared
 * twice because two feature slices type it separately.
 *
 * Declared twice is the whole risk. A number added to one declaration and not
 * the other would leave the queue reading a classification table that has never
 * heard of it, and `Record<NumericFields<LedgerSummary>, QuantityKind>` cannot
 * notice: it is a statement about `LedgerSummary`, and nothing was asking it
 * about `QueueLedger`. This makes it ask. A field on either side without a
 * matching one on the other resolves this to `never` and the assignment fails
 * to compile.
 *
 * Exported so it is not an unused binding, the same device as
 * `READING_KINDS_AGREE`.
 */
export const QUEUE_LEDGER_NUMBERS_ARE_SUMMARY_NUMBERS: SameNumbers<
  NumericFields<QueueLedger>,
  NumericFields<LedgerSummary>
> = true;

export interface QueueLedgerRecord {
  id: string;
  record_type: string;
  category: string;
  description: string;
  weight: number;
  effective_weight?: number;
  recorded_at: string;
}

export interface QueuePriorCycle {
  id: string;
  cycle_count: number;
  target_realm: string;
  previous_realm: string;
  rebirth_form: string;
  new_identity: string;
  reincarnated_at: string;
}

export interface QueueRealm {
  id: string;
  realm_code: string;
  civilization: string;
  display_name: string;
  name_local: string;
  realm_type: string;
  tier: number | null;
  is_eternal: boolean;
}

export interface JudgmentQueueParams {
  /** Session-local skip list. Repeated, so the server never holds this state. */
  skip?: string[];
  /** Enter the queue on a named case (deep link from a soul's lifecycle spine). */
  at?: string;
}

export const judgmentApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Judgment>>("/judgment/", { params }),
  create: (data: object) => api.post<Judgment>("/judgment/", data),
  conclude: (id: string, data: ConcludeJudgmentPayload | object) => api.post<Judgment>(`/judgment/${id}/conclude/`, data),
  get: (id: string) => api.get<Judgment>(`/judgment/${id}/`),
  /**
   * Skips travel as repeated `skip=` params rather than one comma-joined
   * value: both are accepted by the endpoint, and the repeated form keeps a
   * long list readable in a network log when someone is debugging why an item
   * will not come back.
   */
  /**
   * The articles a verdict can be founded on. Read-only server-side — the
   * corpus is seeded from documents whose provenance is recorded per row, so
   * there is deliberately no create/update here.
   */
  statutes: (params?: Record<string, string>) =>
    api.get<PaginatedResponse<Statute>>("/judgment/statutes/", { params }),
  citations: (id: string) => api.get<JudgmentCitation[]>(`/judgment/${id}/citations/`),
  cite: (id: string, statute: string, note = "") =>
    api.post<JudgmentCitation>(`/judgment/${id}/citations/`, { statute, note }),
  uncite: (id: string, statute: string) =>
    api.delete(`/judgment/${id}/citations/${statute}/`),
  next: (params?: JudgmentQueueParams) => {
    const search = new URLSearchParams();
    for (const id of params?.skip ?? []) search.append("skip", id);
    if (params?.at) search.set("at", params.at);
    const qs = search.toString();
    return api.get<JudgmentQueueCursor>(`/judgment/next/${qs ? `?${qs}` : ""}`);
  },
};
