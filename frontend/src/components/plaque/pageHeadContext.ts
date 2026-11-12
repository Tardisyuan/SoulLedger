"use client";

import { createContext, useContext, useEffect } from "react";
import type { PlaqueText } from "./Plaque";

/**
 * 壳与 PageShell 页头之间的两条通道(第三十批「卷宗」第 1 步)。与 `usePlaque`(页面 → 壳)分在两个模块:
 * 页面测试常把 `Plaque` 模块整个 mock 成只有 `usePlaque`,PageShell 从这里读,不受影响。
 */

const PlaqueValueContext = createContext<PlaqueText | null>(null);
/** AppLayout 用:把页面此刻经 `usePlaque` 报的值交给 PageShell 的页头。壳外是 null —— 页头只画页面自己给它的。 */
export const PlaqueValueProvider = PlaqueValueContext.Provider;
/** PageShell 的页头读:页面报的殿名 / 案号 / 概览。 */
export function usePlaqueValue(): PlaqueText | null {
  return useContext(PlaqueValueContext);
}

const HeadingContext = createContext<(text: string | null) => void>(() => {});
/** AppLayout 用:收下 PageShell 此刻 `<h1>` 的文字,面包屑据此省掉与它相同的末段。 */
export const HeadingProvider = HeadingContext.Provider;

/** PageShell 调用:标题是字符串时报给壳;不是字符串(节点)时报 null —— 面包屑照常画全。 */
export function useReportHeading(text: string | null | undefined): void {
  const set = useContext(HeadingContext);
  useEffect(() => {
    set(text || null);
    return () => set(null);
  }, [set, text]);
}
