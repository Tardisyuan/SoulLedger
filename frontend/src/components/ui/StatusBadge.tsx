"use client";

import { Badge, type BadgeTone } from "@/src/components/ui/Badge";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { useI18n } from "@/src/contexts/I18nContext";
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

/**
 * 无底色徽章 + 字形,里面是 `DomainEnum`(原始枚举值仍在 `title` 上,BRIEF §4.6)。
 *
 * 2026-10-01 规范 v3:框一律中性灰 `--color-line`,不再跟 tone 同色 —— 意思由字形 +
 * 文字承担,颜色不再画两遍。字仍是 tone 色:这些是流程状态,不是 C15 的领域枚举,
 * 规范 v1 §1.2 给它们「颜色 + 字形」,v3 只改了框。
 */
export const STATUS_BADGE_BORDER = "border-[oklch(var(--color-line))]";

export function StatusBadge({ namespace, value, tone = "neutral" }: { namespace: string; value: string | null | undefined; tone?: BadgeTone }) {
  return (
    <Badge tone={tone} glyph={TONE_GLYPH[tone]} className={STATUS_BADGE_BORDER}>
      <DomainEnum namespace={namespace} value={value} />
    </Badge>
  );
}

/**
 * 判决徽章(补足 B8):领域枚举,ink 字 + 1px 中性灰框(2026-10-01 v3,原 ink3),「待定」加 s2 底。字形与底色
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

/**
 * 滞留徽章:判决的 `stale_since` 非空(未结案且 30 天无进展,定时任务盖章,**不结案**)。
 * 流程状态,走 warning 的「颜色 + 字形」;「30 天无进展」放在 `title` 与读屏文字里。
 * 审判列表的待审一面与审判台的案情栏画这一个。
 */
export function StaleBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  const hint = t("judgment.stale.hint");
  return (
    <Badge tone="warning" glyph={TONE_GLYPH.warning} className={`${STATUS_BADGE_BORDER} ${className ?? ""}`} title={hint} data-stale-badge="">
      {t("judgment.stale.label")}
      <span className="sr-only"> · {hint}</span>
    </Badge>
  );
}
