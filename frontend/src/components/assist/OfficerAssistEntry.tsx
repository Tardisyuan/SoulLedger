"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import type { OfficerAssist } from "./useOfficerAssist";

/**
 * 1b: the toolbar's 问一问 button — its own module so the shell can draw it while the panel (`OfficerAssist.tsx`)
 * arrives by `next/dynamic` (B3, 2026-10-30). The open state and ⌘J live in `useOfficerAssist`, also in the shell,
 * so neither a click nor the shortcut waits on the panel's chunk.
 */

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function AskIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2" width="16" height="16" />
      <path d="M7.6 7.4a2.4 2.4 0 1 1 3.6 2.1c-.8.5-1.2 1-1.2 1.9v.5M10 14.6h.01" strokeLinecap="square" />
    </svg>
  );
}

/** 1b: first in the toolbar's action group (规范 v3 工具条:44×44、中性 ink-muted,悬停 / 打开时 canvas 底). */
export function OfficerAssistEntry({ assist }: { assist: OfficerAssist }) {
  const { t } = useI18n();
  if (!assist.visible) return null;
  const shortcut = isMac() ? "⌘J" : "Ctrl+J";
  return (
    <button
      ref={assist.entryRef}
      type="button"
      data-testid="officer-assist-entry"
      onClick={assist.toggle}
      aria-expanded={assist.open}
      aria-label={t("officer_assist.entry_label", { shortcut })}
      title={shortcut}
      className="relative flex min-h-11 min-w-11 items-center justify-center gap-1 px-2 text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-canvas))] hover:text-[oklch(var(--color-ink))] aria-expanded:bg-[oklch(var(--color-canvas))] aria-expanded:text-[oklch(var(--color-ink))] max-lg:px-0"
    >
      <AskIcon />
      <span className="hidden lg:inline">{t("officer_assist.entry")}</span>
      {assist.unseen ? (
        <span data-testid="officer-assist-unseen" aria-hidden="true" className="absolute right-2 top-2 h-1.5 w-1.5 bg-[oklch(var(--color-ink))]" />
      ) : null}
    </button>
  );
}
