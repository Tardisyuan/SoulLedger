import type { SoulListItem } from "@soulledger/core/api";

/**
 * The badge fill/ink for a soul's lifecycle state — one table, for every screen
 * that draws that badge.
 *
 * WHY IT IS A FILE. `app/souls/page.tsx` and `app/souls/[id]/page.tsx` each
 * declared their own `STATE_COLORS`, byte-identical: `diff` of the two ranges
 * exited 0. Six lines saved is not the argument. The argument is that a copy
 * cannot be read against itself — DISPOSED and LOST held the *same* class
 * string in both copies, two of six states rendering identically, and neither
 * file gave anyone a reason to notice. Written once, the collapse is on one
 * screen.
 *
 * `app/ledger/page.tsx::STATE_DOT` had the same defect and was fixed there; the
 * note above it records DISPOSED wearing LOST's token while LOST had no entry
 * at all. That fix reached the dot and reached neither `STATE_COLORS`. This is
 * the table it should have reached.
 *
 * WHY IT LIVES IN `frontend` AND NOT `packages/core`. The keys are domain
 * knowledge; the values are Tailwind arbitrary-value class strings, which a
 * React Native host cannot use. The key set is tied to the package instead —
 * `SoulState` below is the API's own union, so a seventh state added to the
 * contract is a type error here rather than a state that silently falls to the
 * unknown-state fill.
 *
 * WHY THE CLASSES ARE SPELLED `text-[hsl(var(--color-ink))]` AND NEVER
 * `text-ink`. tailwind.config.js declares no `status`/`ink` colour, so the
 * shorthand generates no CSS at all — `src/__tests__/cssTokenReferenceContract
 * .test.ts` exists because an undefined custom property drops the whole
 * declaration with no error in any channel.
 */
export type SoulState = SoulListItem["current_state"];

/**
 * Every state carries its own `--color-status-<state>` token, tinted to 10% for
 * the fill and full strength for the ink — the same depth `EnumBadge` uses and
 * `dataGridToneContract` caps, and the same six tokens `lib/chart-colors.ts`
 * mirrors for the charts (pinned by `civilizationColourContract`). Badge and
 * chart legend therefore draw from one palette rather than two that happen to
 * agree today.
 *
 * DISPOSED AND LOST WERE NOT ALWAYS HERE. Both held
 * `bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]` — the
 * unknown-state fill below — so 已处置 and 迷失 were indistinguishable from each
 * other and from a state the UI does not recognise, while
 * `--color-status-disposed` (285 55% 66% dark / 285 52% 44% light) and
 * `--color-status-lost` (225 10% 58% / 225 10% 42%) sat declared and unused by
 * either page. Measured on the 10% tint over `--color-surface-1`: disposed
 * 5.58:1 dark / 5.30:1 light, lost 5.21:1 / 4.79:1 — both clear of the 4.5:1 AA
 * floor, and lost is at the same light-mode ratio ALIVE already ships at.
 */
export const SOUL_STATE_BADGE_CLASSES: Record<SoulState, string> = {
  ALIVE: "bg-[hsl(var(--color-status-alive)/0.1)] text-[hsl(var(--color-status-alive))]",
  JUDGING: "bg-[hsl(var(--color-status-judging)/0.1)] text-[hsl(var(--color-status-judging))]",
  DISPOSED: "bg-[hsl(var(--color-status-disposed)/0.1)] text-[hsl(var(--color-status-disposed))]",
  REINCARNATING: "bg-[hsl(var(--color-status-reincarnating)/0.1)] text-[hsl(var(--color-status-reincarnating))]",
  LOST: "bg-[hsl(var(--color-status-lost)/0.1)] text-[hsl(var(--color-status-lost))]",
  SETTLED: "bg-[hsl(var(--color-status-settled)/0.1)] text-[hsl(var(--color-status-settled))]",
};

/**
 * A state this build has no colour for — a value the API grew and the UI has
 * not caught up with, or no state at all because the record failed to load.
 *
 * Deliberately NOT one of the six. Painting an unknown state in a lifecycle
 * colour is a claim about which state it is; surface-3 with muted ink says
 * "this badge has no colour to give you", which is the true statement. The
 * detail page used to fall back to `"ALIVE"` here, so a soul that failed to
 * load wore the green of a living one beside the words 「未记录」.
 */
export const UNKNOWN_SOUL_STATE_BADGE_CLASS =
  "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]";

/** The badge classes for a state off the wire, which may be absent or unknown. */
export function soulStateBadgeClass(state: string | null | undefined): string {
  if (state !== null && state !== undefined && state in SOUL_STATE_BADGE_CLASSES) {
    return SOUL_STATE_BADGE_CLASSES[state as SoulState];
  }
  return UNKNOWN_SOUL_STATE_BADGE_CLASS;
}
