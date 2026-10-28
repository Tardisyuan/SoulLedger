import type { AppealCompensation } from "../domain/appeals";
import type { ArchiveFields } from "./archive";
import type { GenericAbortSignal } from "axios";
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
 * The serializer mixes in FieldPermissionMixin, which can strip fields
 * per-role from DB-configured rules, so everything past the identity fields
 * is optional in principle.
 */
/** `Judgment.duat_stage` (backend/apps/judgment/models.py `DuatStage`); "" = 不涉及。 */
export type JudgmentDuatStage = "EMBALMING" | "EARLY_DEATH" | "NAMELESS" | "IMPROPER_BURIAL" | "";

export interface Judgment extends ArchiveFields {
  id: string;
  /**
   * 案号:给人读、给人抄的编号(`CN-2026-0007` = 租户前缀-年-序号),开案时服务端发,永不改。
   * `id` 仍是路由与 API 用的身份。显示一律走 `<CaseNumber>`(可复制、不截断)。
   */
  case_number: string;
  soul: string;
  soul_name: string;
  /** 这次审判挂着的审批 id;没有是 null。「发起审批」据此把已有审批的审判置灰。 */
  workflow?: string | null;
  civilization: string;
  /** models.py:37 — the only nullable FK on the model. */
  judge: string | null;
  judge_name: string | null;
  /** `blank=True` CharField/TextField: empty string, never null. */
  court: string;
  evidence_json: Record<string, unknown>;
  confession: string;
  /** 案由:官员写的案情概述(`summary`),不是灵魂的供词。blank = 空串。 */
  summary?: string;
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
  /** 「戊 · 发落」 draft: the chosen destination, term and eternal flag. Cleared at conclude. */
  draft_destination_realm_id?: string | null;
  draft_term_years?: number | null;
  draft_eternal?: boolean;
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
  /** 「请管理员改派」的持久标记(只读;认领人变了就清)。 */
  reassign_requested_at?: string | null;
  reassign_requested_by?: number | null;
  reassign_requested_by_name?: string | null;
  reassign_reason?: string;
  /**
   * 滞留:未结案且 30 天无进展时由定时任务 `judgment.auto_conclude_stale` 盖章(只读;
   * **不结案**)。案子下一次有进展(认领、暂缓、改派、写草稿、结案……)就清回 null。
   * 列表用 `?stale=true|false` 筛。
   */
  stale_since?: string | null;
  /**
   * 枉死(2026-10-24,只地府):灵魂死在阳寿(`Soul.fated_death_date`)之前。`Soul.die` 盖章,之后不变。
   * `held_until` 是阳寿那一天(ISO 日期):在那之前不能认领(409 `held_until_fated_date`),灵魂在枉死城。
   * 过了那天 `held_until` 仍在,只是不再拦 —— 用 `domain/dates.ts::isHeldUntilFatedDate` 判断「此刻是否候审」。
   */
  untimely?: boolean;
  held_until?: string | null;
  /**
   * 埃及入殿前(review P2-9,`Judgment.duat_stage`):EMBALMING = 木乃伊 70 天,`held_until` 是那一天;
   * NAMELESS / IMPROPER_BURIAL 到不了殿,永远候着(409 `duat_unfinished`);EARLY_DEATH 不称心,登记时已送芦苇原。
   * "" = 不涉及。用 `domain/dates.ts::isDuatBarred` 判断「到不了殿」。
   */
  duat_stage?: JudgmentDuatStage;
  /**
   * 希腊原审此刻过不了阿刻戎的原因(`apps/judgment/claims.py::ferry_barred`,与认领的 409 `unferried` 同一条规则):
   * UNBURIED / NO_FARE;能过河(已葬有渡资、或未葬满百年)是 ""。队列据此不画「认领」(第五十七批 G-1)。
   */
  ferry_barred?: "" | "UNBURIED" | "NO_FARE";
  /**
   * merit − demerit, for CHINESE cases only; null for every other cosmology
   * (apps/ledger/readings.py). ABSENT — not null — for a VIEWER, the same
   * floor `SoulSerializer` keeps.
   */
  karmic_balance?: number | null;
  /** Entries in `evidence_json` — the number the detail page's facts column shows. */
  evidence_count?: number;
  /** 第几世:0 是第一世(`Judgment.cycle`,创建时按灵魂的转世次数盖章)。显示用 `cycle + 1`。 */
  cycle?: number;
  /** 审判方式(`Judgment.judgment_method`),只读。 */
  judgment_method?: "STANDARD" | "HEART_WEIGHING" | "DIABOLICAL_TRIAL";
  /** 埃及称心的结果,结案时冻结(docs/02 §5);非称心的案子是 null。 */
  weighing_result?: "LIGHTER" | "HEAVIER" | "WAVERING" | null;
  heart_weight?: number | null;
  /** 天平摇摆而再称时,指回上一次称量的那件案子。 */
  retrial_of?: string | null;
  /**
   * 灵魂此刻的功 / 过两本账,分开给(队列「功 / 过」)。不是净值,所以四个文明都有;
   * VIEWER 拿不到(字段不在),同 `karmic_balance`。
   */
  merit_score?: number;
  demerit_score?: number;
  /** 案子所挂界域(`realm_id`)按请求语言的名字;没挂是 null。 */
  realm_name?: string | null;
  /**
   * 城隍初审(第五十三批,只在地府):`city_god_status` 空 = 没经过城隍。PENDING / RETURNED 时十殿不能认领、
   * 改派、暂缓、结案(409 `at_city_god`);SENT_ON 时案卷顶上写解送记录。
   */
  city_god?: string | null;
  city_god_name?: string | null;
  city_god_status?: "" | CityGodStatus;
  city_god_note?: string;
  sent_on_at?: string | null;
  /**
   * 罪目(只地府,`ChineseOffence`):自动选殿按它(二至九殿各掌一类,`domain/diyuCase.ts::OFFENCES_BY_COURT`);
   * 空串 = 没填,退回按严重度选殿。未结案时可 PATCH。
   */
  offence?: "" | ChineseOffence;
  /** 枉死城(docs/10):死因分类与冤情等级,只在枉死(`untimely`)的案子上,未结案时可 PATCH。 */
  wrongful_death_cause?: "" | WrongfulDeathCause;
  grievance_level?: "" | GrievanceLevel;
  /** 冤情申诉(只读,经 `wangsiApi` 写):FILED 待审;UPHELD 属实、已提前释放(`held_until` 清空);REJECTED 不属实。 */
  grievance_status?: "" | GrievanceStatus;
  grievance_plea?: string;
  grievance_note?: string;
  grievance_decided_at?: string | null;
}

type Schemas = components["schemas"];
export type ChineseOffence = Schemas["ChineseOffenceEnum"];
export type WrongfulDeathCause = Schemas["WrongfulDeathCauseEnum"];
export type GrievanceLevel = Schemas["GrievanceLevelEnum"];
export type GrievanceStatus = Schemas["GrievanceStatusEnum"];
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
/** 42 条否定告白(埃及称心,2026-10-28;backend/apps/judgment/confession_views.py)。 */
export type NegativeConfessionList = Schemas["NegativeConfessionList"];
export type NegativeConfessionRow = Schemas["NegativeConfessionRow"];
export type NegativeConfessionWrite = Schemas["NegativeConfessionWrite"];
/** 记一条被拒时有文案的 `code`(`judgment.confessions.errors.<code>`)。 */
export const CONFESSION_ERROR_CODES = ["concluded", "not_weighed", "unknown_clause"] as const;
export type JudgmentDraft = Schemas["JudgmentDraft"];
/** 409 body of `saveDraft`: `draft_conflict` carries what beat you in `current`. */
export type JudgmentDraftConflict = Schemas["JudgmentDraftConflict"];
/** One row of `GET /judgment/assignable-officers/`: id, display_name (may be blank — fall back to username), username, role. */
export type AssignableOfficer = Schemas["AssignableOfficer"];

export interface JudgmentDetail extends Judgment {
  evidence_admissions: EvidenceAdmission[];
  admitted_balance: AdmittedBalance;
  /** The joint judgment hung on this one (one-to-one), or null. Detail only. */
  cross_judgment_id?: string | null;
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
  /** 「戊 · 发落」: must be a realm of the case's tenant and civilization (400 otherwise). */
  draft_destination_realm_id?: string | null;
  draft_term_years?: number | null;
  draft_eternal?: boolean;
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
  /** Soul id (the list's `?soul=`). */
  soul?: string;
  /** `"true"` 只数滞留的(`stale_since` 非空),`"false"` 不数它们。 */
  stale?: string;
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
  /** On `held_until_fated_date` (枉死城) or `embalming` (埃及木乃伊 70 天): the ISO date the case can first be claimed. */
  held_until?: string;
  /** On `unferried` (希腊,滞留阿刻戎岸边):`Soul.FerryPassage`,UNBURIED / NO_FARE。 */
  ferry_passage?: string;
  /** 申诉改判(`foreign_stops_choice_required`):联审带进来、还没开始的外地站的站序。 */
  foreign_orders?: number[];
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
  /** 第几版(1 起):条文(标题 / 正文 / 出处 / 分值)改了才加一。 */
  revision: number;
  /** 这一版自哪天起施行(ISO 日期)。存量条目是入库那天。 */
  effective_from: string;
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

/**
 * What a cited article said when the verdict was given
 * (`apps/judgment/snapshot.py`). `CONCLUDED` was taken in the conclusion's own
 * transaction; `BACKFILLED` was written by migration judgment/0029 for cases
 * concluded before snapshots existed — that is the migration day's text, not
 * the conclusion day's, and the desk says so.
 */
export interface CitationSnapshot {
  kind: "CONCLUDED" | "BACKFILLED";
  taken_at: string;
  display_title: string;
  display_text: string;
  source: string;
  /** Today's rendering of the article no longer matches the snapshot (hash compare). */
  current_differs: boolean;
}

export interface JudgmentCitation {
  id: string;
  statute: Statute;
  /** How this article applies to this case. */
  note: string;
  created_at: string;
  /** Null on an open case: it reads the live `statute`. Optional: older payloads lack it. */
  snapshot?: CitationSnapshot | null;
}

export interface ConcludeJudgmentPayload {
  verdict: string;
  notes?: string;
  /**
   * Omitted = no workflow, except while a cross-realm judgment is open on the case (第四十三批): then one is
   * generated and merges the bench; an explicit `false` answers 400 `workflow_required`.
   */
  create_workflow?: boolean;
  /** W-1: this realm's station orders unticked; the final review answers 400 `final_required`. */
  skip_node_orders?: number[];
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

export type JudgmentComment = components["schemas"]["JudgmentComment"];
/** The server's cap on one comment's length. */
export const JUDGMENT_COMMENT_MAX = 2000;

/** 案卷附件(Design 第二十八批 W4)。上限在服务端;列表里也带着,界面以服务端给的为准。 */
export type CaseAttachment = components["schemas"]["CaseAttachment"];
export type CaseAttachmentList = components["schemas"]["CaseAttachmentList"];
export type CaseAttachmentLink = components["schemas"]["CaseAttachmentLink"];
/** 服务端拒绝的 `code`:bad_type / too_large 是 400,case_full / too_many 是 409,concluded / not_uploader 是删除的 403。 */
export type CaseAttachmentErrorCode = "bad_type" | "too_large" | "case_full" | "too_many" | "concluded" | "not_uploader";

export const judgmentApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Judgment>>("/judgment/", { params }),
  /** 与 `list` 同一组筛选 / 租户划界的 CSV,不分页(`JudgmentViewSet.export`);页码参数不要传。 */
  exportCsv: (params?: Record<string, string>) =>
    api.get<Blob>("/judgment/export/", { params, responseType: "blob" }),
  create: (data: object) => api.post<Judgment>("/judgment/", data),
  /** 改案由(`summary`)等普通字段。`notes` 走 `saveDraft`,认领 / 暂缓走各自的动作。 */
  update: (
    id: string,
    data: Partial<Pick<Judgment, "summary" | "offence" | "wrongful_death_cause" | "grievance_level">>,
  ) => api.patch<Judgment>(`/judgment/${id}/`, data),
  delete: (id: string) => api.delete<void>(`/judgment/${id}/`),
  /** 归档(`judgment.execute`):只收有裁决的审判;理由选填。 */
  archive: (id: string, reason = "") => api.post<Judgment>(`/judgment/${id}/archive/`, { reason }),
  unarchive: (id: string) => api.post<Judgment>(`/judgment/${id}/unarchive/`),
  conclude: (id: string, data: ConcludeJudgmentPayload | object) => api.post<Judgment>(`/judgment/${id}/conclude/`, data),
  get: (id: string) => api.get<JudgmentDetail>(`/judgment/${id}/`),
  /** Admit / not admit one ledger record as evidence. 409 once concluded. */
  ruleEvidence: (id: string, recordId: string, data: EvidenceRulingPayload) =>
    api.put<EvidenceRulingResult>(`/judgment/${id}/evidence/${recordId}/`, data),
  /** 42 条否定告白:按判官次序 42 行 + 合计;不称心的案子 `applies=false`、空列表。 */
  negativeConfessions: (id: string) =>
    api.get<NegativeConfessionList>(`/judgment/${id}/negative-confessions/`).then((r) => r.data),
  /** 记一条(judgment.execute):truthful true 如实 / false 不实 / null 未记。409 结案后,400 不称心,404 无此判官。 */
  recordNegativeConfession: (id: string, ordinal: number, data: NegativeConfessionWrite) =>
    api.put<NegativeConfessionList>(`/judgment/${id}/negative-confessions/${ordinal}/`, data).then((r) => r.data),
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
  /** One article — the desk's 「插入审判台」 confirm names it before citing. */
  statute: (id: string) => api.get<Statute>(`/judgment/statutes/${id}/`),
  citations: (id: string) => api.get<JudgmentCitation[]>(`/judgment/${id}/citations/`),
  /** 「据 · 先例」:同租户、同文明的已结案审判,按同殿 → 余额最近 → 共同援引排序。 */
  precedents: (id: string, limit?: number) =>
    api.get<JudgmentPrecedent[]>(`/judgment/${id}/precedents/`, {
      params: limit === undefined ? undefined : { limit },
    }),
  /** 评议: oldest first. Anyone who can read the judgment can read and write them. */
  comments: (id: string) => api.get<JudgmentComment[]>(`/judgment/${id}/comments/`),
  addComment: (id: string, body: string) => api.post<JudgmentComment>(`/judgment/${id}/comments/`, { body }),
  /** 案卷附件列表与用量。看:judgment.read。 */
  attachments: (id: string) => api.get<CaseAttachmentList>(`/judgment/${id}/attachments/`).then((r) => r.data),
  /**
   * 传一个文件(judgment.execute)。`body` 是宿主造的 multipart(`FormData`,文件在 `file` 下);Content-Type 要显式写,
   * 理由见 `socialApi.uploadAvatar`。`signal` 是宿主的 `AbortController.signal`:取消 = 中止这次请求。
   * 400 `bad_type` / `too_large`,409 `case_full` / `too_many`。
   */
  uploadAttachment: (
    id: string,
    body: FormData,
    opts?: { onProgress?: (fraction: number) => void; signal?: GenericAbortSignal },
  ) =>
    api
      .post<CaseAttachment>(`/judgment/${id}/attachments/`, body, {
        headers: { "Content-Type": "multipart/form-data" },
        signal: opts?.signal,
        onUploadProgress: opts?.onProgress
          ? (e) => opts.onProgress?.(e.total ? Math.min(1, e.loaded / e.total) : 0)
          : undefined,
      })
      .then((r) => r.data),
  /** 删除:只有上传人、且案子未结案(否则 403 `concluded` / `not_uploader`);审计记一条「删除附件」。 */
  deleteAttachment: (id: string, attachmentId: string) =>
    api.delete(`/judgment/${id}/attachments/${attachmentId}/`).then(() => undefined),
  /** 10 分钟有效的签名地址;预览与下载各取一次,不缓存。 */
  attachmentLink: (id: string, attachmentId: string) =>
    api.get<CaseAttachmentLink>(`/judgment/${id}/attachments/${attachmentId}/link/`).then((r) => r.data),
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
  /** `reason`: releasing someone else's claim (needs `judgment.assign`) -- it reaches them with the notice. */
  release: (id: string, reason?: string) => api.post<Judgment>(`/judgment/${id}/release/`, reason ? { reason } : {}),
  /** Needs `judgment.assign` (ADMIN, MODERATOR). `to` is a User pk in the case's tenant; the previous holder is told, with `reason`. */
  reassign: (id: string, to: number, reason?: string) =>
    api.post<Judgment>(`/judgment/${id}/reassign/`, reason ? { to, reason } : { to }),
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
  requestReassign: (id: string, reason?: string) =>
    api.post<Schemas["JudgmentReassignRequestResult"]>(`/judgment/${id}/request-reassign/`, reason ? { reason } : {}),
  defer: (id: string, reason: string) => api.post<Judgment>(`/judgment/${id}/defer/`, { reason }),
  undefer: (id: string, reason?: string) => api.post<Judgment>(`/judgment/${id}/undefer/`, reason ? { reason } : {}),
  batch: (payload: JudgmentBatchPayload) => api.post<JudgmentBatchResult>("/judgment/batch/", payload),
  queueCounts: (params?: JudgmentQueueCountsParams) =>
    api.get<JudgmentQueueCounts>("/judgment/queue-counts/", { params }),
  /** Every court in the caller's scope (unfiltered, unpaginated) — the court filter's options. */
  courts: () => api.get<JudgmentCourt[]>("/judgment/courts/"),
};

// ── 申诉(第五十二批;backend/apps/judgment/appeal_views.py)──────────────────

export type JudgmentAppealStatus = Schemas["JudgmentAppealStatusEnum"];
export type JudgmentAppeal = Omit<Schemas["JudgmentAppeal"], "compensations"> & { compensations: AppealCompensation[] };
export type JudgmentAppealDecidePayload = Schemas["JudgmentAppealDecide"];
/**
 * 上诉的站梯(第五十五批;`appeals.ladder`):一次复核为 null。一站 = 一个人工审批节点,按顺序;
 * 流程已结束(`workflow_status` 是 COMPLETED / REJECTED)时剩下的 AHEAD 写「不再审」。不带审批人。
 * `is_final` 那一站画在站梯下面单独一行「终审」(第五十五批补充);它的 `AWAITING_FINAL` = 前面各站都过了、
 * 等终审官员作出结论(终审节点还在当前,或流程已走完而申诉还没有结论)。
 */
export type AppealLadder = Schemas["AppealLadder"];
export type AppealLadderStation = Schemas["AppealLadderStation"];
export type AppealLadderState = Schemas["AppealLadderStateEnum"];

export const judgmentAppealKeys = {
  all: ["judgment-appeals"] as const,
  list: (params?: Record<string, string>) => [...judgmentAppealKeys.all, "list", params ?? null] as const,
  detail: (id: string) => [...judgmentAppealKeys.all, "detail", id] as const,
};

/**
 * 官员侧:本殿的申诉。`?status=PENDING` 是待复核队列。认领与决定的拒绝是 `JudgmentClaimRefusal` 形状,
 * `code` 见 `APPEAL_ERROR_CODES`;`foreign_stops_choice_required` 另带 `foreign_orders`。
 */
export const judgmentAppealsApi = {
  list: (params?: Record<string, string>) =>
    api.get<PaginatedResponse<JudgmentAppeal>>("/judgment/appeals/", { params }),
  get: (id: string) => api.get<JudgmentAppeal>(`/judgment/appeals/${id}/`),
  claim: (id: string) => api.post<JudgmentAppeal>(`/judgment/appeals/${id}/claim/`),
  decide: (id: string, data: JudgmentAppealDecidePayload) =>
    api.post<JudgmentAppeal>(`/judgment/appeals/${id}/decide/`, data),
};

/** 认领 / 决定被拒时有文案的 `code`(`appeals.error.<code>`)。 */
export const APPEAL_ERROR_CODES = [
  "plan_in_transit",
  "plan_busy",
  "already_claimed",
  "original_judge",
  "not_reviewer",
  "appeal_closed",
  "verdict_unchanged",
  // 上诉到申诉流程的那一轮:流程走完前不能认领、作结论(2026-10-27)。
  "ladder_running",
  // 欧洲申诉改判成「重审」:不是去处(apps/sentence_plan/requests.py)。
  "retry_not_a_destination",
  // 欧洲 大罪 / 小罪(2026-10-28):改判与已采信的罪不符。
  "mortal_sin_unrepented",
  "no_mortal_sin",
  // 埃及否定告白(2026-10-28):原审有一条记为「不实」,不能改判通过。
  "untruthful_confession",
] as const;

// ── 城隍初审(第五十三批;backend/apps/judgment/city_god_views.py)────────────

export type CityGod = Schemas["CityGod"];
export type CityGodWrite = Schemas["PatchedCityGod"];
export type CityGodCase = Schemas["CityGodCase"];
export type CityGodStatus = Schemas["CityGodStatusEnum"];
export type CityGodOfficer = Schemas["CityGodOfficer"];

/** 两种状态还在城隍处:十殿不能动它。定义在 domain/cityGods.ts(见那里的说明)。 */
export { AT_CITY_GOD } from "../domain/cityGods";

export const cityGodKeys = {
  all: ["city-gods"] as const,
  gods: () => [...cityGodKeys.all, "gods"] as const,
  cases: (params?: Record<string, string>) => [...cityGodKeys.all, "cases", params ?? null] as const,
  case: (id: string) => [...cityGodKeys.all, "case", id] as const,
};

/** 本殿的城隍。看是 `judgment.read`,增改删 `judgment.assign`;只有地府能建(400 `city_gods_diyu_only`)。 */
export const cityGodsApi = {
  list: () => api.get<PaginatedResponse<CityGod>>("/judgment/city-gods/", { params: { page_size: "100" } }),
  create: (data: CityGodWrite) => api.post<CityGod>("/judgment/city-gods/", data),
  update: (id: string, data: CityGodWrite) => api.patch<CityGod>(`/judgment/city-gods/${id}/`, data),
  remove: (id: string) => api.delete<void>(`/judgment/city-gods/${id}/`),
  /** 「名下官员」可选的人(本殿能办案的在职官员,与改派同一条规则)。要 `judgment.assign`。 */
  officerChoices: () => api.get<CityGodOfficer[]>("/judgment/city-gods/officer-choices/"),
};

/**
 * 在城隍处初审的案子。默认只列还在城隍处的(退回补正的在前);`status=SENT_ON` 看已解送的,`city_god=<id>`、
 * `mine=true` 筛。拒绝是 `JudgmentClaimRefusal` 形状,`code` 见 `CITY_GOD_CASE_ERROR_CODES`。
 */
export const cityGodCasesApi = {
  list: (params?: Record<string, string>) =>
    api.get<PaginatedResponse<CityGodCase>>("/judgment/city-god-cases/", { params }),
  get: (id: string) => api.get<CityGodCase>(`/judgment/city-god-cases/${id}/`),
  sendOn: (id: string, note = "") => api.post<CityGodCase>(`/judgment/city-god-cases/${id}/send_on/`, { note }),
  returnCase: (id: string, note: string) => api.post<CityGodCase>(`/judgment/city-god-cases/${id}/return/`, { note }),
  transfer: (id: string, cityGod: string) =>
    api.post<CityGodCase>(`/judgment/city-god-cases/${id}/transfer/`, { city_god: cityGod }),
};

/**
 * 枉死城的冤情申诉(apps/judgment/wangsi.py),都要 `judgment.execute`;审核另要是城隍名下官员或持 `judgment.assign`。
 * 答复是整件审判。拒绝是 `JudgmentClaimRefusal` 形状,`code` 见 `WANGSI_ERROR_CODES`。
 */
export const wangsiApi = {
  fileGrievance: (id: string, plea: string) => api.post<Judgment>(`/judgment/wangsi/${id}/grievance/`, { plea }),
  /** `deliver`:属实且超度(出城到莲花台、免审结案),只与 `upheld` 同用。 */
  decideGrievance: (id: string, upheld: boolean, note: string, deliver = false) =>
    api.post<Judgment>(`/judgment/wangsi/${id}/decide/`, { upheld, note, deliver }),
};

/** 申诉动作被拒时有文案的 `code`(`judgment.wangsi.error.<code>`)。 */
export const WANGSI_ERROR_CODES = [
  "not_in_wangsi",
  "grievance_open",
  "no_grievance_filed",
  "grievance_not_major",
  "not_city_god_officer",
  "not_pending",
  "at_city_god",
  "deliver_needs_upheld",
] as const;

/** 初审动作被拒时有文案的 `code`(`cityGodCases.error.<code>`)。 */
export const CITY_GOD_CASE_ERROR_CODES = [
  "not_at_city_god",
  "not_city_god_officer",
  "invalid_city_god",
  "not_pending",
] as const;
