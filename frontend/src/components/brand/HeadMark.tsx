"use client";

import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { useHallName } from "@/src/components/plaque/useHall";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 页头记号(Design v4 第四十五批第四节):文明色收紧之后,四家不靠颜色分清的主通道。页头右上角,墨色
 * (深 34% / 浅 30%,globals.css `.page-head-mark`),去色以后照样看得见。装饰,`aria-hidden`。
 *
 * 地府那一格是「殿名随殿变」(用户 2026-11-14,取代稿子的竖排「地府」两字):竖排此刻所在殿的殿名
 * (`useHallName`,来自 `Tenant.hall_names`);egy 没有殿名退英文。字号与长度上限照第四十六批第三节(`diyuMarkText`):
 * 中文 3 字以内 22/26、4–5 字 20/23(`data-head-size="s"`),超过 5 字退「地府」;英文 / egy 竖排拉丁大写 12/14、
 * 600、字距 .28em(`data-head-script="latin"`),超过 14 个字符退「DIYU」。拿不到殿名时同样退回「地府」/「DIYU」。
 * 位置由 `useHeadMarkAvoidance` 管(避开右侧按钮、标题太长时不画)。
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

/**
 * 地府记号上写的字:殿名放得下就写殿名,放不下(中文 > 5 字、拉丁 > 14 个字符)或没有就退回地府 / DIYU。
 * 拉丁殿名先去掉开头的冠词「The 」(不分大小写)再量(用户 2026-11-14:种子名「The Fifth Court」记作 FIFTH COURT);
 * 只在记号这一处,别处照旧写全名。
 */
export function diyuMarkText(hallName: string | undefined, han: boolean): string {
  if (han) return hallName && Array.from(hallName).length <= 5 ? hallName : "地府";
  const latin = hallName?.replace(/^the\s+/i, "");
  return latin && latin.length <= 14 ? latin : "DIYU";
}

/** 记号与按钮组、标题之间的距离(第四十六批第三节)。 */
const HEAD_MARK_EDGE = 20;
const HEAD_MARK_GAP_TO_ACTIONS = 16;
const HEAD_MARK_MIN_GAP_TO_TITLE = 24;

/**
 * 页头记号的避让(第四十六批第三节,稿子 v4-batch46-desk.html 第 5 节)。顶边不变;页头右侧有按钮组(或尾格)时,
 * 记号右缘退到它左边 16px(right = 页头右缘 − 按钮组左缘 + 16,按钮组贴着 right 20 时就是 20 + 组宽 + 16);
 * 标题右缘离记号左缘不足 24px,记号整个不画(`hidden`)—— 它是纹饰,少一个不丢信息。
 * 用 ResizeObserver 跟页头、标题、按钮组的尺寸;没排版(宽 0:隐藏的页、jsdom)时不动,按 CSS 的 right 20 画。
 * 直接改记号元素的 `style.right` / `hidden`:React 不管这两样,重渲染不会把它们写回去。
 */
export function useHeadMarkAvoidance(headRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const head = headRef.current;
    if (!head) return;
    const place = () => {
      const mark = head.querySelector<HTMLElement>(".page-head-mark");
      if (!mark) return;
      const box = head.getBoundingClientRect();
      if (box.width === 0) return;
      const lefts = Array.from(head.querySelectorAll<HTMLElement>("[data-page-shell-actions], [data-page-shell-aside]")).map(
        (el) => el.getBoundingClientRect().left,
      );
      const right = lefts.length ? Math.max(HEAD_MARK_EDGE, box.right - Math.min(...lefts) + HEAD_MARK_GAP_TO_ACTIONS) : HEAD_MARK_EDGE;
      mark.style.right = `${right}px`;
      // 先放出来再量:藏着的记号宽是 0。
      mark.hidden = false;
      const markLeft = box.right - right - mark.getBoundingClientRect().width;
      // 标题的字(不是 flex-1 撑开的 <h1> 盒)的右缘。
      const h1 = head.querySelector("h1");
      let titleRight = -Infinity;
      if (h1?.textContent) {
        const range = document.createRange();
        range.selectNodeContents(h1);
        // jsdom 的 Range 没有这个方法;那里本来也不排版。
        titleRight = range.getBoundingClientRect?.().right ?? -Infinity;
      }
      mark.hidden = titleRight + HEAD_MARK_MIN_GAP_TO_TITLE > markLeft;
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    for (const el of [head, ...Array.from(head.querySelectorAll<HTMLElement>("h1, [data-page-shell-actions], [data-page-shell-aside]"))]) ro.observe(el);
    return () => ro.disconnect();
  });
}

/** 中性皮(`civ` 为 null)没有记号:记号说的是「哪一家」。 */
export function HeadMark({ civ }: { civ: SealCiv | null }) {
  const hallName = useHallName();
  const { locale } = useI18n();
  if (!civ) return null;
  if (civ === "cn") {
    const han = locale === "zh-Hans";
    const text = diyuMarkText(hallName, han);
    return (
      <span
        aria-hidden="true"
        data-head-mark="cn"
        data-head-script={han ? "han" : "latin"}
        data-head-size={han && Array.from(text).length >= 4 ? "s" : undefined}
        className="page-head-mark"
      >
        {text}
      </span>
    );
  }
  return (
    <span aria-hidden="true" data-head-mark={civ} className="page-head-mark">
      {MARKS[civ]}
    </span>
  );
}
