import axios from "axios";
import { api } from "./client";
import type { PaginatedResponse } from "./users";
import type { LedgerSummary } from "./ledger";
import type { HistoricalDate } from "../domain/dates";
import type { CivilizationOption } from "@soulledger/core/config/civilizations";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

export interface SoulInput {
  name: string;
  // Derived, not re-listed. This union was written out by hand when
  // `Civilization` had three members, and it stayed at three after GREEK
  // (tenant `GR_HADES`) became the fourth — which `tsc` cannot notice, because
  // a hand-written union is a claim about the wire and the compiler only ever
  // checks the code against the claim. `CIVILIZATION_OPTIONS` is the frontend's
  // one list (see src/config/civilizations.ts); a copy that agrees today is not
  // the same thing as no copy.
  civilization: CivilizationOption;
  birth_date: string | null;
  origin_location: string;
  current_state?: "ALIVE" | "JUDGING" | "DISPOSED" | "REINCARNATING" | "LOST" | "SETTLED";
}

/**
 * One entry of a DateProblem list (apps/souls/dates.py `DateProblem`),
 * shared shape for both the soul-level and record-level flavours below.
 * `severity` values are the lowercase strings ERROR/WARNING resolve to in
 * apps/souls/dates.py, not the uppercase convention used elsewhere in this
 * codebase (e.g. Soul.current_state) — verified against dates.py directly.
 */
interface DateProblemBase {
  severity: "error" | "warning";
  code: string;
  message: string;
}

/**
 * Soul-level date problem — the soul's own birth/death against each other
 * (`death_before_birth`, `implausible_lifespan`), from
 * `check_soul_dates`/`_soul_level_date_problems`
 * (backend/apps/souls/serializers.py). Both codes are ERROR-severity and
 * the write that would create one is refused before it lands (see
 * `_reject_errors`), so there is nothing here to acknowledge — unlike
 * `SoulRecordDateProblem` below, this shape carries no ack fields.
 */
export type SoulDateProblem = DateProblemBase;

/**
 * One record's date problem against its soul (`event_before_birth`,
 * `event_after_death`), from `SoulRecordSerializer.get_date_problems`
 * (backend/apps/souls/serializers.py). Only `event_after_death` is ever
 * acknowledgeable — see SoulViewSet.acknowledge_record_date_warning.
 */
export interface SoulRecordDateProblem extends DateProblemBase {
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}

/**
 * Fields shared by SoulSerializer and SoulListSerializer
 * (backend/apps/souls/serializers.py:133 and :207).
 *
 * merit_score/demerit_score/karmic_balance are optional because both
 * serializers delete those three keys outright for role VIEWER
 * (`to_representation`, serializers.py:198-203 and :231-236).
 */
interface SoulBase {
  id: string;
  name: string;
  // Same derived list as SoulInput above, plus one value the read side can
  // carry and the write side must not: "UNKNOWN" is not a real civilization —
  // it is what the backend returns for a tenant code it doesn't recognise
  // (misconfiguration), not a choice anyone makes. That is why this is
  // `CivilizationOption | "UNKNOWN"` rather than the same type as SoulInput,
  // and why "UNKNOWN" does not belong in CIVILIZATION_OPTIONS — putting it
  // there would offer a misconfiguration in every dropdown.
  civilization: CivilizationOption | "UNKNOWN";
  current_state: "ALIVE" | "JUDGING" | "DISPOSED" | "REINCARNATING" | "LOST" | "SETTLED";
  /** HistoricalDateField: {year, month, day} | null */
  birth_date: HistoricalDate | null;
  /** HistoricalDateField: {year, month, day} | null */
  death_date: HistoricalDate | null;
  merit_score?: number;
  demerit_score?: number;
  karmic_balance?: number;
  tenant_code?: string;
  create_time?: string;
  /** Soul's own dates against each other — see SoulDateProblem. */
  date_problems: SoulDateProblem[];
}

/**
 * Element of GET /souls/ — SoulListSerializer, a strict subset of Soul.
 * `has_date_warning` and `has_record_error` are list-only
 * (backend/apps/souls/serializers.py SoulListSerializer): whether any of
 * this soul's records carries an unacknowledged `event_after_death`
 * warning, or an `event_before_birth` error, collapsed to a bool because a
 * list row has no room for the per-record breakdown the detail page shows.
 */
export type SoulListItem = SoulBase & { has_date_warning: boolean; has_record_error: boolean };

/** 200 body of GET /souls/{id}/ — SoulSerializer. */
export interface Soul extends SoulBase {
  birth_name?: string;
  origin_location: string;
  description: string;
  tenant?: number;
  update_time?: string;
  /** Nested by SoulSerializer (`records = SoulRecordSerializer(many=True)`). */
  records?: SoulRecordEntry[];
  /** 0 until the first rebirth, N after the N-th (SoulSerializer.life_index). */
  life_index?: number;
  /** What the previous life handed to this one — the base every recalculation
   * starts from (Soul.inherited_merit/inherited_demerit). Absent for VIEWER,
   * like the scores. */
  inherited_merit?: number;
  inherited_demerit?: number;
  /** 原属租户(2026-09-17:调拨是暂居)。`tenant` / `civilization` 是此刻管辖;转生资格按原属。 */
  home_tenant?: { code: string; display_name: string };
  home_civilization?: string;
  /** True while the soul is dispatched away from its home tenant. */
  is_residing?: boolean;
}

/**
 * One row of SoulRecordSerializer (backend/apps/souls/serializers.py:80) —
 * the element type of GET /souls/{id}/records/ and of Soul.records.
 *
 * This is NOT the same shape as LedgerRecord: the ledger summary renames
 * record_type→type and weight→original_weight and adds the decay figures.
 */
export interface SoulRecordEntry {
  id: string;
  record_type: string;
  category: string;
  civilization: string;
  description: string;
  weight: number;
  /** HistoricalDateField: {year, month, day} | null */
  event_date: HistoricalDate | null;
  is_milestone: boolean;
  evidence_json?: Record<string, unknown>;
  recorded_at: string;
  /** Life index this deed belongs to; 0 is the first life (SoulRecord.cycle). */
  cycle: number;
  /** This record's event date against its soul's — see SoulRecordDateProblem. */
  date_problems: SoulRecordDateProblem[];
}

// Backward-compatible alias. NOTE: this is an alias for the *soul*, not for a
// ledger row — a soul record is SoulRecordEntry above.
export type SoulRecord = Soul;

/**
 * Body of POST /souls/batch-recycle/ — 1 to 100 distinct soul ids.
 *
 * `reason` is optional on the wire (`required: [ids]` in the schema) but the
 * generated type makes it required: openapi-typescript treats a field with a
 * `default` as always present, which is true of the backend's validated data,
 * not of what a client must send. So it is loosened here, and only here.
 */
export type SoulBatchRecycleRequest = Omit<Schemas["SoulBatchRecycle"], "reason"> &
  Partial<Pick<Schemas["SoulBatchRecycle"], "reason">>;
/** 200 body: every id recycled, in request order, each with its own cascade id. */
export type SoulBatchRecycleResult = Schemas["SoulBatchRecycleResult"];
/**
 * 404 / 409 body. The batch is all-or-nothing: on either status NOTHING was
 * recycled, and `ids` names every offending id. 400 (malformed, empty, over
 * 100, duplicate ids) is DRF's ordinary field-error body, not this shape.
 */
export type SoulBatchRecycleError = Schemas["SoulBatchRecycleError"];

/**
 * The `code`s a refused batch carries — `not_found` (404: another tenant's,
 * already deleted, archived or nonexistent; indistinguishable, as on the single
 * delete) and `not_deletable` (409: a concluded judgment; `archivable` says
 * archive is the way). Checked both ways against the generated enum below.
 */
export const SOUL_BATCH_RECYCLE_ERROR_CODES = [
  "not_found",
  "not_deletable",
] as const satisfies readonly Schemas["SoulBatchRecycleErrorCodeEnum"][];

export type SoulBatchRecycleErrorCode = (typeof SOUL_BATCH_RECYCLE_ERROR_CODES)[number];

// The reverse direction `satisfies` cannot give: a code the backend adds and
// this list lacks is a compile error here, not a silently unhandled branch.
const _everyBatchRecycleCodeIsListed: Record<Schemas["SoulBatchRecycleErrorCodeEnum"], SoulBatchRecycleErrorCode> = {
  not_found: "not_found",
  not_deletable: "not_deletable",
};
void _everyBatchRecycleCodeIsListed;

/**
 * The refusal body of a failed `batchRecycle`, or `null` when the failure is
 * anything else (400 field errors, 403, network). Reads `code` rather than the
 * status so a 404 from a proxy is not mistaken for a named-ids refusal.
 */
export function soulBatchRecycleErrorOf(error: unknown): SoulBatchRecycleError | null {
  if (!axios.isAxiosError(error)) return null;
  const data = error.response?.data as Partial<SoulBatchRecycleError> | undefined;
  if (!data || !Array.isArray(data.ids)) return null;
  return (SOUL_BATCH_RECYCLE_ERROR_CODES as readonly unknown[]).includes(data.code)
    ? (data as SoulBatchRecycleError)
    : null;
}

/**
 * One stop of `GET /souls/{id}/path/` (SoulPathEntrySerializer). `left_at`
 * null is where the soul is now — at most one per soul
 * (`soulpath_one_open_entry_per_soul`). `realm_id` null: the realm row was
 * deleted after the stop was written.
 */
export interface SoulPathEntry {
  id: string;
  sequence: number;
  realm_id: string | null;
  realm_code: string | null;
  entered_at: string;
  left_at: string | null;
}

export const soulsApi = {
  list: (params?: {
    page?: number;
    search?: string;
    civilization?: string;
    state?: string;
    karma_min?: number;
    karma_max?: number;
    ordering?: string;
    // String, not boolean — this travels through useSouls's
    // Record<string, string | number | undefined> params bag the same way
    // every other filter here does. "true" — souls.filters.SoulFilter's
    // has_date_problem is a django-filter BooleanFilter, which parses the
    // string the same as it would a real query-string value.
    has_date_problem?: string;
  }) => api.get<PaginatedResponse<SoulListItem>>("/souls/", { params }),
  get: (id: string) => api.get<Soul>(`/souls/${id}/`),
  create: (data: object) => api.post<Soul>("/souls/", data),
  update: (id: string, data: Partial<SoulInput>) => api.patch<Soul>(`/souls/${id}/`, data),
  delete: (id: string) => api.delete<void>(`/souls/${id}/`),
  // All or nothing — see SoulBatchRecycleError. Same codename as `delete`.
  batchRecycle: (data: SoulBatchRecycleRequest) =>
    api.post<SoulBatchRecycleResult>("/souls/batch-recycle/", data),
  // The batch bar's 「导出」: a CSV of the selected souls, scoped like the list (`soul.read`).
  export: (ids: string[]) =>
    api.get<Blob>("/souls/export/", { params: { ids: ids.join(",") }, responseType: "blob" }),
  die: (id: string, data?: object) => api.post<Soul>(`/souls/${id}/die/`, data),
  transition: (id: string, data: object) => api.post<Soul>(`/souls/${id}/transition/`, data),
  karma: (id: string) => api.get<LedgerSummary>(`/souls/${id}/karma/`),
  addRecord: (id: string, data: object) => api.post<SoulRecordEntry>(`/souls/${id}/add_record/`, data),
  // Bare array — the action returns `Response(serializer.data)` directly
  // (backend/apps/souls/views.py:164), not a pagination envelope.
  records: (id: string) => api.get<SoulRecordEntry[]>(`/souls/${id}/records/`),
  // 行程:oldest stop first, bare array (`pagination_class=None`).
  path: (id: string) => api.get<SoulPathEntry[]>(`/souls/${id}/path/`),
  // Both require soul.update (backend/apps/souls/views.py extra_permissions)
  // and act on the authenticated user only — no body to send.
  acknowledgeDateWarning: (soulId: string, recordId: string) =>
    api.post<SoulRecordEntry>(`/souls/${soulId}/records/${recordId}/acknowledge-date-warning/`),
  unacknowledgeDateWarning: (soulId: string, recordId: string) =>
    api.post<SoulRecordEntry>(`/souls/${soulId}/records/${recordId}/unacknowledge-date-warning/`),
};
