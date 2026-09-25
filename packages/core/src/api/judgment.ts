import { api } from "./client";
import type { components } from "./generated/schema";
import type { LedgerSummary } from "./ledger";
import type { NumericFields } from "./ledgerQuantities";
import type { SentenceRequestChanges } from "./sentence-plans";
import type { PaginatedResponse } from "./users";

/**
 * JudgmentSerializer (backend/apps/judgment/serializers.py). The list returns
 * this shape; the detail (`GET /judgment/{id}/`) returns `JudgmentDetail`,
 * which adds the evidence rulings and the admitted balance.
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
  /**
   * Server-decided (docs/ARCHITECTURE-sentence-plan.md §2.4): a case opened on a
   * soul with a plan in progress is AMENDMENT; REOPEN is opened only by
   * accepting a request. Optional: FieldPermissionMixin may strip it.
   */
  kind?: "ORIGINAL" | "AMENDMENT" | "REOPEN";
  /** The plan an AMENDMENT / REOPEN case changes; null on an ORIGINAL. */
  amends_plan_id?: string | null;
  /**
   * The verdict draft. `notes` above IS the draft text until the case is
   * concluded; these carry the chosen-but-not-filed verdict, when the draft
   * was last autosaved, and the version a `saveDraft` must send back.
   * Written only through `judgmentApi.saveDraft`.
   */
  draft_verdict?: "PASSED" | "FAILED" | "PURGATORY" | "RETRY" | null;
  draft_saved_at?: string | null;
  draft_version?: number;
  /**
   * The officer (a User pk) working this case — NOT `judge`, which is the
   * mythological judge (an Actor). Written only by claim / release / reassign
   * (`apps/judgment/claims.py`); kept after conclusion as the last holder.
   */
  claimed_by?: number | null;
  claimed_by_name?: string | null;
  claimed_at?: string | null;
  /** 暂缓. Non-null puts the case in the `deferred` group and out of `next/`. */
  deferred_at?: string | null;
  deferred_by?: number | null;
  deferred_by_name?: string | null;
  /** Empty string when not deferred. */
  defer_reason?: string;
  /**
   * merit − demerit, for CHINESE cases only; null for every other cosmology
   * (apps/ledger/readings.py). ABSENT — not null — for a VIEWER, the same
   * floor `SoulSerializer` keeps.
   */
  karmic_balance?: number | null;
  /** Entries in `evidence_json` — the number the detail page's facts column shows. */
  evidence_count?: number;
}

type Schemas = components["schemas"];
/** One ruling on one ledger record in this case. No row = admitted. */
export type EvidenceAdmission = Schemas["EvidenceAdmission"];
/**
 * `LedgerService.get_admitted_balance`. `balance` / `not_admitted_net` are
 * null unless `reading_kind === "BALANCE"`; `reason_code` says why
 * (`BALANCE_NOT_APPLICABLE`, `NOT_CURRENT_LIFE`, or the reading's own
 * `TENANT_NOT_MAPPED`). Render the null as "not applicable", the way
 * `JudgmentQueueContext` renders a non-BALANCE ledger balance.
 */
export type AdmittedBalance = Schemas["AdmittedBalance"];
export type EvidenceRulingResult = Schemas["EvidenceRulingResult"];
export type JudgmentDraft = Schemas["JudgmentDraft"];
/** 409 body of `saveDraft`: `draft_conflict` carries what beat you in `current`. */
export type JudgmentDraftConflict = Schemas["JudgmentDraftConflict"];
/** One row of `GET /judgment/assignable-officers/`: id, display_name (may be blank — fall back to username), username, role. */
export type AssignableOfficer = Schemas["AssignableOfficer"];

export interface JudgmentDetail extends Judgment {
  evidence_admissions: EvidenceAdmission[];
  admitted_balance: AdmittedBalance;
}

export interface EvidenceRulingPayload {
  admitted: boolean;
  /** Required (non-blank) when `admitted` is false. */
  reason?: string;
}

export interface JudgmentDraftPayload {
  /** The `draft_version` last seen. A stale one answers 409 `draft_conflict`. */
  version: number;
  notes?: string;
  draft_verdict?: "PASSED" | "FAILED" | "PURGATORY" | "RETRY" | null;
}


/** The four queue groups. Mutually exclusive over pending cases; deferred wins. */
export type JudgmentQueueGroup = "mine" | "unclaimed" | "others" | "deferred";

/** `GET /judgment/queue-counts/`. The four add up to `total`. */
export interface JudgmentQueueCounts {
  mine: number;
  unclaimed: number;
  others: number;
  deferred: number;
  total: number;
}

/** `GET /judgment/courts/`: one court (殿) in the caller's scope and its pending cases. */
export interface JudgmentCourt {
  court: string;
  pending: number;
}

/** Filters `queue-counts/` honours — the list's, minus `group`. */
export interface JudgmentQueueCountsParams {
  court?: string;
  search?: string;
}

export type JudgmentBatchOperation = "claim" | "reassign" | "defer";

/** `POST /judgment/batch/`. At most 100 ids; all or nothing. */
export interface JudgmentBatchPayload {
  operation: JudgmentBatchOperation;
  ids: string[];
  /** User pk. Required for `reassign`. */
  to?: number;
  /** Required for `defer`. At most 500 characters. */
  reason?: string;
}

export interface JudgmentBatchResult {
  operation: JudgmentBatchOperation;
  count: number;
  ids: string[];
}

/**
 * The body of a refused claim-family request (403 / 404 / 409, and 400 for a
 * bad assignee). Branch on `code`, not on `error`:
 * `already_claimed` · `not_claimed` · `not_claimant` · `not_pending` ·
 * `already_deferred` · `not_deferred` · `invalid_assignee` · `not_found` ·
 * `permission_denied` · `claimed_by_other` (409 from `conclude`: the case is
 * claimed by another officer; only they, ADMIN or MODERATOR may conclude it).
 */
export interface JudgmentClaimRefusal {
  error: string;
  code: string;
  /** On `already_claimed` / `not_claimant` / `claimed_by_other`: who holds it. */
  claimed_by?: number | null;
  /** On `claimed_by_other`: the holder's display name (or username), to show as-is. */
  claimed_by_name?: string;
  /** On a batch: the case that rolled the whole batch back. */
  id?: string;
  /** On a batch 404: the ids outside the caller's scope. */
  missing?: string[];
}

/**
 * `apps.judgment.models.StatuteCorpus`. Six rulebooks, not one taxonomy, and
 * two civilizations carry two apiece because their two are separate
 * structures rather than one longer list:
 *
 *   - `HELL_LAW` (Chinese) is EMPTY and stays empty. There is no codified 冥律
 *     to transcribe; the corpus written against that shape was withdrawn. The
 *     value is kept because rows may still carry it.
 *   - `GONGGUOGE` (Chinese) is 《太微仙君功過格》, 74 point-valued articles, and
 *     the only corpus here whose articles can be MERIT.
 *   - `NEGATIVE_CONFESSION` (Egyptian) is the Forty-Two's declarations of
 *     innocence — denials, not prohibitions.
 *   - `DEADLY_SIN` (European) is the seven terraces of Purgatorio.
 *   - `INFERNO` (European) is the nine circles and their subdivisions. NOT the
 *     same structure as the terraces: joining them makes a chart that exists
 *     nowhere in Dante.
 *   - `GORGIAS` and `REPUBLIC_ER` (Greek) are Plato's two, and likewise not one
 *     corpus: Gorgias stamps a soul and stops, Republic X sentences it to a
 *     thousand-year circuit and sends it back to be born.
 *
 * THIS UNION DRIFTED ONCE ALREADY, and silently, which is why it now has a
 * mechanism behind it. It listed three members while the backend had five —
 * `GONGGUOGE` and `INFERNO` landed and this file was not touched — and nothing
 * failed, because the value arrives from JSON and TypeScript cannot check a
 * runtime string against a union it was never given. What the reader saw was a
 * badge reading "unrecognized" where the rulebook's name belongs.
 * `backend/tests/test_frontend_statute_enums.py` reads this declaration and
 * compares it to the Python enum, in that direction.
 */
export type StatuteCorpus =
  | "HELL_LAW"
  | "GONGGUOGE"
  | "NEGATIVE_CONFESSION"
  | "DEADLY_SIN"
  | "INFERNO"
  | "GORGIAS"
  | "REPUBLIC_ER";

/**
 * `apps.judgment.models.StatutePolarity` — which way the article cuts, and for
 * `PROCEDURE`, that it does not cut at all.
 *
 * The first three answer "does citing this count for the soul or against it".
 * `PROCEDURE` is the Greek case and answers neither: "the judge too shall be
 * naked, that is to say, dead" (Gorg. 523e) is a rule the court is bound by
 * and a claim about no soul. 21 of the 23 Greek articles are
 * procedural, because neither Platonic myth contains a code of offences.
 */
export type StatutePolarity = "OFFENCE" | "MERIT" | "DENIAL" | "PROCEDURE";

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
  /**
   * How many times **this tenant** has cited this article, annotated by
   * `StatuteViewSet.get_queryset` through `apps/core/tenant.py`'s
   * `tenant_aggregate_filter`. It is the one number that separates a rulebook
   * from a list: an article nobody has ever relied on is a different thing
   * from one that founds thirty verdicts.
   *
   * `null` IS NOT `0`, and conflating them is the whole reason this field is
   * nullable rather than defaulted. `0` is a fact about the corpus — this
   * article exists and has never been cited. `null` means the response did not
   * carry a count at all: `StatuteSerializer` reads the annotation off the
   * instance and hands back `None` when it is absent, which is the nested path
   * (`JudgmentCitationSerializer.statute`, where the statute arrives through a
   * citation rather than through the annotated list queryset). The list
   * endpoint always annotates, so a reader on /corpus should never see the
   * miss — and if one appears, it means the annotation was dropped, which is
   * exactly the thing a rendered `0` would hide.
   *
   * Optional because the property is genuinely absent on payloads serialized
   * before this field existed, which is a third state again from either.
   * Render through `<DomainNumber>`: it prints the digit for `0` and a typed
   * `<MissingValue>` for both absences.
   */
  citation_count?: number | null;
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
  /**
   * AMENDMENT cases only (situation 1): the plan changes the concluded case
   * sends to the original judge as one AMEND request. Omitted = no request.
   * Any other kind answers 400 `invalid_changes`.
   */
  plan_changes?: SentenceRequestChanges;
  /**
   * 审判台「戊 · 发落」. All three optional; none given = automatic routing,
   * unchanged. Pick from `judgmentApi.destinations`. Refusals come back with a
   * `code`: realm_not_found / realm_not_allowed / term_conflict /
   * eternal_not_allowed / destination_not_applicable (400), realm_full (409,
   * 「执行失败：目的地已满」), claimed_by_other (409, a `JudgmentClaimRefusal`
   * naming the claimant). Written immediately — there is no undo window.
   */
  destination_realm_id?: string | null;
  /** Positive whole years. Not together with `eternal: true`. */
  term_years?: number | null;
  /** Only where the destination `is_eternal`. */
  eternal?: boolean | null;
}

/** `GET /judgment/{id}/destinations/?candidate_verdict=` — the 「戊 · 发落」 picker. */
export type JudgmentDestinations = components["schemas"]["JudgmentDestinations"];
export type JudgmentDestinationOption = components["schemas"]["JudgmentDestinationOption"];
export type JudgmentVerdict = components["schemas"]["JudgmentConcludeVerdictEnum"];

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

/** `GET /judgment/previous/` — the case just before `at`, same queue as `next/`. */
export interface JudgmentPreviousParams {
  at: string;
  skip?: string[];
  includeDeferred?: boolean;
}

export interface JudgmentQueueParams {
  /** Session-local skip list. Repeated, so the server never holds this state. */
  skip?: string[];
  /** Enter the queue on a named case (deep link from a soul's lifecycle spine). */
  at?: string;
  /** 「下一件」: the pending case just after this one, in the order `previous` walks back. Overrides `at`. */
  after?: string;
  /** Hand out deferred (暂缓) cases too. They are left out by default. */
  includeDeferred?: boolean;
}

/**
 * One row of 「据 · 先例」 (`GET /judgment/{id}/precedents/`, backend
 * apps/judgment/precedents.py). `balance` is null for VIEWER.
 */
export type JudgmentPrecedent = components["schemas"]["JudgmentPrecedent"];

export const judgmentApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Judgment>>("/judgment/", { params }),
  create: (data: object) => api.post<Judgment>("/judgment/", data),
  conclude: (id: string, data: ConcludeJudgmentPayload | object) => api.post<Judgment>(`/judgment/${id}/conclude/`, data),
  get: (id: string) => api.get<JudgmentDetail>(`/judgment/${id}/`),
  /** Admit / not admit one ledger record as evidence. 409 once concluded. */
  ruleEvidence: (id: string, recordId: string, data: EvidenceRulingPayload) =>
    api.put<EvidenceRulingResult>(`/judgment/${id}/evidence/${recordId}/`, data),
  /** Autosave the verdict text and chosen verdict. Idempotent; 409 on a stale version. */
  saveDraft: (id: string, data: JudgmentDraftPayload) =>
    api.patch<JudgmentDraft>(`/judgment/${id}/draft/`, data),
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
  /** 「据 · 先例」:同租户、同文明的已结案审判,按同殿 → 余额最近 → 共同援引排序。 */
  precedents: (id: string, limit?: number) =>
    api.get<JudgmentPrecedent[]>(`/judgment/${id}/precedents/`, {
      params: limit === undefined ? undefined : { limit },
    }),
  cite: (id: string, statute: string, note = "") =>
    api.post<JudgmentCitation>(`/judgment/${id}/citations/`, { statute, note }),
  uncite: (id: string, statute: string) =>
    api.delete(`/judgment/${id}/citations/${statute}/`),
  next: (params?: JudgmentQueueParams) => {
    const search = new URLSearchParams();
    for (const id of params?.skip ?? []) search.append("skip", id);
    if (params?.at) search.set("at", params.at);
    if (params?.after) search.set("after", params.after);
    if (params?.includeDeferred) search.set("include_deferred", "true");
    const qs = search.toString();
    return api.get<JudgmentQueueCursor>(`/judgment/next/${qs ? `?${qs}` : ""}`);
  },
  /** 「上一件」: `judgment` is null when nothing pending sits before `at`. */
  previous: (params: JudgmentPreviousParams) => {
    const search = new URLSearchParams();
    search.set("at", params.at);
    for (const id of params.skip ?? []) search.append("skip", id);
    if (params.includeDeferred) search.set("include_deferred", "true");
    return api.get<JudgmentQueueCursor>(`/judgment/previous/?${search.toString()}`);
  },
  /** Where this case may be sent under `verdict` (filtered by the routing rules). */
  destinations: (id: string, verdict: JudgmentVerdict) =>
    api.get<JudgmentDestinations>(`/judgment/${id}/destinations/`, {
      params: { candidate_verdict: verdict },
    }),
  claim: (id: string) => api.post<Judgment>(`/judgment/${id}/claim/`, {}),
  release: (id: string) => api.post<Judgment>(`/judgment/${id}/release/`, {}),
  /** Needs `judgment.assign` (ADMIN, MODERATOR). `to` is a User pk in the case's tenant. */
  reassign: (id: string, to: number) => api.post<Judgment>(`/judgment/${id}/reassign/`, { to }),
  /**
   * Who these cases may be reassigned to — the same rule `reassign` enforces. Needs
   * `judgment.assign`, not `user.manage`: this is the reassign picker's list.
   * Repeated `judgment=` params (a batch), not axios's `judgment[]=`.
   */
  assignableOfficers: (ids: readonly string[]) => {
    const search = new URLSearchParams();
    for (const id of ids) search.append("judgment", id);
    return api.get<AssignableOfficer[]>(`/judgment/assignable-officers/?${search.toString()}`);
  },
  /**
   * 「请管理员改派」: notify the case tenant's ADMINs. Needs `judgment.execute` on the case.
   * Once per case per caller per 10 minutes; more is 429 `rate_limited` with `retry_after` (seconds).
   */
  requestReassign: (id: string) =>
    api.post<Schemas["JudgmentReassignRequestResult"]>(`/judgment/${id}/request-reassign/`),
  defer: (id: string, reason: string) => api.post<Judgment>(`/judgment/${id}/defer/`, { reason }),
  undefer: (id: string) => api.post<Judgment>(`/judgment/${id}/undefer/`, {}),
  batch: (payload: JudgmentBatchPayload) => api.post<JudgmentBatchResult>("/judgment/batch/", payload),
  queueCounts: (params?: JudgmentQueueCountsParams) =>
    api.get<JudgmentQueueCounts>("/judgment/queue-counts/", { params }),
  /** Every court in the caller's scope (unfiltered, unpaginated) — the court filter's options. */
  courts: () => api.get<JudgmentCourt[]>("/judgment/courts/"),
};
