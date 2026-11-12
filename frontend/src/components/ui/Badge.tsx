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
 * THIS IS NOW THE ONLY TONE TABLE. It was written restating the five
 * `ENUM_TONE_CLASSES` entries verbatim rather than importing them, so that the
 * dependency edge could later be added in the other direction without a cycle
 * — and it has been: `components/ui/data-grid/columns.tsx` imports
 * `BADGE_TONE_CLASSES` from here and `ENUM_TONE_CLASSES` is a five-key
 * projection of it, while `EnumBadge` is a thin call to `Badge`. Nothing
 * imports the other way, so there is no cycle.
 *
 * The interim pin — `src/__tests__/Badge.test.tsx` asserting the two tables
 * equal key for key — was retired with the copy it guarded, because a derived
 * table compared against its own source is an assertion nothing can falsify.
 * What replaced it is a render-path comparison: an enum cell built through
 * `renderGridCell` must produce the same class list as `<Badge tone=…>`, for
 * every tone the grid uses. Hand-rolling a class string back into `EnumBadge`
 * turns that red; re-deriving `ENUM_TONE_CLASSES` from itself could not.
 *
 * The fill is a declared tint token, never an alpha of the text colour: columns.tsx
 * records that a 16% alpha tint of the error token dropped light-mode badge text to
 * 4.37:1. The tint tokens are measured against their own text in inkOnSurfaceContract.
 *
 * NO PILL SHAPE. There was a rounded `pill` variant for "identity" badges; it stays
 * gone. 第三十批 gives every tag the 4 px control corner, not a pill.
 */

/**
 * The app's one badge tone table. `ENUM_TONE_CLASSES` is a view onto it.
 *
 * 第三十批「卷宗」第 1 步(Design v4 第三十批回复第一节第 2 条):状态标签是**淡染**——色调底、无边框、圆角 4,
 * 高 22(精确指针)/ 28(触屏,`--tag-h`)。只有四种色:中性(surface-2 底 + ink-muted 字,即 v4 的
 * card2 + sub)与 pos / neg / warn 三种淡染(success / danger / warning 配各自的 tint)。四对都由
 * inkOnSurfaceContract 量过(tint 配本色 ≥ 4.5;ink-muted 在 surface-2 上 ≥ 4.5)。文明色不进标签
 * (Design 第五节第 2 条:文明色只在顶线、印、脊、焦点四处),所以 `info` / `accent` 与 `ink` 都落到中性。
 * 颜色从来不是唯一的区分:每个标签带一个形状前缀(`glyph`)。
 *
 * (规范 v1 §2「徽章 · 只有常态」的无底 + 同色 1px 框,v3 的中性灰框,随这一条撤掉。)
 */
const NEUTRAL_TAG = "bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink-muted))]";
export const BADGE_TONE_CLASSES = {
  neutral: NEUTRAL_TAG,
  /** 已处置 ▣ 一类:v3 时是 ink 字;四色之外不再有第五种,落到中性。 */
  ink: NEUTRAL_TAG,
  success: "bg-[oklch(var(--color-success-tint))] text-[oklch(var(--color-success))]",
  warning: "bg-[oklch(var(--color-warning-tint))] text-[oklch(var(--color-warning))]",
  error: "bg-[oklch(var(--color-danger-tint))] text-[oklch(var(--color-danger))]",
  info: NEUTRAL_TAG,
  accent: NEUTRAL_TAG,
} as const;

export type BadgeTone = keyof typeof BADGE_TONE_CLASSES;

export const BADGE_TONES = Object.keys(BADGE_TONE_CLASSES) as BadgeTone[];

const badge = cva(
  [
    // `inline-flex` + `gap-1` so a leading glyph needs no wrapper. `align-middle`
    // keeps it off the baseline when it sits inside a run of text.
    "inline-flex items-center gap-1 align-middle",
    // 第三十批:高 `--tag-h`(22 / 28)、左右 8、圆角 4(`rounded-control`)、无边框;字 sans 12 / 500,
    // 触屏 13。Changing the geometry here changes every table row in the app, which is why
    // eslint.config.mjs exempts it by class name rather than by budget.
    "h-(--tag-h) px-2 rounded-control text-xs font-medium pointer-coarse:text-sm",
    // A badge is a label, not a paragraph. Wrapping one mid-word inside a table
    // cell is how the 66 hand-rolled ones each discovered `whitespace-nowrap`
    // separately.
    "whitespace-nowrap",
  ],
  {
    variants: {
      tone: BADGE_TONE_CLASSES,
      shape: {
        // One shape: the tag's 4 px corner is in the base list above. Kept as a one-member
        // variant so call sites keep compiling.
        square: "",
      },
    },
    defaultVariants: { tone: "neutral", shape: "square" },
  }
);

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof badge> {
  /**
   * Decorative leading mark (◇ ↺ ! ‖ ◌ ▣ ↻ ✓ − + …). Rendered `aria-hidden` — the label
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
