"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * 「单字母快捷键」总开关(WCAG 2.1.4):关掉后所有单个可打印字符的快捷键(1–4、J/K、S、W、C…)不再接;
 * Esc、方向键、⌘⏎ 这类不是单字符的照旧。`?` 例外 —— 它打开快捷键列表,开关就在那里,关掉之后还得找得回来。
 * 存在本浏览器的 localStorage(服务端偏好是另一条后端改动,这里不做)。
 */
export const SINGLE_KEYS_STORAGE_KEY = "soulledger_single_key_shortcuts";
const listeners = new Set<() => void>();
export function singleKeyShortcutsEnabled(): boolean {
  try {
    return localStorage.getItem(SINGLE_KEYS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}
export function setSingleKeyShortcuts(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SINGLE_KEYS_STORAGE_KEY);
    else localStorage.setItem(SINGLE_KEYS_STORAGE_KEY, "off");
  } catch {
    // 存储被禁:本次会话内无处记,开关不生效,也不报错。
  }
  listeners.forEach((fn) => fn());
}
export function useSingleKeyShortcuts(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    singleKeyShortcutsEnabled,
    () => true,
  );
}

/** 页面登记自己的快捷键,全局 `?` 列给用户看。登记的是文案键(`label` 过 `t`),不是文字。 */
export interface ShortcutRow {
  key: string;
  label: string;
}
const helpSources = new Map<symbol, readonly ShortcutRow[]>();
const helpListeners = new Set<() => void>();
let helpSnapshot: readonly ShortcutRow[] = [];
function publishHelp() {
  helpSnapshot = [...helpSources.values()].flat();
  helpListeners.forEach((fn) => fn());
}
export function useShortcutHelp(rows: readonly ShortcutRow[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const id = Symbol("shortcut-help");
    helpSources.set(id, rows);
    publishHelp();
    return () => {
      helpSources.delete(id);
      publishHelp();
    };
    // rows 是模块级常量,登记一次即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
export function useRegisteredShortcuts(): readonly ShortcutRow[] {
  return useSyncExternalStore(
    (fn) => {
      helpListeners.add(fn);
      return () => void helpListeners.delete(fn);
    },
    () => helpSnapshot,
    () => helpSnapshot,
  );
}

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
  if (event.key.length !== 1) return event.key;
  if (event.key !== "?" && !singleKeyShortcutsEnabled()) return null;
  return event.key.toLowerCase();
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
