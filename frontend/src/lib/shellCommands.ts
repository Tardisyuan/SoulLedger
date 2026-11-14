"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * ⌘K 命令面板的「指令」一组(规范 v4 第七批 S02,`cmdk.group.commands`)。
 *
 * 面板在壳里,指令属于页面:审判台登记「通过 · {soul}」「不过 · {soul}」「跳到下一件 · 放进待定分组」,
 * 离开审判台就没有了 —— 判决类指令只对当前这一件生效(`cmdk.verdict_scope`)。登记的是**已经翻译好的**
 * 文字(灵魂名、案号是数据,不是键),和 `useShortcutHelp` 登记文案键不同。
 *
 * `run` 就是页面上那个按钮做的事:回车即判,和点按钮一样落印。要先选理由的(「不过」)由页面自己
 * 打开理由面板,面板只负责调用。
 *
 * 用法:`useShellCommands(commands)`,`commands` 要 `useMemo` —— 换引用就重新登记一次。
 */
export interface ShellCommand {
  id: string;
  label: string;
  /** 右侧小字:「{case} · 落印后进入审批」「先选一个理由」。 */
  hint?: string;
  /** 判决类(排在最上,选中时图标块是实色)。 */
  verdict?: boolean;
  run: () => void;
}

const sources = new Map<symbol, readonly ShellCommand[]>();
const listeners = new Set<() => void>();
let snapshot: readonly ShellCommand[] = [];

function publish() {
  const all = [...sources.values()].flat();
  // 判决类在前,其余保持登记顺序(sort 是稳定的)。
  snapshot = [...all].sort((a, b) => Number(!!b.verdict) - Number(!!a.verdict));
  listeners.forEach((fn) => fn());
}

export function useShellCommands(commands: readonly ShellCommand[], enabled = true): void {
  useEffect(() => {
    if (!enabled || commands.length === 0) return;
    const id = Symbol("shell-commands");
    sources.set(id, commands);
    publish();
    return () => {
      sources.delete(id);
      publish();
    };
  }, [commands, enabled]);
}

export function useRegisteredCommands(): readonly ShellCommand[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => snapshot,
    () => snapshot,
  );
}
