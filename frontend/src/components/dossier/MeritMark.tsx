"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { spineCivOf } from "./spineModel";
import s from "./dossier.module.css";

/**
 * 功过记号(Design 第三十批 第 3 步第 4 条):记号只回答「是功还是过」,靠形状(描线 vs 实底,加各家自己的形),
 * 16px(`--mark`)、墨色;颜色只上数字(`SignedNumber`),数字一律带 + / −。
 *   地府 「功」字描框 / 「过」字实底 —— 功过格的两栏,字就是记号;英文与 egy 框里换成 + / −(sans 600,
 *        Design 第三十六批 第一节第 1 条:不读汉字的人看「功」「过」只是两块花纹),形状不变
 *   欧洲 四角星(德)/ 圆底 P(罪,炼狱篇第九歌)
 *   埃及 羽(描线)/ 心形罐(实底)
 *   希腊 白票:描线圆 + 实心中点 / 黑票:实底圆中间一个孔
 * 认不出文明就用地府的。读屏读记号的名字(`caseDesk.dossier.mark.<civ>.<kind>`)。
 */
export type MeritKind = "merit" | "demerit";

export function MeritMark({ civilization, kind }: { civilization: string | null | undefined; kind: MeritKind }) {
  const { t, locale } = useI18n();
  const civ = spineCivOf(civilization) ?? "cn";
  const name = t(`caseDesk.dossier.mark.${civ}.${kind}`);
  if (civ === "cn") {
    return (
      <span role="img" aria-label={name} data-mark={`${civ}-${kind}`} className={`${s.mark} ${s.markCn} ${kind === "demerit" ? s.markCnSolid : ""} ${locale === "zh-Hans" ? "" : s.markCnSign}`}>
        <span aria-hidden="true">{t(`caseDesk.dossier.mark.cn.${kind}_glyph`)}</span>
      </span>
    );
  }
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={name} data-mark={`${civ}-${kind}`} className={s.mark}>
      {GLYPH[civ][kind]}
    </svg>
  );
}

const GLYPH = {
  eu: {
    merit: <path d="M8 1.5l1.7 4.8L14.5 8l-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />,
    demerit: (
      <>
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <text x="8" y="12" textAnchor="middle" fontSize="11" fontWeight="700" className={s.onInk} style={{ fontFamily: "var(--font-title)" }}>
          P
        </text>
      </>
    ),
  },
  eg: {
    merit: (
      <>
        <path d="M9 1C5 4 4.5 9 6 15c4-4 5.5-9 3-14z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M8.2 3.5L6.3 14" stroke="currentColor" strokeWidth=".9" />
      </>
    ),
    demerit: (
      <path d="M5 2.5h6M6 2.5v2C3 6 2.5 10 4.5 12.5 6 14.5 10 14.5 11.5 12.5 13.5 10 13 6 10 4.5v-2" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    ),
  },
  gr: {
    merit: (
      <>
        <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="8" cy="8" r="2.4" fill="currentColor" />
      </>
    ),
    demerit: (
      <>
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <circle cx="8" cy="8" r="2.4" className={s.onInk} />
      </>
    ),
  },
} as const;

/** 带号的数:颜色只在这里(功 pos、过 neg),0 不上色。`sign` 给方向,`value` 是大小。 */
export function SignedNumber({ value, sign }: { value: number; sign?: 1 | -1 }) {
  const signed = sign ? sign * Math.abs(value) : value;
  const text = signed > 0 ? `+${signed}` : signed < 0 ? `−${Math.abs(signed)}` : "0";
  return <span className={`${s.num} ${signed > 0 ? s.pos : signed < 0 ? s.neg : ""}`}>{text}</span>;
}
