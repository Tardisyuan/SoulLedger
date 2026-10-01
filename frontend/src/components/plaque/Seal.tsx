"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { civSkinOf } from "@/src/lib/civSkin";
import { MOTION_DURATIONS, MOTION_EASINGS, prefersReducedMotion } from "@/lib/motion";

/**
 * 印(规范 v3 `Seal`,2026-10-02 取代 v2 的实底印):描边几何印 —— 2px 外框 + 内缩 6px 的
 * 1px 细框(≤ 32 是 1px 外框、内缩 4px),印文是 Noto Serif SC 600(`font-title`)。外形按
 * 文明:地府方、欧洲圆、埃及拱(高 = 宽 × 70/64,上圆下方)、希腊六边。颜色是 currentColor:
 * 默认取匾色(`--color-main`,印是匾色的五处之一),身份带上随带上的白字(带本身就是匾色)。
 * 形状与颜色都在 globals.css 的 `.seal`;根元素写 data-civ,所以一枚别的文明的印也拿到它
 * 自己的形与色。
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

/** 字号 = 印宽 × 系数:v3 是 64 → 28、30 → 15;埃及两字竖排每字 0.34。 */
const GLYPH_SCALE = 0.44;
const SMALL_GLYPH_SCALE = 0.5;
const EG_TWO_GLYPH_SCALE = 0.34;
/** v3 `.seal-egypt`:64 宽 70 高。 */
const EG_ASPECT = 70 / 64;

const isSealCiv = (civ: string): civ is SealCiv => civ in DEFAULT_SEAL_GLYPHS;

/** 只有埃及允许 2 字;长度 0 或超长是数据错误,服务端校验会拒 —— 这里退回默认,不截断。 */
export function sealGlyphsFor(civ: SealCiv, glyphs: readonly string[] | null | undefined): readonly string[] {
  const max = civ === "eg" ? 2 : 1;
  return glyphs && glyphs.length >= 1 && glyphs.length <= max ? glyphs : DEFAULT_SEAL_GLYPHS[civ];
}

/**
 * 盖印(交互与动效第 2 轮 §三 1):下落 0–120(ease.drop,28px,透明度 0→1)→ 压实 120–180
 * (1.06 → 0.97 → 1,全站唯一允许的缩放)→ 静置到 320。v2 的「印泥晕开」画在残边环上,
 * v3 的描边印没有那一层,随之去掉。
 * 减少动态效果时不播:印直接是落定的样子。WAAPI,不进 motion —— 多段关键帧、可 cancel()。
 */
function useStamp(stampKey: number | undefined) {
  const root = useRef<HTMLSpanElement>(null);
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
    return () => press.cancel();
  }, [stampKey]);
  return root;
}

export function Seal({
  size,
  civ,
  glyphs,
  court,
  stampKey,
  className = "",
}: {
  /** 印宽:72 落判 / 64 身份带 / 52 签署 / 30 收起的身份带 / 28 导航。 */
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
  const root = useStamp(stampKey);
  const skin = civ ?? civSkinOf(user?.tenant?.code ?? null);
  if (!isSealCiv(skin)) return null;

  const shown = sealGlyphsFor(skin, glyphs === undefined ? user?.tenant?.seal_glyphs : glyphs);
  const two = shown.length === 2;
  const small = size <= 32;
  const fontSize = Math.round(size * (two ? EG_TWO_GLYPH_SCALE : small ? SMALL_GLYPH_SCALE : GLYPH_SCALE));
  const label = t("seal.aria", { court: court ?? user?.tenant?.display_name ?? "" });

  return (
    <span
      ref={root}
      role="img"
      aria-label={label}
      data-civ={skin}
      data-small={small ? "" : undefined}
      data-testid="seal"
      className={`seal ${className}`}
      style={{ width: size, height: skin === "eg" ? Math.round(size * EG_ASPECT) : size }}
    >
      <span aria-hidden="true" className="seal-glyphs" style={{ fontSize }}>
        {shown.map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </span>
    </span>
  );
}
