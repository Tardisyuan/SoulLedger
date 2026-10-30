"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import type { ShortcutRow } from "@/src/lib/hotkeys";
import { SingleKeyShortcutsToggle } from "./ShortcutHelp";

/** The `?` list itself — loaded on first open (`ShortcutHelp` keeps the key listener in the shell). */
export default function ShortcutHelpDialog({ rows, onClose }: { rows: readonly ShortcutRow[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <BaseModal isOpen onClose={onClose} title={t("shortcuts.title")}>
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
