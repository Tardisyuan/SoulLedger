"use client";

import { useCallback } from "react";

/**
 * 横向滚动的一行(门内标签、页头下的筛选条)右边还有没露出来的东西时,给它挂 `data-overflow-end`,
 * globals.css 据此把右缘 40px 渐隐 —— 告诉人后面还有。滚到头、或者本来就放得下,就摘掉。
 * 回调 ref(React 19 的 ref 清理函数):元素条件渲染、晚于首帧出现也接得上。
 */
export function useOverflowEnd<T extends HTMLElement>() {
  return useCallback((el: T | null) => {
    if (!el) return;
    const update = () => el.toggleAttribute("data-overflow-end", el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    // jsdom 没有 ResizeObserver;没有就只跟滚动与内容变化。
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    // 内容会换(换一页门内标签、筛选控件随数据出现),宽度跟着变而这一行自己的尺寸不变。
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
      mo.disconnect();
    };
  }, []);
}
