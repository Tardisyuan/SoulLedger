/**
 * The soul detail's pure parts (Design batch 39, O-15): which tabs a session sees, the 功过 groups and the
 * signed numbers. No React, so the tests call them directly.
 */
import type { SoulEvent } from "@soulledger/core/api/events";
import type { SentencePlan } from "@soulledger/core/api/sentence-plans";
import type { SoulRecordEntry } from "@soulledger/core/api/souls";

export type SoulTab = "identity" | "judgments" | "karma" | "fate" | "events";

/** Rows a 功过 / 事件 list adds per 「加载更多」. */
export const SOUL_PAGE = 20;

/**
 * By permission CODE, like the desk. Reading this screen at all needs `soul.read`, which is also what 功过 needs,
 * and the event log has no code of its own (`apps/events/views.py`), so 身份 · 功过 · 事件 are always there.
 * A tab nobody may see is not drawn (no 「需要 ×× 权限」).
 */
export function soulTabs(permissions: readonly string[]): SoulTab[] {
  const has = (p: string) => permissions.includes(p);
  return [
    "identity",
    ...(has("judgment.read") ? (["judgments"] as const) : []),
    "karma",
    ...(has("disposition.read") || has("reincarnation.read") ? (["fate"] as const) : []),
    "events",
  ];
}

/** `+12` / `−4` (U+2212, as the board), `0`. Never a colour. */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

export interface KarmaGroup {
  /** 0 is the first life; shown as `cycle + 1`. */
  cycle: number;
  /** Every deed of that life, not only the ones on screen: the header says how many there are. */
  count: number;
  rows: SoulRecordEntry[];
}

const isDeed = (r: SoulRecordEntry) => r.record_type === "MERIT" || r.record_type === "DEMERIT";

/**
 * 功过 grouped by life, newest life first and newest deed first inside one. `/souls/<id>/records/` is a bare
 * array (not paged), so the 20-a-time paging is done here, on the client: `shown` rows are drawn, `total` is all.
 * Judgment / disposition evidence rows are not deeds and are left out.
 */
export function karmaView(records: readonly SoulRecordEntry[], shown: number): { groups: KarmaGroup[]; shown: number; total: number } {
  const deeds = records.filter(isDeed).sort((a, b) => b.cycle - a.cycle || b.recorded_at.localeCompare(a.recorded_at));
  const counts = new Map<number, number>();
  for (const r of deeds) counts.set(r.cycle, (counts.get(r.cycle) ?? 0) + 1);
  const groups: KarmaGroup[] = [];
  for (const r of deeds.slice(0, shown)) {
    const last = groups[groups.length - 1];
    if (last && last.cycle === r.cycle) last.rows.push(r);
    else groups.push({ cycle: r.cycle, count: counts.get(r.cycle) ?? 0, rows: [r] });
  }
  return { groups, shown: Math.min(shown, deeds.length), total: deeds.length };
}

/** A deed's score with its sign: a demerit's weight is stored positive. */
export function deedScore(r: Pick<SoulRecordEntry, "record_type" | "weight">): string {
  return signed(r.record_type === "DEMERIT" ? -Math.abs(r.weight) : Math.abs(r.weight));
}

type Translate = (key: string, values?: Record<string, string>) => string;
type Label = (namespace: string, raw: string | null | undefined) => { state: string; label?: string | null };

const named = (label: Label, ns: string, raw: unknown): string => {
  if (typeof raw !== "string" || raw === "") return "—";
  const d = label(ns, raw);
  return d.state === "known" && d.label ? d.label : raw;
};

/**
 * The 细节 column of the desk's 灵魂事件 page (`frontend/src/components/events/soulEventRows.ts` `eventDetail`), for
 * the two types that have one; null for the rest. Kept in step by hand: that file is the web's, not core's.
 */
export function eventDetail(e: SoulEvent, label: Label, t: Translate): string | null {
  const p = e.payload ?? {};
  if (e.event_type === "STATE_CHANGED") {
    const reason = typeof p.reason === "string" ? p.reason.trim() : "";
    const text = t("events.detail.state", { from: named(label, "souls.states", p.old_state), to: named(label, "souls.states", p.new_state), reason });
    return reason ? text : text.replace(/\s*·\s*$/, "");
  }
  if (e.event_type === "KARMA_RECALCULATED") {
    const n = (v: unknown) => (typeof v === "number" ? signed(v) : "—");
    return t("events.detail.karma", { merit: n(p.delta), demerit: n(p.demerit_delta) });
  }
  return null;
}

const NOW = new Set(["DISPATCHING", "ACTIVE", "WAITING", "ETERNAL"]);

/** The stop the soul is at: the first live one in order. Removed / cancelled stops are not shown at all. */
export function planStops(plan: Pick<SentencePlan, "nodes">) {
  const nodes = [...plan.nodes].filter((n) => n.status !== "REMOVED" && n.status !== "CANCELLED").sort((a, b) => a.order - b.order);
  const current = nodes.find((n) => NOW.has(n.status))?.id ?? null;
  return { nodes, current };
}
