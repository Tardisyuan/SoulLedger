import type { ReactNode } from "react";
import type { SealCiv } from "@/src/components/plaque/Seal";

/**
 * 页头记号(Design v4 第四十五批第四节):文明色收紧之后,四家不靠颜色分清的主通道。页头右上角,墨色
 * (深 34% / 浅 30%,globals.css `.page-head-mark`),去色以后照样看得见。装饰,`aria-hidden`,不翻译:
 * 地府的「地府」两字在英文与 egy 界面里也照样显示 —— 它是纹饰,与印上的「第一殿印」同一类,不是要读的字。
 *
 * 地府那一格可能换成「无字的竖排方印轮廓」(Design 请用户定):只换下面 `cn` 这一项,样式按 `data-head-mark` 选。
 * 埃及画成 SVG,不用 Unicode 圣书体:那要另加载 Noto Sans Egyptian Hieroglyphs,没加载上时四个字全是方框。
 */
const MARKS: Record<SealCiv, ReactNode> = {
  cn: (
    <>
      地<br />府
    </>
  ),
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
  if (!civ) return null;
  return (
    <span aria-hidden="true" data-head-mark={civ} className="page-head-mark">
      {MARKS[civ]}
    </span>
  );
}
