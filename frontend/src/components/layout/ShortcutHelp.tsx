"use client";

import { useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { setSingleKeyShortcuts, useHotkeys, useRegisteredShortcuts, useSingleKeyShortcuts } from "@/src/lib/hotkeys";

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

/**
 * 全局 `?`:列出当前页面登记过的快捷键(`useShortcutHelp`)。页面没登记就什么都不做 ——
 * 审判队列控制台有自己的键盘映射和 `?`,不登记,也就不会两处同时响应。
 */
export function ShortcutHelp() {
  const { t } = useI18n();
  const rows = useRegisteredShortcuts();
  const [open, setOpen] = useState(false);
  useHotkeys({ "?": () => setOpen(true) }, rows.length > 0);
  if (!open || rows.length === 0) return null;
  return (
    <BaseModal isOpen onClose={() => setOpen(false)} title={t("shortcuts.title")}>
      <dl className="space-y-1">
        {rows.map(({ key, label }) => (
          <div key={`${key}-${label}`} className="flex items-baseline gap-3 text-sm">
            <dt className="min-w-[8ch] font-mono text-xs text-[oklch(var(--color-ink))]">{key}</dt>
            <dd className="text-[oklch(var(--color-ink-muted))]">{t(label)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 border-t border-[oklch(var(--color-line))] pt-3">
        <SingleKeyShortcutsToggle />
      </div>
    </BaseModal>
  );
}
