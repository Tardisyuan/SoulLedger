"use client";

import { createContext, useContext, useEffect } from "react";

/**
 * 页面报给页头的几样东西(用户 2026-10-02 拍板;第三十批「卷宗」起它们画在 PageShell 的页头里)。
 *
 * 第三十批第 1 步(Design v4 第三十批回复第一节第 1 条)撤掉了身份带(v3 的 156px 满幅带,v4 的 96px 标题行
 * `Plaque`)和它的第二个标题:页头只有一个 —— PageShell 的「顶线 + 卷宗头」,标题就是页面的 `<h1>`。
 * 这里只剩页面 → 壳的那条通道:页面调 `usePlaque`,AppLayout 收下,经 `usePlaqueValue` 交给 PageShell 的页头。
 *   hall        殿名「<冥界名> · <司 / 殿>」(`useHall`),写在标题上面那一行等宽小字里
 *   caseNumber  审判台自己那一场的案号(可复制的 `<CaseNumber>`,CASE_NUMBER_POLICY),同一行
 *   caseRef     灵魂详情:最相关一场审判的案号 + 状态,或「没有审判」;同一行。见 `PlaqueCase`
 *   meta        一句概览(「1,284 个灵魂 · 本月新入 46」一类),写在标题下面那一行
 *   title       身份带时代的「第二个标题」(审判台、灵魂详情、审批流编辑器 …)。**页头不再画它** ——
 *               页头的标题就是 PageShell 的 `title`。留着这个字段只为不让十几个调用点一起改,壳不读它;
 *               各页逐步删掉(第 3 步的卷宗页改用 PageShell 的 `kind="dossier"`)。
 * 值只来自 API —— 页面拿不到的部分传 undefined,不编。`caseNumber` 是具名的字符串槽,不是 ReactNode:
 * 依赖按值比较,传节点会每次渲染都换引用、每次都重设一遍壳的状态。
 */
export type PlaqueText = { title?: string; meta?: string; hall?: string; caseNumber?: string; caseRef?: PlaqueCase };

/**
 * `caseRef`(灵魂详情,用户 2026-10-10 · Design 第十五批):灵魂不对应单个案子,所以写的是
 * 「它的案号 · 状态」。有 `number` 就是一个指向审判详情的链接(`href`)加后缀字(`label`:未结 / 已结);
 * `{}`(没有 `number`)是「没有审判」—— 标签「案号」保留,值是 `MissingValue`。不给就没有这一格。
 * 与 `caseNumber`(审判台自己那一场、可复制)互斥,`caseNumber` 优先。
 */
export type PlaqueCase = {
  number?: string;
  href?: string;
  label?: string;
  /** 审判不止一场时,案号后面的「全部 N 场 ›」:`allHref` 是这个灵魂的审判列表,`allCount` 是列表接口的总数。 */
  allHref?: string;
  allCount?: number;
};

const PlaqueContext = createContext<(text: PlaqueText | null) => void>(() => {});
/** AppLayout 用:把 setter 交给页面。壳外(测试、登录页)没有 Provider,`usePlaque` 什么都不做。 */
export const PlaqueProvider = PlaqueContext.Provider;

/** 页面调用:挂载期间页头用这几样;卸载时还给壳。 */
export function usePlaque({ title, meta, hall, caseNumber, caseRef }: PlaqueText): void {
  const set = useContext(PlaqueContext);
  // 依赖按值比较:`caseRef` 是对象,每次渲染都是新引用,所以以它的 JSON 为键,进 effect 再还原。
  const caseKey = caseRef ? JSON.stringify(caseRef) : "";
  useEffect(() => {
    set({
      title: title || undefined,
      meta: meta || undefined,
      hall: hall || undefined,
      caseNumber: caseNumber || undefined,
      caseRef: caseKey ? (JSON.parse(caseKey) as PlaqueCase) : undefined,
    });
    return () => set(null);
  }, [set, title, meta, hall, caseNumber, caseKey]);
}

// 壳 → 页头那一半(PageShell 读的两样)在 `pageHeadContext.ts`:单独一个模块,测试里 mock 掉本模块的 `usePlaque`
// 时,PageShell 照样拿得到它们。
