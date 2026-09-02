"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * The one busy indicator.
 *
 * WHY THIS EXISTS. There are 21 `app/**&#47;loading.tsx` files and 20 of them are
 * the same six lines of copy-paste: a `relative w-16 h-16` box holding two
 * absolutely-positioned rings, the back one at 20% and the front one a
 * transparent ring with a single coloured top edge, spun by `animate-spin`.
 * Copy-paste is not the problem on its own — the drift is. Fifteen of those
 * twenty hardcode `border-amber-500/20` and `border-t-amber-500`; the other
 * five write `border-[hsl(var(--color-accent))]/20` and
 * `border-t-[hsl(var(--color-accent))]`. Those two spellings were NOT the same
 * colour until very recently: `tailwind.config.js` used to override the `amber`
 * scale one step brighter than Tailwind's own, so `amber-500` was #fbbf24 while
 * `--color-accent` is #f59e0b. The override is gone now and the two agree, but
 * agreeing by coincidence is not the same as being one value. A palette literal
 * cannot follow a token: `--color-accent` is user-configurable at runtime (see
 * its comment in `app/globals.css` `:root`), and the fifteen `amber-500`
 * spinners would keep spinning amber after the user picked another accent.
 *
 * So: token, never palette. This component is the only place the ring colour is
 * written down.
 *
 * ACCESSIBILITY. A spinner is either an announcement or a decoration, and it
 * has to say which. Pass `label` and it becomes `role="status"` with visually
 * hidden text, so a screen reader says something instead of nothing while the
 * route streams in. Omit `label` — the right call inside a `<Button loading>`,
 * where the button's own text is already the announcement — and it is
 * `aria-hidden`, contributing no duplicate chatter.
 *
 * MOTION. `motion-reduce:animate-none` is not decoration-trimming; a
 * continuously rotating element is exactly what `prefers-reduced-motion`
 * exists to stop. The ring stays visible, it just stops turning.
 */

const spinner = cva(
  // `shrink-0` because a spinner beside flexed text is the first thing a
  // narrow container squashes into an ellipse.
  "relative shrink-0",
  {
    variants: {
      size: {
        // 16px — inline, sits on a line of text-03/text-04 without lifting it.
        sm: "w-4 h-4",
        // 24px — beside a heading, or in a panel that is loading in place.
        md: "w-6 h-6",
        // 64px — the full-route spinner. Same 16/4 geometry the 20 copies use,
        // so this is a like-for-like replacement rather than a redesign.
        lg: "w-16 h-16",
      },
    },
    defaultVariants: { size: "md" },
  }
);

/** Ring thickness tracks the diameter; 4px on a 16px box would be a donut. */
const RING_WIDTH: Record<NonNullable<SpinnerProps["size"]>, string> = {
  sm: "border-2",
  md: "border-2",
  lg: "border-4",
};

export interface SpinnerProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    VariantProps<typeof spinner> {
  /**
   * Announced text. Present → `role="status"` + a visually hidden label.
   * Absent → `aria-hidden`, for when the surrounding control already says it.
   */
  label?: string;
}

export function Spinner({ size = "md", label, className, ...rest }: SpinnerProps) {
  const ring = RING_WIDTH[size ?? "md"];
  return (
    <span
      // `role="status"` carries an implicit aria-live="polite"; without a label
      // there is nothing to announce, so the whole thing is hidden instead of
      // being an empty live region that some readers still ping.
      {...(label ? { role: "status" } : { "aria-hidden": true })}
      className={cn(spinner({ size }), className)}
      {...rest}
    >
      {/* Track. The 20% tint reads as a groove rather than a second ring. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full border-[hsl(var(--color-accent)/0.2)]",
          ring
        )}
      />
      {/* Head. One lit edge on an otherwise transparent ring is what makes the
          rotation legible — a fully coloured ring spinning looks static. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full border-transparent border-t-[hsl(var(--color-accent))] animate-spin motion-reduce:animate-none",
          ring
        )}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/**
 * The whole-route busy screen — the shape all 32 `loading.tsx` files actually
 * want. Kept here rather than in each route so the centring, the canvas fill
 * and the spinner size are decided once.
 *
 * THE LABEL IS NOT OPTIONAL HERE, and that is the difference between this and
 * `Spinner`. An unlabelled `Spinner` is the right call inside `<Button
 * loading>`, where the button's own text already says what is happening. A
 * whole route replaced by a spinner has no such neighbour: there is nothing
 * else on the screen. 32 files import this and exactly one of them was passing
 * `label`, so 31 routes were replacing their entire contents with silence.
 *
 * Fixing that per-route would have meant 31 edits plus a convention every
 * future `loading.tsx` has to remember — and the failure mode of a forgotten
 * convention is silence, which is not a state a test run reports. So the
 * default lives here, once. The `label` prop stays, as the override for a
 * route that can say something more specific than "loading" (see
 * `app/judgment/[id]/page.tsx`, which passes `judgment.detail.loading`).
 *
 * The i18n cost is nil: every one of those 32 `loading.tsx` files is already
 * `"use client"`, so no client boundary moves, and `I18nProvider` sits in
 * `app/layout.tsx` above every route's loading slot.
 */
export function PageSpinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    // `min-h-[calc(100vh-4rem)]`, matching AppLayout.tsx:418's slot exactly —
    // NOT `min-h-screen`. A route's `loading.tsx` renders inside that slot, so
    // a full 100vh here is 100vh nested in 100vh−4rem: the same 64px of dead
    // scroll PageShell exists to delete, handed back through the component all
    // 21 loading files adopt. One class in one file, 21 routes.
    //
    // The two routes outside AppLayout (`/` and `(auth)/login` — see
    // AppLayoutWrapper's PUBLIC_PATHS) get a busy screen 64px shorter than the
    // viewport. For a centred spinner that is invisible, and it is the right
    // trade: being 64px short on two routes costs nothing, while being 64px
    // long on nineteen costs a scrollbar on every one of them.
    <div className="min-h-[calc(100vh-4rem)] bg-[hsl(var(--color-canvas))] flex items-center justify-center">
      <Spinner size="lg" label={label ?? t("common.loading")} />
    </div>
  );
}
