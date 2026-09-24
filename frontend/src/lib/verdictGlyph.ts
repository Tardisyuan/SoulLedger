import type { Judgment } from "@soulledger/core/api";

export type Verdict = NonNullable<Judgment["verdict"]>;

/**
 * 规范 v1 §1.2 对判决的同一条要求:颜色之外必有字形。一张表,灵魂详情页的
 * 「丙 · 审判」是第一个读者。`Record<Verdict, …>` 让 API 多出第五种判决时在这里
 * 编译不过,而不是悄悄落到「?」。
 *
 * 字形与 `SOUL_STATE_GLYPH`(○ ◐ ■ ↻ × □)不相交 —— 两者画在同一页上,
 * soulStateBadgeContract.test.ts 守着这一点。
 */
export const VERDICT_GLYPH: Record<Verdict, string> = {
  PASSED: "✓",
  FAILED: "✕",
  PURGATORY: "◇",
  RETRY: "↺",
};

/** 判决的字色。与字形同表,理由同 `SOUL_STATE_BADGE_CLASSES`:两份拷贝无法互相比对。 */
export const VERDICT_INK: Record<Verdict, string> = {
  PASSED: "text-[oklch(var(--color-success))]",
  FAILED: "text-[oklch(var(--color-danger))]",
  PURGATORY: "text-[oklch(var(--color-warning))]",
  RETRY: "text-[oklch(var(--color-accent))]",
};

export function verdictGlyph(verdict: string | null | undefined): string {
  return verdict && verdict in VERDICT_GLYPH ? VERDICT_GLYPH[verdict as Verdict] : "?";
}

export function verdictInk(verdict: string | null | undefined): string {
  return verdict && verdict in VERDICT_INK
    ? VERDICT_INK[verdict as Verdict]
    : "text-[oklch(var(--color-ink-muted))]";
}
