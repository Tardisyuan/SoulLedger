"use client";

import type { ReactNode } from "react";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { useHallName } from "@/src/components/plaque/useHall";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 页头记号(Design v4 第四十五批第四节):文明色收紧之后,四家不靠颜色分清的主通道。页头右上角,墨色
 * (深 34% / 浅 30%,globals.css `.page-head-mark`),去色以后照样看得见。装饰,`aria-hidden`。
 *
 * 地府那一格是「殿名随殿变」(用户 2026-11-14,取代稿子的竖排「地府」两字):竖排此刻所在殿的殿名
 * (`useHallName`,来自 `Tenant.hall_names`)。中文界面是汉字(稿子地府记号的字号),英文 / egy 是小号衬线大写、
 * 字距 .3em(`data-head-script="latin"`);egy 没有殿名退英文。拿不到殿名时退回「地府」/「DIYU」。
 * 其余三家不随殿变、不翻译:IVSTITIA、圣书体、ΚΡΙΣΙΣ 是纹饰,不是要读的字。
 * 埃及画成 SVG,不用 Unicode 圣书体:那要另加载 Noto Sans Egyptian Hieroglyphs,没加载上时四个字全是方框。
 */
const MARKS: Record<Exclude<SealCiv, "cn">, ReactNode> = {
  eu: "IVSTITIA",
  // 安卡、玛阿特之羽、荷鲁斯之眼、柱形;稿子 v4-batch45-civ-identity.html 的原样路径。
  eg: (
    <svg width="112" height="30" viewBox="0 0 112 30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="7" rx="4.5" ry="5.5" />
      <path d="M4 14h16M12 12.5V28" />
      <path d="M40 28C40 18 37 9 33 3c6 3 10 10 10 18 0 3-1 5-3 7z" fill="currentColor" stroke="none" />
      <path d="M58 13c5-6 15-6 20 0-5 5-15 5-20 0z" />
      <circle cx="68" cy="13" r="2.6" fill="currentColor" stroke="none" />
      <path d="M57 8c6-4 16-4 22 0M64 18v7c0 2-2 3-4 2M72 18c2 4 6 6 10 5" />
      <path d="M96 4v22M90 26h12M92 4h8" />
    </svg>
  ),
  // ΚΡΙΣΙΣ,「审判」。
  gr: "ΚΡΙΣΙΣ",
};

/** 中性皮(`civ` 为 null)没有记号:记号说的是「哪一家」。 */
export function HeadMark({ civ }: { civ: SealCiv | null }) {
  const hallName = useHallName();
  const { locale } = useI18n();
  if (!civ) return null;
  if (civ === "cn") {
    const han = locale === "zh-Hans";
    return (
      <span aria-hidden="true" data-head-mark="cn" data-head-script={han ? "han" : "latin"} className="page-head-mark">
        {hallName ?? (han ? "地府" : "DIYU")}
      </span>
    );
  }
  return (
    <span aria-hidden="true" data-head-mark={civ} className="page-head-mark">
      {MARKS[civ]}
    </span>
  );
}
