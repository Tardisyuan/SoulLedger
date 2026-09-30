"use client";

import { Badge, type BadgeTone } from "@/src/components/ui/Badge";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { soulStateBadgeClass, soulStateGlyph } from "@/src/lib/soulStateBadge";
import { verdictBadgeClass, verdictGlyph } from "@/src/lib/verdictGlyph";

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

/**
 * 判决徽章(补足 B8):领域枚举,ink 字 + 1px ink3 框,「待定」加 s2 底。字形与底色
 * 都读 `verdictGlyph.ts` 那一张表 —— 审判列表、审判台、灵魂详情、处置页都画这一个。
 */
export function VerdictBadge({ verdict, className }: { verdict: string | null | undefined; className?: string }) {
  return (
    <Badge glyph={verdictGlyph(verdict)} className={`${verdictBadgeClass(verdict)} ${className ?? ""}`} data-verdict-badge={verdict ?? ""}>
      <DomainEnum namespace="judgment.verdicts" value={verdict} />
    </Badge>
  );
}

/** 灵魂状态徽章(补足 C15):同上,读 `soulStateBadge.ts`,「审判中」加 s2 底。 */
export function SoulStateBadge({ state, className }: { state: string | null | undefined; className?: string }) {
  return (
    <Badge glyph={soulStateGlyph(state)} className={`${soulStateBadgeClass(state)} ${className ?? ""}`} data-soul-state-badge={state ?? ""}>
      <DomainEnum namespace="souls.states" value={state} />
    </Badge>
  );
}
