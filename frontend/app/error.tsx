"use client";

import { useI18n } from "@/src/contexts/I18nContext";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="text-center">
        <div className="text-8xl font-bold text-red-500 mb-4">500</div>
        <h1 className="text-2xl font-bold text-[hsl(var(--color-ink))] mb-2">{t("error.title")}</h1>
        <p className="text-[hsl(var(--color-ink-muted))] mb-6">{t("error.description")}</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg font-medium hover:opacity-90 transition-opacity mr-3"
        >
          {t("error.retry")}
        </button>
        <a
          href="/"
          className="px-4 py-2 bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))] rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          {t("error.home")}
        </a>
      </div>
    </div>
  );
}
