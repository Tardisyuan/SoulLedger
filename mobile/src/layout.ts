/**
 * The presentation rules `ui.tsx` itself needs: the layout thresholds (width, text scale) and the
 * badge shape. Out of `rules.ts` (cq-apps 2026-10-30 #2b) so the officer app, which shares
 * `ui.tsx`, does not bundle the soul app's rules; `rules.ts` re-exports all of it. A leaf: it
 * imports nothing from the app. Tests stay in `__tests__/rules.test.ts`.
 */

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

// ── long text ──────────────────────────────────────────────────────────

/** A data-row label longer than this puts label and value on two lines (handoff 1g, rule 一). */
export const LABEL_STACK_THRESHOLD = 18;

export function stacksLabel(label: string): boolean {
  return [...label].length > LABEL_STACK_THRESHOLD;
}

// ── layout ─────────────────────────────────────────────────────────────

export const COMPACT_WIDTH = 340;
export const GROW_FONT_SCALE = 1.3;
/** 第二十八批 S4: above 1.5× a list row's "text left, time right" becomes two lines. */
export const TWO_LINE_FONT_SCALE = 1.5;
export const STACK_FONT_SCALE = 1.7;

export interface Layout {
  /** ≤ 340pt wide: gutter 16, data rows stacked, display one step down. */
  compact: boolean;
  /** ≥ 1.3× text: badges wrap, heights are minimums. */
  grow: boolean;
  /** ≥ 1.5× text: "text left, time / value right" rows put the time on its own line, below the text. */
  twoLine: boolean;
  /** ≥ 1.7× text: tab bar, scores, password reveal and languages go vertical; the flow drops its rail. */
  stack: boolean;
  gutter: number;
}

/** Handoff 2f-四 (and S4's 1.5×): the thresholds, one decision. */
export function layoutFor(width: number, fontScale: number): Layout {
  const compact = width <= COMPACT_WIDTH;
  return {
    compact,
    grow: fontScale >= GROW_FONT_SCALE,
    twoLine: fontScale >= TWO_LINE_FONT_SCALE,
    stack: fontScale >= STACK_FONT_SCALE,
    gutter: compact ? 16 : 20,
  };
}
