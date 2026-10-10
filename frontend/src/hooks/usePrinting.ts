"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/**
 * 页面正在被打印(或预览打印)。折叠区借它在打印时强制渲染内容:`Collapse` 对「一开始就收着」的
 * 内容根本不渲染,光靠 CSS 展不开。
 *
 * `beforeprint` 里用 `flushSync`:浏览器紧接着就排版,下一个 tick 的渲染赶不上。
 * 两条路都接:`beforeprint` / `afterprint`(Chromium、Firefox)和 `matchMedia("print")`
 * 的 change(Safari 不总发前两个事件)。
 */
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const set = (on: boolean) => flushSync(() => setPrinting(on));
    const before = () => set(true);
    const after = () => set(false);
    const mql = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const onChange = (e: MediaQueryListEvent) => set(e.matches);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    mql?.addEventListener?.("change", onChange);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      mql?.removeEventListener?.("change", onChange);
    };
  }, []);
  return printing;
}
