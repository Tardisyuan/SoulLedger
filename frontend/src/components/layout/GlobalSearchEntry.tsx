"use client";

import { useEffect, type Ref } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * The two 全局搜索 entry buttons (1440: a 240-wide search-box-shaped button with the ⌘K keycap; ≤ 768: a 44 icon),
 * in their own module so the shell can draw them before the search dialog's chunk arrives (B3, 2026-10-30:
 * `GlobalSearch` is loaded with `next/dynamic`, and this file is what `AppLayout` shows meanwhile).
 *
 * A press before the chunk lands is not lost: the placeholder records it in `pendingOpen` (a click on either button,
 * or ⌘K / Ctrl K anywhere) and `GlobalSearch` opens itself on mount when `takePendingOpen()` says so.
 */
let pendingOpen: "desktop" | "mobile" | "key" | null = null;

/** The press that happened before `GlobalSearch` mounted, cleared on read. */
export function takePendingOpen(): typeof pendingOpen {
  const p = pendingOpen;
  pendingOpen = null;
  return p;
}

/** ⌘K / Ctrl K, the modifier combination both the placeholder and the real search listen for. */
export function isSearchShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !e.isComposing && e.key.toLowerCase() === "k";
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MUTED = "text-[oklch(var(--color-ink-muted))]";
const LINE_STRONG = "border-[oklch(var(--color-line-strong))]";
const KEYCAP = `border ${LINE_STRONG} px-[6px] font-mono text-xs ${MUTED}`;

export function GlobalSearchEntries({
  onOpen,
  desktopRef,
  mobileRef,
}: {
  onOpen: (from: HTMLButtonElement, which: "desktop" | "mobile") => void;
  desktopRef?: Ref<HTMLButtonElement>;
  mobileRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useI18n();
  return (
    <>
      <button
        ref={desktopRef}
        type="button"
        data-testid="global-search-entry"
        onClick={(e) => onOpen(e.currentTarget, "desktop")}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className={`hidden h-9 w-60 shrink-0 items-center gap-2 border ${LINE_STRONG} rounded-(--radius-control) bg-[oklch(var(--color-surface-1))] px-3 text-sm text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))] min-[769px]:flex`}
      >
        <Search aria-hidden="true" size={16} strokeWidth={1.5} />
        <span className="flex-1 text-left">{t("search.aria_label")}</span>
        <kbd className={KEYCAP}>{isMac() ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <button
        ref={mobileRef}
        type="button"
        data-testid="global-search-entry-mobile"
        onClick={(e) => onOpen(e.currentTarget, "mobile")}
        aria-haspopup="dialog"
        aria-label={t("search.aria_label")}
        className={`flex h-11 w-11 shrink-0 items-center justify-center ${MUTED} hover:text-[oklch(var(--color-ink))] min-[769px]:hidden`}
      >
        <Search aria-hidden="true" size={20} strokeWidth={1.5} />
      </button>
    </>
  );
}

/** What the shell draws until `GlobalSearch` has loaded: the same buttons, remembering a press for it. */
export function GlobalSearchPlaceholder() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      pendingOpen = "key";
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <GlobalSearchEntries onOpen={(_from, which) => (pendingOpen = which)} />;
}
