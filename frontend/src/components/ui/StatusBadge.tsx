"use client";

import { Badge, type BadgeTone } from "@/src/components/ui/Badge";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { useI18n } from "@/src/contexts/I18nContext";
import { soulStateBadgeClass, soulStateGlyph } from "@/src/lib/soulStateBadge";
import { verdictBadgeClass, verdictGlyph } from "@/src/lib/verdictGlyph";
import { verdictNamespace } from "@/src/lib/domainNames";

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
 * 第三十批「卷宗」的十个状态标签:形状前缀与色(Design v4 第三十批第一节第 2 条)。灵魂状态与判决仍各读自己的表
 * (`soulStateBadge.ts` / `verdictGlyph.ts`,同样的字形);这张给案卷台、卷宗这类不经那两张表的标签用 ——
 * `<Badge tone={DOSSIER_TAG.overdue.tone} glyph={DOSSIER_TAG.overdue.glyph}>`。
 */
export const DOSSIER_TAG = {
  judging: { glyph: "◇", tone: "warning" },
  retry: { glyph: "↺", tone: "warning" },
  overdue: { glyph: "!", tone: "error" },
  pending: { glyph: "‖", tone: "neutral" },
  claimedByOther: { glyph: "◌", tone: "neutral" },
  disposed: { glyph: "▣", tone: "neutral" },
  reincarnating: { glyph: "↻", tone: "neutral" },
  settled: { glyph: "✓", tone: "success" },
  demerit: { glyph: "−", tone: "error" },
  merit: { glyph: "+", tone: "success" },
  /* 第 3 步第 5 条:「已驳回」保留 ✕;「申诉被驳回」是 ⊘(圈 = 第二轮,与申诉的 ↺ 同属圆形一族)。两者都是 neg 淡染。 */
  rejected: { glyph: "✕", tone: "error" },
  appealRejected: { glyph: "⊘", tone: "error" },
} as const satisfies Record<string, { glyph: string; tone: BadgeTone }>;

/**
 * 淡染标签 + 字形,里面是 `DomainEnum`(原始枚举值仍在 `title` 上,BRIEF §4.6)。
 *
 * 第三十批起标签无边框(Design v4 第三十批第一节第 2 条):tone 给底和字(`Badge` 的四色表),字形承担区分。
 * v3 的 `STATUS_BADGE_BORDER`(中性灰框)随之删掉。
 */

export function StatusBadge({
  namespace,
  value,
  tone = "neutral",
  glyph,
}: {
  namespace: string;
  value: string | null | undefined;
  tone?: BadgeTone;
  /** 不取色调的默认字形时(如申诉被驳回 ⊘)。 */
  glyph?: string;
}) {
  return (
    <Badge tone={tone} glyph={glyph ?? TONE_GLYPH[tone]}>
      <DomainEnum namespace={namespace} value={value} />
    </Badge>
  );
}

/**
 * 判决标签(补足 B8):领域枚举,淡染(第三十批)。字形与底色都读 `verdictGlyph.ts` 那一张表 —— 审判列表、审判台、灵魂详情、处置页都画这一个。
 */
export function VerdictBadge({
  verdict,
  civilization,
  className,
}: {
  verdict: string | null | undefined;
  /** 案子的文明:PURGATORY 按文明叫(欧洲炼狱、埃及天平摇摆,第十一批 1a);没给就是通用的「存疑」。 */
  civilization?: string | null;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Badge glyph={verdictGlyph(verdict)} className={`${verdictBadgeClass(verdict)} ${className ?? ""}`} data-verdict-badge={verdict ?? ""}>
      <DomainEnum namespace={verdictNamespace(t, civilization, verdict)} value={verdict} />
    </Badge>
  );
}

/** 灵魂状态标签(补足 C15):同上,读 `soulStateBadge.ts`,「审判中」是 warn 淡染。 */
export function SoulStateBadge({ state, className }: { state: string | null | undefined; className?: string }) {
  return (
    <Badge glyph={soulStateGlyph(state)} className={`${soulStateBadgeClass(state)} ${className ?? ""}`} data-soul-state-badge={state ?? ""}>
      <DomainEnum namespace="souls.states" value={state} />
    </Badge>
  );
}

/**
 * 滞留徽章:判决的 `stale_since` 非空(未结案且 30 天无进展,定时任务盖章,**不结案**)。
 * 第三十批:超期类标签 =「! + neg 淡染」(Design 样张「! 超期」);「30 天无进展」放在 `title` 与读屏文字里。
 * 审判列表的待审一面与审判台的案情栏画这一个。
 */
export function StaleBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  const hint = t("judgment.stale.hint");
  return (
    <Badge tone="error" glyph="!" className={className} title={hint} data-stale-badge="">
      {t("judgment.stale.label")}
      <span className="sr-only"> · {hint}</span>
    </Badge>
  );
}
