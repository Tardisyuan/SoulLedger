/**
 * Pure row-building helpers for SoulLifecycleTimeline (Stage 3 "soul
 * lifecycle" design doc). Kept dependency-free from React so the row
 * construction/sorting/grouping logic can be unit-tested directly.
 *
 * Domain transition markers (birth/death/judgment/disposition/reincarnation)
 * are built from the already-fetched structured records (Judgment,
 * Disposition, Reincarnation, Soul dates) rather than reconstructed from raw
 * SoulEvent payloads — those objects carry richer, more reliable fields
 * (verdict enum, realm_name, timestamps) than a freeform event payload does.
 * Raw SoulEvent rows are used only for the toggle-gated "system events" feed.
 */
import { resolveEnumDisplay, type Translate } from "@/src/lib/domainDisplay";
import type { Soul } from "@/lib/api/souls";
import type { SoulEvent } from "@/lib/api/events";
import type { Judgment } from "@/lib/api/judgment";
import type { Disposition } from "@/lib/api/disposition";
import type { Reincarnation } from "@/lib/api/reincarnation";
import type { LedgerRecord } from "@/lib/api/ledger";
import type { HistoricalDate } from "@/lib/utils";

export type SpineTab = "all" | "karma" | "judgment";

export type RowCategory = "karma" | "judgment" | "disposition" | "reincarnation" | "system" | "structural";

interface BaseRow {
  id: string;
  sortKey: number;
  category: RowCategory;
}

export interface KarmaRow extends BaseRow {
  kind: "karma";
  category: "karma";
  dateLabel: string | null;
  effectiveSigned: number;
  originalSigned: number;
  decayFactor: number;
  yearsElapsed: number;
  title: string;
  category_code: string;
  type: "MERIT" | "DEMERIT";
  isMilestone: boolean;
}

export interface MarkerRow extends BaseRow {
  kind: "marker";
  category: "judgment" | "disposition" | "reincarnation" | "structural";
  dateLabel: string | null;
  glyph: string;
  title: string;
  metadata?: string;
  tone: "neutral" | "merit" | "demerit" | "info" | "accent";
  idChip?: string;
}

export interface SystemGroupRow extends BaseRow {
  kind: "system";
  category: "system";
  dateLabel: string | null;
  title: string;
  /** The raw `event_type` member, for the row's `title` attribute only — the
   * same arrangement `src/lib/domainDisplay.ts` documents for every other enum
   * here: translated copy on screen, raw value recoverable for triage. Never
   * render this as text. */
  rawEventType: string;
  count: number;
  actor: string;
  items: SoulEvent[];
}

export interface FutureRow extends BaseRow {
  kind: "future";
  category: "structural";
  title: string;
  hint: string;
}

export interface ActionRow extends BaseRow {
  kind: "action";
  category: "structural";
  title: string;
  hint: string;
}

export interface CycleBandRow extends BaseRow {
  kind: "cycle-band";
  category: "structural";
  cycleNumber: number;
  name: string;
  form: string | null;
  isCurrent: boolean;
  dateLabel: string | null;
}

export type SpineRow = KarmaRow | MarkerRow | SystemGroupRow | FutureRow | ActionRow | CycleBandRow;

// ── Sort-key helpers — one consistent numeric space for chronological rows ──

/** Real ISO datetime string -> sortable ms. Non-parseable/absent -> 0. */
export function toSortMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** HistoricalDate (which allows BCE years) -> approximate sortable ms. Only
 * used for ordering, not calendar-accurate math. */
export function historicalToMs(d: HistoricalDate | null | undefined): number | null {
  if (!d) return null;
  const dt = new Date(0);
  dt.setUTCFullYear(d.year, (d.month ?? 1) - 1, d.day ?? 1);
  return dt.getTime();
}

/** Sentinel space above any real timestamp, for "now"/"future" rows that must
 * always float to the top of a newest-first spine regardless of wall clock. */
const FUTURE_BASE = Number.MAX_SAFE_INTEGER;

function yearLabel(date: HistoricalDate): string {
  return date.year <= 0 ? `${Math.abs(date.year)} BCE` : `${date.year}`;
}

function isoDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

// ── Karma rows ────────────────────────────────────────────────────────────

export function buildKarmaRows(records: LedgerRecord[]): KarmaRow[] {
  return records.map((r) => {
    const sign = r.type === "MERIT" ? 1 : -1;
    const sortKey = r.event_date ? (historicalToMs(r.event_date) ?? toSortMs(r.recorded_at)) : toSortMs(r.recorded_at);
    return {
      id: `karma-${r.id}`,
      kind: "karma",
      category: "karma",
      sortKey,
      dateLabel: r.event_date ? yearLabel(r.event_date) : isoDateLabel(r.recorded_at),
      effectiveSigned: sign * r.effective_weight,
      originalSigned: sign * r.original_weight,
      decayFactor: r.decay_factor,
      yearsElapsed: r.years_elapsed,
      title: r.description,
      category_code: r.category,
      type: r.type === "MERIT" ? "MERIT" : "DEMERIT",
      isMilestone: r.is_milestone,
    };
  });
}

// ── Domain transition markers — from structured objects, not raw events ────

export function buildBirthMarker(soul: Soul, title: string): MarkerRow | null {
  if (!soul.birth_date) return null;
  return {
    id: "marker-birth",
    kind: "marker",
    category: "structural",
    sortKey: historicalToMs(soul.birth_date) ?? 0,
    dateLabel: yearLabel(soul.birth_date),
    glyph: "○",
    title,
    tone: "neutral",
  };
}

export function buildDeathMarker(soul: Soul, title: string): MarkerRow | null {
  if (!soul.death_date) return null;
  return {
    id: "marker-death",
    kind: "marker",
    category: "structural",
    sortKey: (historicalToMs(soul.death_date) ?? 0) + 1, // nudge above birth on same-day edge cases
    dateLabel: yearLabel(soul.death_date),
    glyph: "†",
    title,
    tone: "neutral",
  };
}

export function buildJudgmentMarkers(
  judgments: Judgment[],
  labels: { entered: (court: string) => string; verdict: (verdict: string) => string }
): MarkerRow[] {
  const rows: MarkerRow[] = [];
  for (const j of judgments) {
    rows.push({
      id: `judgment-entered-${j.id}`,
      kind: "marker",
      category: "judgment",
      sortKey: toSortMs(j.created_at),
      dateLabel: isoDateLabel(j.created_at),
      glyph: "⚖",
      title: labels.entered(j.court),
      tone: "info",
    });
    if (j.is_final && j.verdict) {
      const tone = j.verdict === "PASSED" ? "merit" : j.verdict === "FAILED" ? "demerit" : "info";
      rows.push({
        id: `judgment-verdict-${j.id}`,
        kind: "marker",
        category: "judgment",
        sortKey: toSortMs(j.concluded_at ?? j.created_at),
        dateLabel: isoDateLabel(j.concluded_at ?? j.created_at),
        glyph: "⚖",
        title: labels.verdict(j.verdict),
        tone,
      });
    }
  }
  return rows;
}

export function buildDispositionMarkers(
  dispositions: Disposition[],
  labels: { executed: (realm: string) => string; eternal: string; memoryReset: (years: string) => string }
): MarkerRow[] {
  return dispositions
    .filter((d) => d.is_executed)
    .map((d) => {
      const realm = d.realm_name || d.realm_code || "";
      const metaParts = [d.is_eternal ? labels.eternal : labels.memoryReset(d.memory_reset)];
      return {
        id: `disposition-${d.id}`,
        kind: "marker" as const,
        category: "disposition" as const,
        sortKey: toSortMs(d.executed_at ?? d.created_at),
        dateLabel: isoDateLabel(d.executed_at ?? d.created_at),
        glyph: "→",
        title: labels.executed(realm),
        metadata: metaParts.join(" · "),
        tone: "accent" as const,
        idChip: d.destination_realm ?? undefined,
      };
    });
}

export function buildReincarnationMarkers(
  reincarnations: Reincarnation[],
  labels: { reborn: (name: string) => string; cycle: (n: string, realm: string) => string }
): MarkerRow[] {
  return reincarnations.map((r) => ({
    id: `reincarnation-${r.id}`,
    kind: "marker",
    category: "reincarnation",
    sortKey: toSortMs(r.reincarnated_at),
    dateLabel: isoDateLabel(r.reincarnated_at),
    glyph: "☯",
    title: labels.reborn(r.new_identity),
    metadata: labels.cycle(String(r.cycle_count), r.target_realm),
    tone: "accent",
  }));
}

// ── System event rows — grouped, decoded, toggle-gated ─────────────────────

export function groupSystemEvents(events: SoulEvent[]): { key: string; eventType: string; actor: string; date: string; items: SoulEvent[] }[] {
  const sorted = [...events].sort((a, b) => toSortMs(b.create_time) - toSortMs(a.create_time));
  const groups: { key: string; eventType: string; actor: string; date: string; items: SoulEvent[] }[] = [];
  for (const e of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.eventType === e.event_type && last.actor === e.actor && last.date === e.create_time) {
      last.items.push(e);
    } else {
      groups.push({ key: e.id, eventType: e.event_type, actor: e.actor, date: e.create_time, items: [e] });
    }
  }
  return groups;
}

/**
 * The two enum→text lookups a system-event row needs, injected the same way
 * every other builder in this file takes its copy.
 *
 * This replaced a private `Record<string, string>` of twenty hard-coded Chinese
 * labels sitting in a module that is otherwise deliberately copy-free. The map
 * only covered `event_type`; the STATE_CHANGED branch interpolated `old_state`
 * and `new_state` straight from the payload, so a Chinese-labelled row read
 * "状态变更 JUDGING → DISPOSED" — a translated prefix in front of two raw enum
 * members, in every locale, which is BRIEF §4.6's complaint exactly.
 *
 * Both functions must return translated copy or a translated placeholder, never
 * the member they were handed. `makeSystemEventLabels` is the only supported
 * construction; a hand-rolled identity function here reintroduces the defect and
 * makes a test measuring it look green.
 */
export interface SystemEventLabels {
  /** `souls.events.<TYPE>`. */
  eventType: (raw: string) => string;
  /** `souls.states.<STATE>`; null when the payload carried no state at all. */
  state: (raw: string | null) => string;
}

/**
 * Build the labels from a real `t`, routing both namespaces through
 * `resolveEnumDisplay` — translated copy first, translated "unrecognized" for a
 * member the bundles do not cover, and the raw member never.
 */
export function makeSystemEventLabels(t: Translate): SystemEventLabels {
  const via = (namespace: string) => (raw: string | null) => {
    const resolved = resolveEnumDisplay(t, namespace, raw);
    // `label` is null only for the "missing" branch (null/empty input), which
    // for a state means the payload recorded no such side to the transition.
    return resolved.label ?? t("common.value.unrecorded");
  };
  return { eventType: via("souls.events"), state: via("souls.states") };
}

/** Defect fix: render the event's actual payload, not the bare event_type
 * token — a bare "STATE_CHANGED" row told the user nothing a raw audit
 * table wouldn't already show worse.
 *
 * Everything this returns is either translated copy or punctuation, with one
 * documented exception: `payload.reason` is free text the backend wrote into
 * the audit record (e.g. "Judgment concluded: PASSED"). It is data about what
 * happened rather than this UI's copy, it is not drawn from any enumerable set,
 * and it is shown verbatim for the same reason a deed's description is. That is
 * a separate, backend-side i18n question from the one this function closed. */
export function describeSystemEvent(e: SoulEvent, labels: SystemEventLabels): string {
  const p = e.payload as Record<string, unknown>;
  const event = labels.eventType(e.event_type);
  switch (e.event_type) {
    case "STATE_CHANGED": {
      const oldState = labels.state(typeof p.old_state === "string" ? p.old_state : null);
      const newState = labels.state(typeof p.new_state === "string" ? p.new_state : null);
      const reason = typeof p.reason === "string" && p.reason ? ` · ${p.reason}` : "";
      return `${event} ${oldState} → ${newState}${reason}`;
    }
    case "KARMA_RECALCULATED": {
      const delta = typeof p.delta === "number" ? p.delta : null;
      return delta === null ? event : `${event} · Δ${delta >= 0 ? "+" : ""}${delta}`;
    }
    default:
      return event;
  }
}

export function buildSystemRows(events: SoulEvent[], labels: SystemEventLabels): SystemGroupRow[] {
  return groupSystemEvents(events).map((g) => ({
    id: `system-${g.key}`,
    kind: "system",
    category: "system",
    sortKey: toSortMs(g.date),
    dateLabel: isoDateLabel(g.date),
    title: describeSystemEvent(g.items[0], labels),
    rawEventType: g.eventType,
    count: g.items.length,
    actor: g.actor,
    items: g.items,
  }));
}

// ── Future / not-yet-reached stages ─────────────────────────────────────────

const PIPELINE_ORDER = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING"] as const;
type PipelineState = (typeof PIPELINE_ORDER)[number];
export type FutureStageKey = "JUDGING" | "DISPOSED" | "REINCARNATING" | "NEXT_LIFE";

/** SETTLED/LOST are absorbing states with no valid outward transition
 * (Soul.can_transition_to returns [] for both) — nothing is pending. */
export function computeFutureStages(currentState: string): FutureStageKey[] {
  if (currentState === "SETTLED" || currentState === "LOST") return [];
  const idx = PIPELINE_ORDER.indexOf(currentState as PipelineState);
  if (idx === -1) return [];
  const pending = PIPELINE_ORDER.slice(idx + 1) as FutureStageKey[];
  return [...pending, "NEXT_LIFE"];
}

export function buildFutureRows(
  stages: FutureStageKey[],
  labels: Record<FutureStageKey, { title: string; hint: string }>
): FutureRow[] {
  return stages.map((stage, i) => ({
    id: `future-${stage}`,
    kind: "future",
    category: "structural",
    sortKey: FUTURE_BASE - 10 - i,
    title: labels[stage].title,
    hint: labels[stage].hint,
  }));
}

export function buildActionRow(title: string, hint: string): ActionRow {
  return { id: "action-judging", kind: "action", category: "structural", sortKey: FUTURE_BASE, title, hint };
}

// ── Cycle bands (multi-life souls) ──────────────────────────────────────────

export function buildCycleBandRows(
  soul: Soul,
  reincarnations: Reincarnation[],
  cycleLabel: (n: number) => string
): CycleBandRow[] {
  if (reincarnations.length === 0) return [];
  const sorted = [...reincarnations].sort((a, b) => toSortMs(a.reincarnated_at) - toSortMs(b.reincarnated_at));
  const rows: CycleBandRow[] = [];

  // Life 1 — the original identity, starting at the soul's recorded birth.
  rows.push({
    id: "cycle-1",
    kind: "cycle-band",
    category: "structural",
    sortKey: (historicalToMs(soul.birth_date) ?? 0) - 1, // sit just under the birth marker itself
    cycleNumber: 1,
    name: soul.birth_name || soul.name,
    form: null,
    isCurrent: false,
    dateLabel: soul.birth_date ? yearLabel(soul.birth_date) : null,
  });

  // Life 2..N — each begins at its reincarnation record's transition.
  sorted.forEach((r, i) => {
    const cycleNumber = i + 2;
    rows.push({
      id: `cycle-${cycleNumber}`,
      kind: "cycle-band",
      category: "structural",
      sortKey: toSortMs(r.reincarnated_at) - 1,
      cycleNumber,
      name: r.new_identity,
      form: r.rebirth_form,
      isCurrent: i === sorted.length - 1,
      dateLabel: isoDateLabel(r.reincarnated_at),
    });
  });

  return rows;
}

// ── Filtering ────────────────────────────────────────────────────────────

export function filterRows(rows: SpineRow[], tab: SpineTab, includeSystemEvents: boolean): SpineRow[] {
  return rows.filter((row) => {
    if (row.category === "structural") return true;
    if (row.category === "system") return includeSystemEvents;
    if (tab === "all") return true;
    if (tab === "karma") return row.category === "karma";
    if (tab === "judgment") return row.category === "judgment";
    return true;
  });
}

export function sortRows(rows: SpineRow[]): SpineRow[] {
  return [...rows].sort((a, b) => b.sortKey - a.sortKey);
}

export { PIPELINE_ORDER };
