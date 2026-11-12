import type { Judgment } from "@soulledger/core/api";
import { DOMAIN_BADGE, DOMAIN_BADGE_PENDING, UNKNOWN_SOUL_STATE_BADGE_CLASS } from "@/src/lib/soulStateBadge";

export type Verdict = NonNullable<Judgment["verdict"]>;

/**
 * 规范 v1 §1.2 对判决的同一条要求:颜色之外必有字形。一张表,灵魂详情页的
 * 「丙 · 审判」是第一个读者。`Record<Verdict, …>` 让 API 多出第五种判决时在这里
 * 编译不过,而不是悄悄落到「?」。
 *
 * 字形与 `SOUL_STATE_GLYPH` 不共用(soulStateBadgeContract.test.ts 守着)。第三十批起「待定」是 ‖(Design v4
 * 第三十批第一节第 2 条:‖ 待定、◇ 审判中、↺ 退回重审),此前与「审判中」共用 ◇。
 */
export const VERDICT_GLYPH: Record<Verdict, string> = {
  PASSED: "✓",
  FAILED: "✕",
  PURGATORY: "‖",
  RETRY: "↺",
};

/**
 * 判决标签(第三十批淡染):中性;「退回重审」是 warn 淡染(案子回到审判里继续走)。「待定」‖ 是中性 ——
 * 样张里待定与他人认领同为中性。「不过」的 ✕ 不是罪业红 —— 那一色只给罪业与超期。
 */
export const VERDICT_BADGE_CLASSES: Record<Verdict, string> = {
  PASSED: DOMAIN_BADGE,
  FAILED: DOMAIN_BADGE,
  PURGATORY: DOMAIN_BADGE,
  RETRY: DOMAIN_BADGE_PENDING,
};

export function verdictGlyph(verdict: string | null | undefined): string {
  return verdict && verdict in VERDICT_GLYPH ? VERDICT_GLYPH[verdict as Verdict] : "?";
}

export function verdictBadgeClass(verdict: string | null | undefined): string {
  return verdict && verdict in VERDICT_BADGE_CLASSES
    ? VERDICT_BADGE_CLASSES[verdict as Verdict]
    : UNKNOWN_SOUL_STATE_BADGE_CLASS;
}
