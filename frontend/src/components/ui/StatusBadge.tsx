"use client";

import { Badge, type BadgeTone } from "@/src/components/ui/Badge";
import { DomainEnum } from "@/src/components/ui/DomainValue";

/**
 * 规范 v1 §1.2「状态 = 颜色 + 字形」,给按 tone 上色的流程状态(调度、会审、凭据、
 * 死亡登记……)一枚字形。字形取自规范的状态表:✓ 通过、✕ 不通过、◐ 进行中、
 * ↻ 流转中、○ 未开始 / 已撤、■ 墨色。灵魂生命周期与判决各有自己的表
 * (`soulStateBadge.ts` / `verdictGlyph.ts`),不走这里。
 */
export const TONE_GLYPH: Record<BadgeTone, string> = {
  success: "✓",
  error: "✕",
  warning: "◐",
  info: "↻",
  accent: "↻",
  neutral: "○",
  ink: "■",
};

/** 无底色徽章 + 字形,里面是 `DomainEnum`(原始枚举值仍在 `title` 上,BRIEF §4.6)。 */
export function StatusBadge({ namespace, value, tone = "neutral" }: { namespace: string; value: string | null | undefined; tone?: BadgeTone }) {
  return (
    <Badge tone={tone} glyph={TONE_GLYPH[tone]}>
      <DomainEnum namespace={namespace} value={value} />
    </Badge>
  );
}
