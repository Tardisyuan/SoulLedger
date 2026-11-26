"use client";

import { useEffect, useRef, useState } from "react";
import { HIGHLIGHT_MS } from "@/src/hooks/useRowTransitions";

const EMPTY: ReadonlySet<string> = new Set();

const read = (key: string): Record<string, number> | null => {
  try {
    const raw = window.sessionStorage.getItem(key);
    const v: unknown = raw === null ? null : JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, number>) : null;
  } catch {
    return null;
  }
};
const write = (key: string, v: Record<string, number>) => {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 写不进(隐私模式、配额):下次进来读不到,照第一次滚 —— 多滚一次,不丢数。
  }
};

/**
 * 概览的「从 0 滚上来」(`.v4-roll` / `.v4-ring-sweep` / `.kpi-fill`)一个会话只播一次(Design 第六十六批):
 * - 本会话第一次进这一屏(`scope`)才滚;之后再进,直接是终值(`roll` 为 false,调用处不挂那几个类)。
 * - 会话里某个数变了 —— 这一屏开着时重取到新值,或上次看过之后再进来时不同 —— 不从 0 重滚,那一格挂表格「行变更」
 *   同一个提示 `animate-row-changed`(墨 10%,停 1.6 秒、淡 0.4 秒),`HIGHLIGHT_MS` 后摘掉。
 * - 记在 sessionStorage(`soulledger.countup.<scope>`,上次看到的各个数;有这一条 = 本会话滚过了)。
 *   读写都包 try/catch:读不到就当第一次,照旧滚。
 * 减少动态效果:滚动由 globals.css 压成终态,这里不另管;变更提示照旧给(它是信息,见 useRowTransitions)。
 *
 * `values` 里 null / undefined(还在取、没有数)的不算,也不记;全是空的那一次什么都不写,数据没到之前离开不算「滚过了」。
 */
export function useCountUpOnce(scope: string, values: Record<string, number | null | undefined>) {
  const key = `soulledger.countup.${scope}`;
  const [roll] = useState(() => read(key) === null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(EMPTY);
  const seen = useRef<Record<string, number> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const sig = JSON.stringify(values);

  useEffect(() => {
    const known = Object.entries(JSON.parse(sig) as Record<string, number | null>).filter(
      (e): e is [string, number] => e[1] != null,
    );
    if (!known.length) return;
    const before = seen.current ?? read(key) ?? {};
    const moved = known.filter(([k, v]) => k in before && before[k] !== v).map(([k]) => k);
    seen.current = { ...before, ...Object.fromEntries(known) };
    write(key, seen.current);
    if (!moved.length) return;
    setChanged(new Set(moved));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChanged(EMPTY), HIGHLIGHT_MS);
  }, [key, sig]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { roll, changed };
}
