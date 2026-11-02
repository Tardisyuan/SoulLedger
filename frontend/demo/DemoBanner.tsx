"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import stats from "@/src/config/landing-stats.json";

/** Sits in the flow above everything, and tells the sticky bars through `--imp-h` (the variable the impersonation strip uses). */
const ROOM = `:root{--imp-h:1.75rem}.min-h-screen{min-height:calc(100vh - 1.75rem)}.min-h-dvh{min-height:calc(100dvh - 1.75rem)}@media (min-width:48rem){.md\\:h-dvh{height:calc(100dvh - 1.75rem)}}`;

export default function DemoBanner() {
  const { t } = useI18n();
  return (
    <>
      <style>{ROOM}</style>
      <div
        data-testid="demo-banner"
        className="sticky top-0 z-toast flex h-7 items-center justify-center gap-3 border-b border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-3 text-xs text-[oklch(var(--color-ink-muted))]"
      >
        <span className="min-w-0 truncate">{t("demo.banner")}</span>
        <a
          data-testid="demo-github"
          href={stats.github}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="flex shrink-0 items-center gap-1 text-[oklch(var(--color-ink))] underline-offset-2 hover:underline"
        >
          {/* lucide dropped its brand icons. */}
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-current">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span className="max-sm:hidden">GitHub</span>
        </a>
      </div>
    </>
  );
}
