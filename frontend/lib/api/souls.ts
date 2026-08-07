import { api } from "./client";
import type { PaginatedResponse } from "./users";
import type { LedgerSummary } from "./ledger";
import type { HistoricalDate } from "@/lib/utils";

export interface SoulInput {
  name: string;
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN";
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
  // "UNKNOWN" is not a real civilization — it is what the backend returns
  // for a tenant code it doesn't recognise (misconfiguration), not a choice
  // anyone makes.
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN" | "UNKNOWN";
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
  /** This record's event date against its soul's — see SoulRecordDateProblem. */
  date_problems: SoulRecordDateProblem[];
}

// Backward-compatible alias. NOTE: this is an alias for the *soul*, not for a
// ledger row — a soul record is SoulRecordEntry above.
export type SoulRecord = Soul;

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
  die: (id: string, data?: object) => api.post<Soul>(`/souls/${id}/die/`, data),
  transition: (id: string, data: object) => api.post<Soul>(`/souls/${id}/transition/`, data),
  karma: (id: string) => api.get<LedgerSummary>(`/souls/${id}/karma/`),
  addRecord: (id: string, data: object) => api.post<SoulRecordEntry>(`/souls/${id}/add_record/`, data),
  // Bare array — the action returns `Response(serializer.data)` directly
  // (backend/apps/souls/views.py:164), not a pagination envelope.
  records: (id: string) => api.get<SoulRecordEntry[]>(`/souls/${id}/records/`),
  // Both require soul.update (backend/apps/souls/views.py extra_permissions)
  // and act on the authenticated user only — no body to send.
  acknowledgeDateWarning: (soulId: string, recordId: string) =>
    api.post<SoulRecordEntry>(`/souls/${soulId}/records/${recordId}/acknowledge-date-warning/`),
  unacknowledgeDateWarning: (soulId: string, recordId: string) =>
    api.post<SoulRecordEntry>(`/souls/${soulId}/records/${recordId}/unacknowledge-date-warning/`),
};
