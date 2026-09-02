"use client";

import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

/**
 * The one button.
 *
 * WHAT IT REPLACES. A scan of `app/`, `src/` and `components/` finds 190
 * `<button>` elements carrying 141 mutually distinct `className` strings: 43
 * spellings of the primary button, 39 of the secondary, 29 ghost, 15 danger, 7
 * tab. Four different corner radii and **eighteen** different padding pairs
 * (`px-4 py-2` 75×, `px-3 py-1.5` 21×, `px-2 py-1` 14×, then a long tail). The
 * primary button's foreground is `text-black` in 47 places and `text-white` in
 * 16 — the same button, two answers, and one of them fails contrast (numbers
 * below).
 *
 * The interaction states are worse than the cosmetics, because they are absent
 * rather than inconsistent: `active:` appears on **0 of 190** buttons, so
 * nothing in this application acknowledges a press; `disabled:` on 29%; and 14
 * buttons have no `hover:` at all. Every variant here therefore carries all
 * three, and `src/__tests__/Button.test.tsx` holds them to 100% coverage rather
 * than to "most".
 *
 * ── PRIMARY FOREGROUND: black, and here is the arithmetic ──────────────────
 *
 * `--color-accent` is `hsl(38 92% 50%)`, identical in both themes.
 *
 *   HSL → sRGB.  L=0.50, S=0.92 → C = (1−|2·0.5−1|)·0.92 = 0.92
 *                H′ = 38/60 = 0.6333 → X = C·(1−|H′ mod 2 − 1|) = 0.92·0.6333
 *                                        = 0.58267
 *                m  = L − C/2 = 0.04
 *                (R,G,B) = (C+m, X+m, 0+m) = (0.9600, 0.62267, 0.0400)
 *                        = #F59F0A ≈ #f59e0b  ✓ matches the documented hex
 *
 *   Linearise (WCAG 2.x: c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4)
 *                R → 0.911408   G → 0.345655   B → 0.003091
 *
 *   Relative luminance  L = 0.2126·R + 0.7152·G + 0.0722·B
 *                         = 0.193765 + 0.247211 + 0.000223
 *                         = 0.441199
 *
 *   Contrast vs black (L=0.0):  (0.441199 + 0.05) / (0.0 + 0.05) =  9.82 : 1
 *   Contrast vs white (L=1.0):  (1.0 + 0.05) / (0.441199 + 0.05) =  2.14 : 1
 *
 * AA for normal text is 4.5:1. Black passes with room to spare (it clears AAA's
 * 7:1); white fails AA at any text size — it does not even reach the 3:1 floor
 * for large text or UI components. So the 16 `text-white` primaries are not a
 * style preference, they are a defect, and the 47 `text-black` ones are right.
 * **Primary is `text-black`.**
 *
 * It has to be the literal, not a token. `text-canvas` and `text-ink` both
 * invert with the theme — in light mode `--color-canvas` is `0 0% 100%`, which
 * lands us back on the failing 2.14:1. Since `--color-accent` is the *same*
 * value in both themes, its readable foreground is also the same value in both
 * themes, and writing it as a theme-varying token would be actively wrong.
 *
 * Hover moves the fill to `--color-accent-hover` = `hsl(43 96% 58%)`, which is
 * lighter still (L = 0.586466 → 12.73:1 against black), so the press stays
 * legible throughout the interaction.
 *
 * ── DANGER: tinted, not filled ─────────────────────────────────────────────
 *
 * The 15 danger buttons mostly do `bg-[hsl(var(--color-status-error))]` with
 * `text-white`. That is theme-dependent in the bad direction:
 *
 *   dark   `--color-status-error: 0 84% 62%` → L = 0.242337 → white 3.59 : 1  ✗
 *   light  `--color-status-error: 0 78% 44%` → L = 0.129947 → white 5.84 : 1  ✓
 *
 * A destructive control that fails AA in the default theme is the last control
 * you want unreadable. So danger uses the 10%-tint recipe that
 * `components/ui/data-grid/columns.tsx` already measured for badges — fill at
 * 10% of the error token, text at the full token, hairline at 30%:
 *
 *   dark   error text on 10% error over surface-1 → 0.292337/0.061425 = 4.76:1 ✓
 *   light  error text on 10% error over surface-1 → 0.849793/0.179947 = 4.72:1 ✓
 *
 * Both clear AA, in both themes, and it stays a token so a re-measured error
 * hue carries through. (10%, not 16% — columns.tsx records that a 16% tint
 * drops the light-mode reading to 4.37:1.)
 *
 * ── FOCUS: deliberately not here ───────────────────────────────────────────
 *
 * There is no `focus:ring-3` in this file and there must not be one.
 * `app/globals.css:459` declares a single `:focus-visible { outline: 2px solid
 * hsl(var(--color-focus)) !important }`, and the `!important` is load-bearing —
 * it is what beats the 69 `outline-hidden` utilities scattered across the app.
 * `src/__tests__/statusTokenLayering.test.ts` pins that rule's existence, its
 * `!important`, and its token. The only thing a component has to do to
 * participate is **not write `outline-hidden`**, which this one does not.
 *
 * Note also what the ring must NOT be: `--color-focus` is not `--color-accent`,
 * because the accent is user-configurable and a focus ring the user can tune to
 * invisibility is not a focus ring. `app/permissions/page.tsx:178` is the one
 * place in the repo that writes `focus-visible:ring-[hsl(var(--color-accent))]`
 * — the exact thing the token's own comment forbids. It is not a model.
 *
 * ── PADDING: eighteen pairs down to three ──────────────────────────────────
 *
 * Every value is on the 4/8/12/16 grid, and the ladder is monotone in both
 * axes so the three sizes cannot read as three unrelated buttons:
 *
 *   sm  px-2 py-1   →  8 / 4     lg  px-4 py-3   → 16 / 12
 *   md  px-3 py-2   → 12 / 8
 *
 * `px-4 py-2` (the 75× incumbent) is 16/8, which is off this ladder in the
 * horizontal — md is deliberately one step tighter, because 18 spellings became
 * 3 by picking a grid, not by picking the most popular row.
 */

const button = cva(
  [
    // Layout. `gap-2` is what the ad-hoc `flex items-center gap-2` buttons
    // reach for when they hold an icon; folding it into the base means an icon
    // child needs no wrapper class of its own.
    "inline-flex items-center justify-center gap-2",
    "font-medium whitespace-nowrap select-none",
    // Square corners: `borderRadius` is 0 across the board now (see
    // tailwind.config.js), so `rounded` would be a no-op and is omitted rather
    // than written as decoration.
    "border",
    // `transition-colors` alone would leave the press-shift un-eased.
    "transition-[color,background-color,border-color,transform] duration-150",
    // The pressed nudge, shared by all four variants so "pressed" is one
    // gesture in this UI rather than four. Suppressed under reduced-motion:
    // a 1px translate is small but it is still unrequested movement.
    "active:translate-y-px motion-reduce:active:translate-y-0",
    // DISABLED, on every variant, no exceptions.
    //
    // `pointer-events-none` and not `cursor-not-allowed`: they are mutually
    // exclusive and only one of them is honest. With pointer events off the
    // cursor never changes, so `disabled:cursor-not-allowed` would render
    // nothing at all — a class that produces no style is the same species of
    // defect as the malformed `placeholder:[hsl(...)]` in
    // src/components/workflow/WorkflowEditor.tsx:488. What we get instead is
    // the guarantee that matters: hover and active are genuinely dead on a
    // disabled control, rather than dead-by-cascade-order and quietly alive if
    // Tailwind's variant order ever shifts.
    "disabled:opacity-50 disabled:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        /**
         * One call to action per view. Fill = accent, text = black (9.82:1),
         * hover lightens to accent-hover, press returns to the base fill — so
         * the press *darkens* relative to hover, which is the conventional
         * direction, without inventing a token that does not exist.
         */
        primary: [
          "bg-accent text-black border-accent",
          "hover:bg-accent-hover hover:border-accent-hover",
          "active:bg-accent active:border-accent",
        ],
        /**
         * The default button. Surface ramp 2 → 3 → 4 across rest → hover →
         * press; ink text on a hairline border.
         */
        secondary: [
          "bg-surface-2 text-ink border-hairline",
          "hover:bg-surface-3 hover:border-hairline-strong",
          "active:bg-surface-4",
        ],
        /**
         * No chrome at rest — toolbars, table row actions, anywhere a border
         * per control would out-weigh the content. Gains a surface on hover so
         * the hit area is discoverable, and its border stays transparent
         * rather than absent so it does not resize when it lights up.
         */
        ghost: [
          "bg-transparent text-ink-muted border-transparent",
          "hover:bg-surface-2 hover:text-ink",
          "active:bg-surface-3",
        ],
        /**
         * Destructive. Tinted, not filled — see the contrast note above.
         */
        danger: [
          "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))] border-[hsl(var(--color-status-error)/0.3)]",
          "hover:bg-[hsl(var(--color-status-error)/0.2)] hover:border-[hsl(var(--color-status-error)/0.5)]",
          "active:bg-[hsl(var(--color-status-error)/0.3)]",
        ],
        /**
         * Caution without destruction — a state transition that is hard to
         * take back but does not delete anything. Same 10%-tint recipe as
         * danger, on `--color-status-warning`, measured the same way and
         * across all four civilization hues (the ramp is tenant-tinted, so the
         * worst pairing is not the one a single spot check finds):
         *
         *   dark   warning text on 10% warning over surface-1 → 8.25:1  ✓
         *   light  warning text on 10% warning over surface-1 → 4.71:1  ✓
         *
         * It exists because `ConfirmDialog` had three hand-rolled variants —
         * `bg-red-500` / `bg-yellow-500` / `bg-blue-500`, all with
         * `text-white`. `bg-yellow-500` with white text is roughly 1.9:1: the
         * least readable control in the app sat on the confirm step of a soul
         * state transition. Only `danger` and `warning` were ever used.
         */
        warning: [
          "bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))] border-[hsl(var(--color-status-warning)/0.3)]",
          "hover:bg-[hsl(var(--color-status-warning)/0.2)] hover:border-[hsl(var(--color-status-warning)/0.5)]",
          "active:bg-[hsl(var(--color-status-warning)/0.3)]",
        ],
      },
      size: {
        sm: "px-2 py-1 text-02",
        md: "px-3 py-2 text-03",
        lg: "px-4 py-3 text-04",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export type ButtonVariant = NonNullable<VariantProps<typeof button>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof button>["size"]>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /**
   * Busy. Disables the control and swaps in a `<Spinner size="sm">` ahead of
   * the label, so the label stays readable and the button does not resize.
   * The spinner is unlabelled on purpose — the button's own text is already
   * the accessible name, and `aria-busy` carries the state.
   */
  loading?: boolean;
}

/**
 * `type` is deliberately NOT defaulted to "button". The 190 call sites this
 * will eventually replace include real submit buttons that rely on the native
 * default, and silently changing it during migration would break forms with no
 * type error and no failing test — the exact shape of bug this whole pass is
 * trying to remove. Callers say what they mean.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading = false, disabled, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(button({ variant, size }), className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
});

/** Exported so the contract test can enumerate variants without restating them. */
export const BUTTON_VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "warning"];
export const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
export { button as buttonVariants };
