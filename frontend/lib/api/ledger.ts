import { api } from "./client";
import type { HistoricalDate } from "@/lib/utils";

export interface LedgerStatsOverview {
  total_souls: number;
  state_distribution: { state: string; label: string; count: number }[];
  tenants: {
    tenant_id: number;
    tenant_code: string;
    tenant_name: string;
    total_souls: number;
    state_breakdown: Record<string, number>;
  }[];
  karma_distribution: { label: string; count: number }[];
  recent_activity: {
    id: number;
    action: string;
    resource: string;
    resource_id: string;
    description: string;
    user: string;
    timestamp: string;
  }[];
  souls_by_realm: {
    realm_code: string;
    realm_name: string;
    civilization?: string;
    count: number;
  }[];
}

/**
 * The facts *poena* presupposes and which the ledger does not record, mirroring
 * `POENA_MISSING_INPUTS` in backend/apps/ledger/readings.py.
 *
 * This used to be an English sentence on the wire (`poena_unavailable`) that
 * nothing read, next to three hard-coded `<li>` elements in SoulReadingPanel
 * that said the same thing better. Two copies of one fact, and only one of them
 * would have moved: a fourth missing input on the backend left the panel
 * rendering three bullets with nothing red.
 *
 * `SoulReadingPanel` now renders one bullet per member of the payload's
 * `poena_missing` and derives each bullet's copy key mechanically —
 * `souls.detail.reading.poena_missing_${member.toLowerCase()}`. A member with
 * no key in a bundle therefore reaches the screen as a visible raw key rather
 * than as a quietly shorter list. `src/__tests__/SoulReadingPanel.test.tsx`
 * holds the copy total over this list;
 * `apps/ledger/test_readings.py::TestFrontendMemberListsAgree` holds this list
 * equal to the backend's, which is the half Jest cannot see.
 */
export const POENA_MISSING_INPUTS = ["ABSOLUTION", "SATISFACTION", "PENANCE"] as const;
export type PoenaMissingInput = (typeof POENA_MISSING_INPUTS)[number];

/**
 * Why a ledger got no reading at all, mirroring `UNAVAILABLE_REASON_CODES`.
 *
 * One member, and it is still keyed rather than flat. The copy keys are
 * `souls.detail.reading.unavailable_${code.toLowerCase()}_explanation` and
 * `..._cta`; they used to be the codeless `unavailable_explanation` /
 * `unavailable_cta`, which a second cause of UNAVAILABLE would have inherited
 * silently and been mis-described by — a real string, in the right language, in
 * the right place, saying the wrong thing. That is the `ledger.civ.UNKNOWN`
 * defect `civilizationCopyCoverage.test.ts` exists because of.
 */
export const UNAVAILABLE_REASON_CODES = ["TENANT_NOT_MAPPED"] as const;
export type UnavailableReasonCode = (typeof UNAVAILABLE_REASON_CODES)[number];

/**
 * What each cosmology reads off the ledger. Discriminated on `kind` —
 * apps/ledger/readings.py deliberately does not force one shape on all four.
 */
export type LedgerReading =
  | { kind: "BALANCE"; civilization: string; balance: number; merit: number; demerit: number }
  | { kind: "THRESHOLD"; civilization: string; heart_weight: number; counterweight: number; heavier_than_feather: boolean }
  | {
      kind: "GUILT_AND_PENALTY";
      civilization: string;
      culpa: number;
      culpa_record_count: number;
      poena: null;
      /** Non-empty for as long as `poena` is null — see POENA_MISSING_INPUTS. */
      poena_missing: PoenaMissingInput[];
    }
  | { kind: "UNAVAILABLE"; civilization: string; reason_code: UnavailableReasonCode };

/**
 * One entry of `LedgerSummary.records`, built by hand in
 * LedgerService.get_ledger_summary (backend/apps/ledger/services.py:350-372) —
 * NOT SoulRecordSerializer. The two differ: this payload renames record_type
 * to `type` and weight to `original_weight`, and adds the decay figures.
 * `soul`, `record_type`, `weight` and `create_time` were declared here and
 * are not in the response at all.
 */
export interface LedgerRecord {
  id: string;
  type: string;
  category: string;
  description: string;
  original_weight: number;
  effective_weight: number;
  years_elapsed: number;
  decay_factor: number;
  civilization: string;
  recorded_at: string;
  /** HistoricalDateField: {year, month, day} | null */
  event_date: HistoricalDate | null;
  is_milestone: boolean;
}

/** 200 body of GET /souls/{id}/karma/ and GET /ledger/balance/{soul_id}/. */
export interface LedgerSummary {
  soul_id: string;
  soul_name: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  record_count: number;
  records: LedgerRecord[];
  reading: LedgerReading;
}

// 200 body of GET /ledger/inheritance/{soul_id}/.
export interface LedgerInheritance {
  soul_id: string;
  inherited_merit: number;
  inherited_demerit: number;
  /** Fraction of merit that survives the gate — 0.2 today. Was an English
   * `inheritance_note` sentence composed in apps/ledger/services.py; the rates
   * come over as numbers now so the wording can live in the message bundles
   * and the card can stop mirroring the constants as literals. */
  inheritance_merit_rate: number;
  /** Fraction of unripened demerit that survives — 1.0 today, deliberately not
   * symmetric with the above. */
  inheritance_demerit_rate: number;
}

// 409 body — the soul's cosmology is terminal (e.g. Egyptian judgment ending
// at Aaru/Ammit, or European judgment ending at Heaven/Hell/Purgatory-then-
// Heaven), so there is no next life to inherit into.
export interface LedgerInheritanceNotApplicable {
  code: string;
  civilization: string;
  detail: string;
}

/** 200 body of POST /ledger/calculate/{soul_id}/. */
export interface LedgerRecalculation {
  soul_id: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
}

export const ledgerApi = {
  // soulId is a UUID: both routes are `<uuid:soul_id>` in
  // backend/apps/ledger/urls.py. These took `number`, which cannot address
  // a soul at all.
  balance: (soulId: string) => api.get<LedgerSummary>(`/ledger/balance/${soulId}/`),
  recalculate: (soulId: string) => api.post<LedgerRecalculation>(`/ledger/calculate/${soulId}/`),
  // Note the ordering: inheritance/ comes before the soul id in the URLconf.
  inheritance: (soulId: string) => api.get<LedgerInheritance>(`/ledger/inheritance/${soulId}/`),
  statsOverview: () => api.get<LedgerStatsOverview>("/ledger/stats/overview/"),
  exportStats: (params?: Record<string, string>) => api.get<Blob>("/ledger/stats/export/", { params, responseType: "blob" }),
};
