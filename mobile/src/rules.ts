/**
 * The presentation decisions that are rules rather than styles — each one
 * a thing a screen could get silently wrong, so each is a pure function with a
 * test (`__tests__/rules.test.ts`).
 */
import type { MeRebirthApplication } from "@soulledger/core/api/soul";

import type { CivKey } from "./theme";

// ── badges ──────────────────────────────────────────────────────────────

export type BadgeTone = "accent" | "neg" | "pos" | "muted" | "unknown";
/** A badge is told apart by glyph and border as well as colour. */
export interface BadgeSpec {
  tone: BadgeTone;
  glyph: string;
  border: "solid" | "dashed" | "dotted";
}

export const APPLICATION_BADGES: Record<string, BadgeSpec> = {
  UNDER_REVIEW: { tone: "accent", glyph: "◷", border: "solid" },
  REJECTED: { tone: "neg", glyph: "×", border: "solid" },
  APPEALING: { tone: "accent", glyph: "↺", border: "solid" },
  APPEAL_REJECTED: { tone: "neg", glyph: "×", border: "dashed" },
  APPROVED: { tone: "pos", glyph: "✓", border: "solid" },
};

/**
 * The design draws three soul states. The other three members the backend has
 * (ALIVE / LOST / SETTLED) get the muted shape with a plain dot: known values,
 * so NOT the unknown badge — that one is reserved for a value we cannot name.
 */
export const SOUL_STATE_BADGES: Record<string, BadgeSpec> = {
  JUDGING: { tone: "accent", glyph: "◷", border: "solid" },
  DISPOSED: { tone: "muted", glyph: "▣", border: "solid" },
  REINCARNATING: { tone: "muted", glyph: "↻", border: "solid" },
  ALIVE: { tone: "muted", glyph: "·", border: "solid" },
  LOST: { tone: "muted", glyph: "·", border: "solid" },
  SETTLED: { tone: "muted", glyph: "·", border: "solid" },
};

export const UNKNOWN_BADGE: BadgeSpec = { tone: "unknown", glyph: "?", border: "dotted" };

/**
 * The shape for a member. `recognized` is whether the copy layer could name it;
 * a member the table has but the bundles do not still gets the unknown shape,
 * so the raw value is shown beside it.
 */
export function badgeSpec(table: Record<string, BadgeSpec>, raw: string | null | undefined, recognized: boolean): BadgeSpec {
  if (!recognized || !raw) return UNKNOWN_BADGE;
  return table[raw] ?? UNKNOWN_BADGE;
}

// ── initial password expiry ────────────────────────────────────────────

export const EXPIRY_WARNING_HOURS = 6;

export interface Expiry {
  /** Whole hours left, rounded down; 0 means under an hour. */
  hoursLeft: number;
  /** Under {@link EXPIRY_WARNING_HOURS}: the box turns to the warning colour AND says what happens next. */
  warning: boolean;
  expired: boolean;
}

export function expiryOf(expiresAt: string | null | undefined, now: number): Expiry | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  const ms = at - now;
  return {
    hoursLeft: Math.max(0, Math.floor(ms / 3_600_000)),
    warning: ms < EXPIRY_WARNING_HOURS * 3_600_000,
    expired: ms <= 0,
  };
}

// ── long text ──────────────────────────────────────────────────────────

/** A data-row label longer than this puts label and value on two lines (handoff 1g, rule 一). */
export const LABEL_STACK_THRESHOLD = 18;

export function stacksLabel(label: string): boolean {
  return [...label].length > LABEL_STACK_THRESHOLD;
}

// ── lexicon ────────────────────────────────────────────────────────────

/**
 * Words a civilization says differently; only the label changes, never the
 * component or the value. Egypt reads the two scores as heart and feather.
 */
const LEXICON: Partial<Record<CivKey, Partial<Record<"merit" | "demerit", string>>>> = {
  eg: { merit: "soul_app.lexicon.eg.merit", demerit: "soul_app.lexicon.eg.demerit" },
};

export function lexiconKey(civ: CivKey, word: "merit" | "demerit"): string {
  return LEXICON[civ]?.[word] ?? `soul_app.life.${word}`;
}

// ── dates ──────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** A server timestamp as the value the design shows in mono: `YYYY-MM-DD HH:mm`, device time. */
export function formatStamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── application timeline ───────────────────────────────────────────────

export type StepState = "done" | "now" | "todo";

export interface TimelineStep {
  key: string;
  state: StepState;
  /** A `soul_app.*` key, or the current workflow node's type and approver role. */
  label: { key: string } | { node: string; role: string; appeal: boolean };
  /** Only when the backend has a time for exactly this step. */
  at?: string;
}

const FIRST_DECISION_MADE = new Set(["REJECTED", "APPEALING", "APPEAL_REJECTED"]);
const APPEALED = new Set(["APPEALING", "APPEAL_REJECTED"]);
const OPEN = new Set(["UNDER_REVIEW", "APPEALING"]);

/**
 * The flow of one application, drawn ONLY from fields the backend sends:
 * `created_at`, `status`, `current_step`, `decided_at`, `appeal_statement`,
 * `can_appeal`. There is no per-node history in `/me/`, so a step the backend
 * has no time for carries none, and no step is invented to fill the shape of
 * the design's six-row example.
 *
 * `decided_at` is the latest decision. It is attached to the first rejection
 * only while the status is still REJECTED; once an appeal exists the same field
 * would describe the appeal's outcome, so it moves there.
 */
export function timelineOf(a: MeRebirthApplication): TimelineStep[] {
  const steps: TimelineStep[] = [{ key: "submitted", state: "done", label: { key: "soul_app.timeline.submitted" }, at: a.created_at }];
  if (FIRST_DECISION_MADE.has(a.status)) {
    steps.push({
      key: "rejected",
      state: "done",
      label: { key: "soul_app.timeline.rejected" },
      ...(a.status === "REJECTED" && a.decided_at ? { at: a.decided_at } : {}),
    });
  }
  if (APPEALED.has(a.status) || (a.appeal_statement ?? "") !== "") {
    steps.push({ key: "appealed", state: "done", label: { key: "soul_app.timeline.appealed" } });
  }
  if (a.current_step) {
    steps.push({
      key: "current",
      state: "now",
      label: { node: a.current_step.node_type, role: a.current_step.approver_role, appeal: a.current_step.is_appeal },
    });
  }
  if (a.status === "REJECTED" && a.can_appeal) {
    steps.push({ key: "appeal-open", state: "todo", label: { key: "soul_app.timeline.appeal_open" } });
  }
  if (a.status === "APPROVED" || a.status === "APPEAL_REJECTED") {
    steps.push({
      key: "outcome",
      state: "done",
      label: { key: `soul_app.status.${a.status}` },
      ...(a.decided_at ? { at: a.decided_at } : {}),
    });
  } else if (OPEN.has(a.status)) {
    steps.push({ key: "outcome", state: "todo", label: { key: "soul_app.timeline.outcome_pending" } });
  }
  return steps;
}
