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
 * WHY THE CLASSES ARE SPELLED `text-[oklch(var(--color-ink))]` AND NEVER
 * `text-ink`. tailwind.config.js declares no `status`/`ink` colour, so the
 * shorthand generates no CSS at all — `src/__tests__/cssTokenReferenceContract
 * .test.ts` exists because an undefined custom property drops the whole
 * declaration with no error in any channel.
 */
export type SoulState = SoulListItem["current_state"];

/**
 * Every state draws its own `--color-status-<state>` token as text + a 1 px
 * border, no fill (规范 v1 §2 徽章). The tokens resolve to the five semantic
 * colours (§1.2: 存活 success · 审判中 warning · 已处置 ink · 轮回中 accent ·
 * 迷失 ink-subtle), and every state also has a glyph below — colour is never the
 * only channel. `lib/chart-colors.ts` mirrors the same tokens for the charts.
 */
export const SOUL_STATE_BADGE_CLASSES: Record<SoulState, string> = {
  ALIVE: "text-[oklch(var(--color-status-alive))] border border-[oklch(var(--color-status-alive))]",
  JUDGING: "text-[oklch(var(--color-status-judging))] border border-[oklch(var(--color-status-judging))]",
  DISPOSED: "text-[oklch(var(--color-status-disposed))] border border-[oklch(var(--color-status-disposed))]",
  REINCARNATING: "text-[oklch(var(--color-status-reincarnating))] border border-[oklch(var(--color-status-reincarnating))]",
  LOST: "text-[oklch(var(--color-status-lost))] border border-[oklch(var(--color-status-lost))]",
  SETTLED: "text-[oklch(var(--color-status-settled))] border border-[oklch(var(--color-status-settled))]",
};

/**
 * 规范 v1 §1.2:领域状态 = 颜色 + 字形,不单靠颜色。已处置 ■(墨)与轮回中 ↻(强调)
 * 从此一眼可分;SETTLED(已结清)不在规范的五态里,用 □ 与「已处置」■ 成对。
 */
export const SOUL_STATE_GLYPH: Record<SoulState, string> = {
  ALIVE: "○",
  JUDGING: "◐",
  DISPOSED: "■",
  REINCARNATING: "↻",
  LOST: "×",
  SETTLED: "□",
};

/** The glyph for a state off the wire; an unknown state gets "?" rather than a guess. */
export function soulStateGlyph(state: string | null | undefined): string {
  return state && state in SOUL_STATE_GLYPH ? SOUL_STATE_GLYPH[state as SoulState] : "?";
}

/**
 * A state the payload carries but this table does not know. No colour claim.
 */
export const UNKNOWN_SOUL_STATE_BADGE_CLASS =
  "text-[oklch(var(--color-ink-muted))] border border-dashed border-[oklch(var(--color-line))]";

/** The badge classes for a state off the wire, which may be absent or unknown. */
export function soulStateBadgeClass(state: string | null | undefined): string {
  if (state !== null && state !== undefined && state in SOUL_STATE_BADGE_CLASSES) {
    return SOUL_STATE_BADGE_CLASSES[state as SoulState];
  }
  return UNKNOWN_SOUL_STATE_BADGE_CLASS;
}
