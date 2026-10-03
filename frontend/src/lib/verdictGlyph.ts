import type { Judgment } from "@soulledger/core/api";
import { DOMAIN_BADGE, DOMAIN_BADGE_PENDING, UNKNOWN_SOUL_STATE_BADGE_CLASS } from "@/src/lib/soulStateBadge";

export type Verdict = NonNullable<Judgment["verdict"]>;

/**
 * 规范 v1 §1.2 对判决的同一条要求:颜色之外必有字形。一张表,灵魂详情页的
 * 「丙 · 审判」是第一个读者。`Record<Verdict, …>` 让 API 多出第五种判决时在这里
 * 编译不过,而不是悄悄落到「?」。
 *
 * 字形与 `SOUL_STATE_GLYPH` 只共用 ◇(待审 / 待定,都是「还要处理」,都带 s2 底),
 * soulStateBadgeContract.test.ts 守着这一点。
 */
export const VERDICT_GLYPH: Record<Verdict, string> = {
  PASSED: "✓",
  FAILED: "✕",
  PURGATORY: "◇",
  RETRY: "↺",
};

/**
 * 判决徽章(补足 B8 / C15):领域枚举,1px 中性灰框(2026-10-01 v3:原为 ink3)、ink 字、无底;只有「待定」
 * 加 s2 底(还要继续处理)。「不过」的 ✕ 是 ink,不是冷玫红 —— 冷玫红只给系统出错。
 */
export const VERDICT_BADGE_CLASSES: Record<Verdict, string> = {
  PASSED: DOMAIN_BADGE,
  FAILED: DOMAIN_BADGE,
  PURGATORY: DOMAIN_BADGE_PENDING,
  RETRY: DOMAIN_BADGE,
};

export function verdictGlyph(verdict: string | null | undefined): string {
  return verdict && verdict in VERDICT_GLYPH ? VERDICT_GLYPH[verdict as Verdict] : "?";
}

export function verdictBadgeClass(verdict: string | null | undefined): string {
  return verdict && verdict in VERDICT_BADGE_CLASSES
    ? VERDICT_BADGE_CLASSES[verdict as Verdict]
    : UNKNOWN_SOUL_STATE_BADGE_CLASS;
}
