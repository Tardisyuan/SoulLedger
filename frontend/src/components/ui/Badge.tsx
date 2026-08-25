"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The one badge.
 *
 * WHAT IT REPLACES. 66 badge-shaped spans across `app/`, `src/` and
 * `components/`, carrying 25 distinct class signatures. The largest cluster by
 * far is `px-2 py-0.5 rounded text-xs` with a `bg-<token>/0.1` fill and a
 * `text-<token>` foreground — which is, to within one `border`, exactly what
 * `components/ui/data-grid/columns.tsx:150` already froze as `EnumBadge`.
 *
 * `EnumBadge` is the interesting part of that sentence: it exists, it is
 * exported, its tone table is exported, it has a contract test
 * (`src/__tests__/dataGridToneContract.test.ts`) — and **no page imports it**.
 * It is reachable only through `renderGridCell`, so every screen that wants a
 * status pill outside a data grid hand-rolls one. That is why there are 25
 * signatures instead of 1: the shared thing was never callable from where the
 * badges are.
 *
 * TONES ARE NOT RE-DERIVED HERE. `BADGE_TONE_CLASSES` restates the five
 * `ENUM_TONE_CLASSES` entries verbatim rather than importing them, on purpose:
 * importing would put a runtime edge from `src/components/ui/` into
 * `components/ui/data-grid/`, and the whole point of the recommendation this
 * component carries — that `EnumBadge` should become a thin call to `Badge` —
 * is that the edge should run the other way. Two copies with no test is drift;
 * two copies with `src/__tests__/Badge.test.tsx` asserting them equal, key for
 * key and string for string, is a pin. The test imports both. If either moves,
 * it goes red.
 *
 * The 10% fill is a measurement, not a taste. columns.tsx records that a 16%
 * tint of the error token drops light-mode badge text to 4.37:1, under the
 * 4.5:1 AA floor; 10% keeps it over. Do not raise it.
 *
 * WHY `pill` IS A VARIANT AND NOT THE DEFAULT. `borderRadius` is 0 everywhere
 * now except `rounded-full`, and a survey of the 66 finds exactly **3** genuine
 * pills. Square is the house shape; `pill` exists because a rounded badge does
 * carry a real meaning here — it reads as an identity token (a person, a
 * civilization, a tag) rather than a state — and three call sites were using it
 * for that. Reaching for `pill` because it looks softer is the misuse.
 */

/** Verbatim twin of `ENUM_TONE_CLASSES`; equality is held by Badge.test.tsx. */
export const BADGE_TONE_CLASSES = {
  neutral:
    "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] border-[hsl(var(--color-hairline-tertiary))]",
  success:
    "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))] border-[hsl(var(--color-status-success)/0.3)]",
  warning:
    "bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))] border-[hsl(var(--color-status-warning)/0.3)]",
  error:
    "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))] border-[hsl(var(--color-status-error)/0.3)]",
  info: "bg-[hsl(var(--color-status-info)/0.1)] text-[hsl(var(--color-status-info))] border-[hsl(var(--color-status-info)/0.3)]",
  /**
   * Sixth tone, with no counterpart in `ENUM_TONE_CLASSES` — the data grid has
   * no use for it, but 4 of the 66 badges do: the "current tenant" / "this one"
   * marker written by hand as `bg-[hsl(var(--color-accent))]/20
   * text-[hsl(var(--color-accent-ink))]`.
   *
   * Note the foreground is `--color-accent-ink`, NOT `--color-accent`. They are
   * the same value in dark mode and deliberately different in light
   * (`32 92% 34%` vs `38 92% 50%`) precisely because accent-on-surface text
   * fails AA in light mode at the accent's own lightness. A badge is text.
   */
  accent:
    "bg-[hsl(var(--color-accent)/0.2)] text-[hsl(var(--color-accent-ink))] border-[hsl(var(--color-accent)/0.4)]",
} as const;

export type BadgeTone = keyof typeof BADGE_TONE_CLASSES;

export const BADGE_TONES = Object.keys(BADGE_TONE_CLASSES) as BadgeTone[];

const badge = cva(
  [
    // `inline-flex` + `gap-1` so a leading glyph needs no wrapper. `align-middle`
    // keeps it off the baseline when it sits inside a run of text.
    "inline-flex items-center gap-1 align-middle",
    // Same geometry as EnumBadge, so swapping one for the other is not a
    // visual diff: 8px/2px padding, 12px type, medium weight, hairline border.
    // `text-02` IS 12px — it is the eight-step scale's slot for IDs and meta,
    // which is what a badge is — but it also brings 0.04em tracking, which a
    // bare `text-xs` did not, and short uppercase-ish labels need it.
    "px-2 py-0.5 text-02 font-medium border",
    // A badge is a label, not a paragraph. Wrapping one mid-word inside a table
    // cell is how the 66 hand-rolled ones each discovered `whitespace-nowrap`
    // separately.
    "whitespace-nowrap",
  ],
  {
    variants: {
      tone: BADGE_TONE_CLASSES,
      shape: {
        // No class: `borderRadius.DEFAULT` is 0, so `rounded` would emit
        // `border-radius: 0` and read as a decision that had been made when it
        // had not. Square is the absence of a corner instruction.
        square: "",
        pill: "rounded-full",
      },
    },
    defaultVariants: { tone: "neutral", shape: "square" },
  }
);

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof badge> {
  /**
   * Decorative leading mark (◆ ◑ ■ ↻ ✕ …). Rendered `aria-hidden` — the label
   * beside it is the content, and a screen reader reading "black diamond
   * ALIVE" is worse than reading "ALIVE".
   */
  glyph?: React.ReactNode;
}

export function Badge({ tone, shape, glyph, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn(badge({ tone, shape }), className)} {...rest}>
      {glyph ? <span aria-hidden="true">{glyph}</span> : null}
      {children}
    </span>
  );
}

export { badge as badgeVariants };
