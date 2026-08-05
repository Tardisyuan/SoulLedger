import { api } from "./client";
import type { PaginatedResponse } from "./users";
import type { LedgerSummary } from "./ledger";

export interface SoulInput {
  name: string;
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN";
  birth_date: string | null;
  origin_location: string;
  current_state?: "ALIVE" | "JUDGING" | "DISPOSED" | "REINCARNATING" | "LOST" | "SETTLED";
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
  /**
   * KNOWN-WRONG, left as-is deliberately — see the note on
   * LedgerRecord.event_date. Both date fields are HistoricalDateField and
   * arrive as `{year, month, day} | null`, not as ISO strings. Typing them
   * honestly breaks four call sites that call .split()/formatDate()/render
   * them directly; that is a runtime bug of its own, not a typing change.
   */
  birth_date: string | null;
  death_date: string | null;
  merit_score?: number;
  demerit_score?: number;
  karmic_balance?: number;
  tenant_code?: string;
  create_time?: string;
}

/** Element of GET /souls/ — SoulListSerializer, a strict subset of Soul. */
export type SoulListItem = SoulBase;

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
  /** `{year, month, day} | null` on the wire — see Soul.birth_date. */
  event_date: string | null;
  is_milestone: boolean;
  evidence_json?: Record<string, unknown>;
  recorded_at: string;
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
};
