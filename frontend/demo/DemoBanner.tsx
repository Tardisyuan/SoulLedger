"use client";

import { useI18n } from "@/src/contexts/I18nContext";

/** Sits in the flow above everything, and tells the sticky bars through `--imp-h` (the variable the impersonation strip uses). */
const ROOM = `:root{--imp-h:1.75rem}.min-h-screen{min-height:calc(100vh - 1.75rem)}.min-h-dvh{min-height:calc(100dvh - 1.75rem)}@media (min-width:48rem){.md\\:h-dvh{height:calc(100dvh - 1.75rem)}}`;

export default function DemoBanner() {
  const { t } = useI18n();
  return (
    <>
      <style>{ROOM}</style>
      <div
        data-testid="demo-banner"
        className="sticky top-0 z-toast flex h-7 items-center justify-center truncate border-b border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-3 text-xs text-[oklch(var(--color-ink-muted))]"
      >
        {t("demo.banner")}
      </div>
    </>
  );
}
