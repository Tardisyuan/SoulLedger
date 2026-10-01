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
 * 2026-10-01 规范 v3:框从 ink3(`--color-line-strong`)换成中性灰 `--color-line`(v3 的
 * `--ds-line`),方角不变(用户拍板:徽章不做胶囊)。意思由字形 + 文字承担,框只是轮廓。
 * 下面 v2 那段里「1px ink3 框」一句已被这一条取代,其余仍然成立。
 *
 * 规范 v2 补足 C15「状态徽章 · 领域枚举」:全部 1px ink3 框、ink 字,**不用状态色** ——
 * 靠字形和文字区分,颜色不参与(D1:轮回中只在图表里有颜色)。「还要处理」的一种
 * (审判中 = 规范的「待审」)加 s2 底。`--color-status-*` 仍在 globals.css 里,
 * 读者只剩图表(`lib/chart-colors.ts`)。
 */
const DOMAIN_BADGE = "text-[oklch(var(--color-ink))] border border-[oklch(var(--color-line))]";
/** 「还要处理」的领域值:待审、待定(判决)。 */
export const DOMAIN_BADGE_PENDING = `${DOMAIN_BADGE} bg-[oklch(var(--color-surface-2))]`;
export { DOMAIN_BADGE };

export const SOUL_STATE_BADGE_CLASSES: Record<SoulState, string> = {
  ALIVE: DOMAIN_BADGE,
  JUDGING: DOMAIN_BADGE_PENDING,
  DISPOSED: DOMAIN_BADGE,
  REINCARNATING: DOMAIN_BADGE,
  LOST: DOMAIN_BADGE,
  SETTLED: DOMAIN_BADGE,
};

/**
 * 字形按 C15 画:○ 在世、◇ 待审、▣ 受刑、↻ 轮回、◎ 永居(Design E 组改为 ≡)。真实枚举与样张的对应:
 * ALIVE ○、JUDGING ◇、DISPOSED ▣(已处置 = 在界域里受刑)、REINCARNATING ↻、
 * SETTLED ≡(已终结 = 永居;Design E 组:◎ 与迷失的 ◌ 同属圆形、小字号易混,≡ 像账簿结账划的线,与 App 一致)。LOST(迷失)样张没画,取 ◌ —— 旧的 × 与判决的 ✕
 * 在颜色撤掉之后几乎同形。◈ 待处置 Design 已从样张删掉(E 组),不新增这个状态。
 * ◇ 与判决「待定」共用:样张两处都画 ◇ + s2 底,意思都是「还要处理」。
 */
export const SOUL_STATE_GLYPH: Record<SoulState, string> = {
  ALIVE: "○",
  JUDGING: "◇",
  DISPOSED: "▣",
  REINCARNATING: "↻",
  LOST: "◌",
  SETTLED: "≡",
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
