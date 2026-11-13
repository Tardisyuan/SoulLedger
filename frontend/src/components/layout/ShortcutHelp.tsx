"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useI18n } from "@/src/contexts/I18nContext";
import { setSingleKeyShortcuts, useHotkeys, useRegisteredShortcuts, useSingleKeyShortcuts, type ShortcutRow } from "@/src/lib/hotkeys";
import { isMac } from "./GlobalSearchEntry";

/**
 * 「单字母快捷键」总开关(WCAG 2.1.4)。放在快捷键列表里,也可以单独挂到任何设置区。
 * 状态在本浏览器的 localStorage(见 `lib/hotkeys.ts`)。
 */
export function SingleKeyShortcutsToggle() {
  const { t } = useI18n();
  const on = useSingleKeyShortcuts();
  return (
    <label className="flex items-start gap-2 text-sm text-[oklch(var(--color-ink))]">
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => setSingleKeyShortcuts(e.target.checked)} />
      <span>
        {t("shortcuts.single_keys")}
        <span className="block text-xs text-[oklch(var(--color-ink-muted))]">{t("shortcuts.single_keys_hint")}</span>
      </span>
    </label>
  );
}

/** The list and its modal, out of the shell's bundle (B3, 2026-10-30). */
const ShortcutHelpDialog = dynamic(() => import("./ShortcutHelpDialog"), { ssr: false });

/** 壳自己的快捷键(v4):每一页都有,列在页面登记的那几条后面。标签是已有的文案键。 */
export function shellShortcutRows(mac: boolean): readonly ShortcutRow[] {
  const mod = mac ? "⌘" : "Ctrl ";
  return [
    { key: `${mod}K`, label: "nav.search_hint" },
    { key: `${mod}J`, label: "officer_assist.title" },
  ];
}

const openers = new Set<() => void>();
/** 从命令面板打开这张表(那里每一页都够得着;`?` 仍只在页面登记了快捷键时接,见下)。 */
export function openShortcutHelp(): void {
  openers.forEach((fn) => fn());
}

/**
 * 全局 `?`:列出当前页面登记过的快捷键(`useShortcutHelp`)加壳自己的几条。页面没登记时 `?` 什么都不做 ——
 * 审判队列控制台有自己的键盘映射和 `?`,不登记,也就不会两处同时响应;那时这张表只能从 ⌘K 的指令里打开。
 */
export function ShortcutHelp() {
  const rows = useRegisteredShortcuts();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    openers.add(show);
    return () => void openers.delete(show);
  }, []);
  // The listener lives here, in the shell, so the first `?` opens the list even before its chunk has loaded.
  useHotkeys({ "?": () => setOpen(true) }, rows.length > 0);
  if (!open) return null;
  return <ShortcutHelpDialog rows={[...rows, ...shellShortcutRows(isMac())]} onClose={() => setOpen(false)} />;
}
