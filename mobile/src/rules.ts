/**
 * The presentation decisions that are rules rather than styles — each one
 * a thing a screen could get silently wrong, so each is a pure function with a
 * test (`__tests__/rules.test.ts`).
 */
import type { MeRebirthApplication } from "@soulledger/core/api/soul";

import { civKeyOf, type CivKey } from "./theme";

// ── badges ──────────────────────────────────────────────────────────────

/**
 * 补足 C15「状态徽章 · 领域枚举」: a badge is a domain value, never a status colour — ink
 * words in a 1px ink3 frame, told apart by glyph and border. The ones still waiting on
 * someone (`pending`: 待审 / 申诉中) sit on s2. A ✕ is ink too: 冷玫红 is for the system
 * failing, not for a decision (B8). `unknown` is the value the app cannot name.
 */
export interface BadgeSpec {
  glyph: string;
  border: "solid" | "dashed" | "dotted";
  pending?: boolean;
  unknown?: boolean;
}

export const APPLICATION_BADGES: Record<string, BadgeSpec> = {
  UNDER_REVIEW: { glyph: "◇", border: "solid", pending: true },
  REJECTED: { glyph: "✕", border: "solid" },
  APPEALING: { glyph: "↺", border: "solid", pending: true },
  APPEAL_REJECTED: { glyph: "✕", border: "dashed" },
  APPROVED: { glyph: "✓", border: "solid" },
};

/**
 * All six `Soul.current_state` members, per C15's drawing where it names them (○ 在世,
 * ◇ 待审 on s2, ↻ 轮回) and the same system for the rest. The unknown badge (`?`,
 * dotted) stays reserved for a value the app cannot name.
 */
export const SOUL_STATE_BADGES: Record<string, BadgeSpec> = {
  /** Still to be decided: the open diamond, on s2 — C15's 待审. */
  JUDGING: { glyph: "◇", border: "solid", pending: true },
  /** A disposition is on record: a filled box within the frame. */
  DISPOSED: { glyph: "▣", border: "solid" },
  /** Moving on: the cycle arrow. */
  REINCARNATING: { glyph: "↻", border: "solid" },
  /** Not yet dead, so nothing entered: an EMPTY circle. */
  ALIVE: { glyph: "○", border: "solid" },
  /**
   * The record has lost track of the soul: a dotted circle (◌, Design E 组 — the web's glyph too;
   * it was ⊘) on a DASHED border — an anomaly, said by its shape, not by a colour. Dashed, not
   * dotted: dotted is the unknown value.
   */
  LOST: { glyph: "◌", border: "dashed" },
  /** The account is closed: triple bar, the ledger ruled off beneath its last line. */
  SETTLED: { glyph: "≡", border: "solid" },
};

export const UNKNOWN_BADGE: BadgeSpec = { glyph: "?", border: "dotted", unknown: true };

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
 * Words a civilization says differently. Only the label changes — never the
 * field, the component or the value (Egypt's two sides are the same two
 * integers, `merit_score` / `demerit_score`, as everywhere else; handoff 2f-一
 * withdraws round 1's "1.02").
 *
 * A soul residing in another civilization keeps its HOME lexicon (user
 * decision 2026-09-17): the skin follows where it is, the words and the
 * rebirth rules follow where it belongs.
 */
export type LexiconWord =
  | "merit"
  | "demerit"
  | "merit_entry"
  | "demerit_entry"
  | "records"
  | "judgments"
  | "court"
  | "judging"
  | "past_read_only"
  | "no_past_lives"
  | "no_rebirth_title"
  | "no_rebirth_body";

const DEFAULT_WORDS: Record<LexiconWord, string> = {
  merit: "soul_app.life.merit",
  demerit: "soul_app.life.demerit",
  merit_entry: "soul_app.life.merit_entry",
  demerit_entry: "soul_app.life.demerit_entry",
  records: "soul_app.life.records",
  judgments: "soul_app.life.judgments",
  court: "soul_app.life.court",
  judging: "soul_app.soul_states.JUDGING",
  past_read_only: "soul_app.past_lives.read_only",
  no_past_lives: "soul_app.past_lives.empty",
  no_rebirth_title: "soul_app.lexicon.default.no_rebirth_title",
  no_rebirth_body: "soul_app.lexicon.default.no_rebirth_body",
};

/**
 * eu and eg are the two civilizations without rebirth
 * (`backend/apps/ledger/constants.py::REBIRTH_CAPABLE_CIVILIZATIONS`), which is
 * why both carry their own "no past lives / no rebirth" sentences. That is COPY
 * only: whether a soul may apply is always the server's `can_apply` / `reason`.
 */
const LEXICON: Partial<Record<CivKey, readonly LexiconWord[]>> = {
  eg: Object.keys(DEFAULT_WORDS) as LexiconWord[],
  eu: ["past_read_only", "no_past_lives", "no_rebirth_title", "no_rebirth_body"],
};

export function lexiconKey(civ: CivKey, word: LexiconWord): string {
  return LEXICON[civ]?.includes(word) ? `soul_app.lexicon.${civ}.${word}` : DEFAULT_WORDS[word];
}

// ── residence ──────────────────────────────────────────────────────────

export interface Residence {
  /** Where the soul is now: the skin. */
  current: CivKey;
  /** Where the soul belongs: the words and the rebirth rules. */
  home: CivKey;
  /** A home tenant is known and differs from the current tenant. */
  residing: boolean;
}

/**
 * `is_residing` is the server's word; `home_civilization` names the lexicon.
 * A home civilization the app does not know is not guessed at: the soul is
 * then shown as at home, in the current civilization's words.
 */
export function residenceOf(
  current: CivKey,
  me: { is_residing: boolean; home_civilization: string } | null | undefined
): Residence {
  const home = me?.is_residing ? civKeyOf(me.home_civilization) : "neutral";
  return home !== "neutral" ? { current, home, residing: true } : { current, home: current, residing: false };
}

// ── the life page (补足 B11) ───────────────────────────────────────────

/** A sentence plan the soul is still inside: serving, between two stations, held, or there for good. */
const UNDER_SENTENCE = new Set(["serving", "between", "waiting", "eternal"]);

/** The six folding sections, in B11's order. */
export const LIFE_SECTIONS = ["records", "judgments", "dispositions", "applications", "sentence", "past_lives"] as const;
export type LifeSectionKey = (typeof LIFE_SECTIONS)[number];

/**
 * B11: exactly one section opens by default — 「受刑」 while the soul is under sentence,
 * else 「功过记录」. Until the plan has loaded the soul is not known to be, so: records.
 */
export function defaultLifeSection(planState: string | null | undefined): LifeSectionKey {
  return planState && UNDER_SENTENCE.has(planState) ? "sentence" : "records";
}

/** A section the soul opened or closed by hand wins over the default; the rest follow it. */
export function lifeSectionsOpen(touched: Partial<Record<LifeSectionKey, boolean>>, planState: string | null | undefined) {
  const first = defaultLifeSection(planState);
  return Object.fromEntries(LIFE_SECTIONS.map((k) => [k, touched[k] ?? k === first])) as Record<LifeSectionKey, boolean>;
}

/**
 * B11's 行程缩略: where this life has got to, as steps of the one road every soul walks.
 * Read from `current_state` (and, once disposed, whether a sentence plan exists) — the
 * App has no route of stops (`/me/` does not serve the officers' `path`), so this is the
 * life's stage, not a map. LOST, SETTLED and an unknown state have no place on it: null,
 * and nothing is drawn rather than a guess.
 */
export const LIFE_PATH = ["ALIVE", "JUDGING", "DISPOSED", "SENTENCE", "REINCARNATING"] as const;
export type LifePathStep = (typeof LIFE_PATH)[number];

export function lifePathIndex(state: string | null | undefined, planState: string | null | undefined): number | null {
  switch (state) {
    case "ALIVE":
      return 0;
    case "JUDGING":
      return 1;
    case "DISPOSED":
      return planState && planState !== "none" ? 3 : 2;
    case "REINCARNATING":
      return 4;
    default:
      return null;
  }
}

/** The balance as B11 prints it: signed, the minus a real minus (U+2212), zero bare. */
export function signedBalance(merit: number, demerit: number): string {
  const b = merit - demerit;
  return b > 0 ? `+${b}` : b < 0 ? `\u2212${-b}` : "0";
}

/**
 * The share of the current station's term already served, 0–1, for B11's one status-coloured
 * bar. Null when there is nothing to measure: no start or end date, or a term for good.
 */
export function termServed(startedOn: string | null | undefined, endsOn: string | null | undefined, now: number): number | null {
  if (!startedOn || !endsOn) return null;
  const a = Date.parse(startedOn);
  const b = Date.parse(endsOn);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.min(1, Math.max(0, (now - a) / (b - a)));
}

// ── layout ─────────────────────────────────────────────────────────────

export const COMPACT_WIDTH = 340;
export const GROW_FONT_SCALE = 1.3;
export const STACK_FONT_SCALE = 1.7;

export interface Layout {
  /** ≤ 340pt wide: gutter 16, data rows stacked, display one step down. */
  compact: boolean;
  /** ≥ 1.3× text: badges wrap, heights are minimums. */
  grow: boolean;
  /** ≥ 1.7× text: tab bar, scores, password reveal and languages go vertical; the flow drops its rail. */
  stack: boolean;
  gutter: number;
}

/** Handoff 2f-四: three thresholds, one decision. */
export function layoutFor(width: number, fontScale: number): Layout {
  const compact = width <= COMPACT_WIDTH;
  return { compact, grow: fontScale >= GROW_FONT_SCALE, stack: fontScale >= STACK_FONT_SCALE, gutter: compact ? 16 : 20 };
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

// ── password reset (「忘记密码」) ──────────────────────────────────────

/** The code's life: `reset_password_request` caches it with `timeout=300`. */
export const RESET_CODE_TTL_SECONDS = 300;
/**
 * When a resend is offered. `PasswordResetThrottle` allows 3 requests per 5
 * minutes per IP (`"password_reset": "3/5minute"`), so 300 / 3 is the pace one
 * device can keep up without ever meeting that throttle. It is not a promise:
 * the backend also counts 3 per address and restarts that window on every send,
 * so a fourth send inside five minutes of the last is still a 429.
 */
export const RESEND_AFTER_SECONDS = 100;

/** Six digits, as `SetNewPasswordSerializer.validate_code` requires. */
export const RESET_CODE = /^\d{6}$/;

/**
 * Enough of an address to be worth sending: something@something.something, no
 * spaces. The server's `EmailField` is the real judge; this only keeps a typo
 * from spending one of the three sends.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Seconds left as `m:ss` — the countdown's mono value. Never negative. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

// ── application flow ───────────────────────────────────────────────────

export type StepState = "done" | "now" | "todo";

export interface FlowStep {
  key: string;
  state: StepState;
  /** A `soul_app.timeline.*` key; `status` fills the decision's outcome. */
  name: { key: string; status?: string };
  /** A second line of copy (可申诉一次 / 待定 / 无时间戳). */
  note?: string;
  /** The approver role — only the current step has one (`current_step`). */
  role?: string;
  /** Only `created_at` and `decided_at` exist; no other step ever gets a time. */
  at?: string;
  /** The rail after the current step is dashed: how many steps follow is unknown. */
  dashedAfter?: boolean;
}

const APPEALED = new Set(["APPEALING", "APPEAL_REJECTED"]);

/**
 * Whether this application has been appealed — i.e. whether a FIRST rejection
 * exists apart from the latest decision. APPROVED after an appeal counts too.
 */
export function wasAppealed(a: MeRebirthApplication): boolean {
  return APPEALED.has(a.status) || (a.appeal_statement ?? "") !== "" || !!a.first_decided_at;
}

/**
 * The flow of one application (handoff 2e/2f-五), from the only fields `/me/`
 * has: `created_at`, `decided_at`, `status`, `current_step`, `can_appeal`,
 * `appeal_statement`.
 *
 * Backend facts it leans on (`backend/apps/soul_accounts/rebirth.py`): an
 * appeal CLEARS `decided_at` and `rejection_reason` after copying them to
 * `first_decided_at` / `first_rejection_reason`; `decided_at` is set again when
 * the appeal is decided. Applications appealed before those two columns
 * existed have them empty: the first rejection then shows "unrecorded", never
 * another step's time. `cooldown_until` is only on the list endpoint, so the
 * design's "可再次提交" step is not drawn on the detail.
 */
export function buildFlow(a: MeRebirthApplication): FlowStep[] {
  const steps: FlowStep[] = [
    { key: "submitted", state: "done", name: { key: "soul_app.timeline.submitted" }, at: a.created_at },
  ];
  if (wasAppealed(a)) {
    steps.push({
      key: "first-decision",
      state: "done",
      name: { key: "soul_app.timeline.decided", status: "REJECTED" },
      ...(a.first_decided_at ? { at: a.first_decided_at } : { note: "soul_app.detail.not_recorded" }),
    });
    if (!a.current_step) steps.push({ key: "appealed", state: "done", name: { key: "soul_app.timeline.appealed" } });
  }
  if (a.decided_at) {
    steps.push({
      key: "decided",
      state: "done",
      name: { key: "soul_app.timeline.decided", status: a.status },
      at: a.decided_at,
    });
    if (a.can_appeal) {
      steps.push({ key: "appeal", state: "todo", name: { key: "soul_app.timeline.appealed" }, note: "soul_app.timeline.appeal_once" });
    }
    return steps;
  }
  if (a.current_step) {
    steps.push({
      key: "current",
      state: "now",
      name: { key: a.current_step.is_appeal ? "soul_app.timeline.appeal_review" : "soul_app.timeline.under_review" },
      role: a.current_step.approver_role,
      note: "soul_app.timeline.no_time",
      dashedAfter: true,
    });
    steps.push({ key: "decision", state: "todo", name: { key: "soul_app.timeline.decision" }, note: "soul_app.timeline.pending" });
  }
  return steps;
}
