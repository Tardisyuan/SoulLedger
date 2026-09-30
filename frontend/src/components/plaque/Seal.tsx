"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { civSkinOf } from "@/src/lib/civSkin";
import { MOTION_DURATIONS, MOTION_EASINGS, prefersReducedMotion } from "@/lib/motion";

/**
 * 印(规范 v2 §四「印」、补足 A6)。叠放自下而上:外形 body 实底匾色 → 残边环 ring 叠扫描
 * 质感 → 细框 / 粗框 / 点缀 line(≤ 32 只留粗框 line-small)→ 印文,真字体。四层的形状、
 * 颜色、字体都由根元素上的 `data-civ` 经 globals.css 选定,这里只管尺寸与印文。
 *
 * 印文不翻译:取租户的 `seal_glyphs`,空(或不合规)时用文明默认。读屏读语言包 `seal.aria`
 * 「{殿名}之印」,印文本身 aria-hidden —— 一个篆字、一个花体字母、一个圣书字,念出来都不是话。
 *
 * 中性皮(登录前、不认得的租户)没有印,返回 null。
 */

export type SealCiv = "cn" | "eu" | "eg" | "gr";

/** 文明默认印文(补足 A6):地府「冥」、欧洲「J」、埃及 U+13184、希腊「Μ」(希腊大写,不是拉丁 M)。 */
export const DEFAULT_SEAL_GLYPHS: Record<SealCiv, readonly string[]> = {
  cn: ["冥"],
  eu: ["J"],
  eg: ["\u{13184}"],
  gr: ["Μ"],
};

/** 字号系数:按「印文墨色占印心面积 35–45%」标定(§四);埃及两字竖排每字 0.46。 */
const GLYPH_SCALE: Record<SealCiv, number> = { cn: 0.54, eu: 0.42, eg: 0.68, gr: 0.5 };
const EG_TWO_GLYPH_SCALE = 0.46;

const isSealCiv = (civ: string): civ is SealCiv => civ in DEFAULT_SEAL_GLYPHS;

/** 只有埃及允许 2 字;长度 0 或超长是数据错误,服务端校验会拒 —— 这里退回默认,不截断。 */
export function sealGlyphsFor(civ: SealCiv, glyphs: readonly string[] | null | undefined): readonly string[] {
  const max = civ === "eg" ? 2 : 1;
  return glyphs && glyphs.length >= 1 && glyphs.length <= max ? glyphs : DEFAULT_SEAL_GLYPHS[civ];
}

/**
 * 盖印(交互与动效第 2 轮 §三 1):下落 0–120(ease.drop,28px,透明度 0→1)→ 压实 120–180
 * (1.06 → 0.97 → 1,全站唯一允许的缩放)→ 印泥晕开 120–320(残边环 0 → 0.95 → 0.8)。
 * 减少动态效果时不播:印直接是落定的样子。WAAPI,不进 motion —— 多段关键帧、可 cancel()。
 */
function useStamp(stampKey: number | undefined) {
  const root = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!stampKey || !el || typeof el.animate !== "function" || prefersReducedMotion()) return;
    const total = MOTION_DURATIONS.slow * 1000;
    const at = (ms: number) => ms / total;
    const drop = `cubic-bezier(${MOTION_EASINGS.drop.join(",")})`;
    const press = el.animate(
      [
        { offset: 0, opacity: 0, transform: "translateY(-28px) scale(1.06)", easing: drop },
        { offset: at(120), opacity: 1, transform: "translateY(0) scale(1.06)", easing: "ease-out" },
        { offset: at(150), transform: "scale(0.97)", easing: "ease-out" },
        { offset: at(180), transform: "scale(1)" },
        { offset: 1, opacity: 1, transform: "none" },
      ],
      { duration: total }
    );
    const ink = ring.current?.animate(
      [
        { offset: 0, opacity: 0 },
        { offset: at(120), opacity: 0 },
        { offset: at(220), opacity: 0.95 },
        { offset: 1, opacity: 0.8 },
      ],
      { duration: total }
    );
    return () => {
      press.cancel();
      ink?.cancel();
    };
  }, [stampKey]);
  return { root, ring };
}

export function Seal({
  size,
  civ,
  glyphs,
  court,
  stampKey,
  className = "",
}: {
  /** 72 落判 / 64 样张 / 56 登录 / 52 页头 / 32 落款。 */
  size: number;
  /** 默认取当前租户的文明。 */
  civ?: string;
  /** 默认取当前租户的 `seal_glyphs`。 */
  glyphs?: readonly string[] | null;
  /** 读屏标签里的殿名;默认取当前租户的展示名。 */
  court?: string;
  /** 每变一次(且非 0)盖一次印。 */
  stampKey?: number;
  className?: string;
}) {
  const { t } = useI18n();
  const { user } = useTenant();
  const { root, ring } = useStamp(stampKey);
  const skin = civ ?? civSkinOf(user?.tenant?.code ?? null);
  if (!isSealCiv(skin)) return null;

  const shown = sealGlyphsFor(skin, glyphs === undefined ? user?.tenant?.seal_glyphs : glyphs);
  const two = shown.length === 2;
  const fontSize = Math.round(size * (two ? EG_TWO_GLYPH_SCALE : GLYPH_SCALE[skin]));
  const label = t("seal.aria", { court: court ?? user?.tenant?.display_name ?? "" });

  return (
    <span
      ref={root}
      role="img"
      aria-label={label}
      data-civ={skin}
      data-small={size <= 32 ? "" : undefined}
      data-testid="seal"
      className={`seal ${className}`}
      style={{ width: size, height: size }}
    >
      <span aria-hidden="true" className="seal-layer seal-body" />
      {size > 32 && <span ref={ring} aria-hidden="true" className="seal-layer seal-ring" />}
      <span aria-hidden="true" className="seal-layer seal-line" />
      <span aria-hidden="true" className="seal-glyphs" style={{ fontSize }}>
        {shown.map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </span>
    </span>
  );
}
