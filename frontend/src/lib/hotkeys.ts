"use client";

import { useEffect, useRef } from "react";

/**
 * 页面级单键快捷键(规范 v1 第三类 A:审判台 1–4 / ⌘⏎,审判队列 Q)。
 *
 * 规则只有两条,都为了不抢打字:
 * - 焦点在能打字的地方(文本框、多行框、下拉、contentEditable)时,单键一律不接;
 *   单选 / 复选框不算 —— 它们不收字,裁决单选框获焦时按 3 仍应选中「补过」。
 * - `mod+Enter`(⌘⏎ / Ctrl⏎)例外,在文本框里也接:它不输入任何字符,而判词框里
 *   写完即落判正是它的用处。
 *
 * 其余修饰键组合一律放过(⌘1 是浏览器切标签页)。
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return type !== "radio" && type !== "checkbox" && type !== "button" && type !== "submit";
}

/** 一次按键对应哪个快捷键名;不该接的返回 null。导出给测试。 */
export function hotkeyOf(event: KeyboardEvent): string | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && !event.altKey && !event.shiftKey && event.key === "Enter") return "mod+Enter";
  if (mod || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

/** `handlers` 的键是 `hotkeyOf` 的返回值:"1"、"q"、"mod+Enter"。`enabled=false` 时整组不挂。 */
export function useHotkeys(handlers: Record<string, () => void>, enabled = true) {
  // 最新的一组处理函数放在 ref 里,监听只挂一次;在 effect 里写,不在渲染时写。
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      const name = hotkeyOf(event);
      const handler = name ? latest.current[name] : undefined;
      if (!handler) return;
      event.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
