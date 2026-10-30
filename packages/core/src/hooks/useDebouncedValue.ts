"use client";

import { useEffect, useState } from "react";

/** 搜索框的默认停手时长:停 300 ms 才发一次请求，而不是每个字一次。 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * `value` 停止变化 `delayMs` 之后才跟上的那份值。给搜索框用：输入框绑原值，查询键用这份。
 * 首次渲染直接返回 `value`(带着初始搜索打开的页面不必先空等一拍)。
 */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
