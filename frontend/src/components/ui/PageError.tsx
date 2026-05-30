"use client";

import { useI18n } from "@/src/contexts/I18nContext";

interface PageErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function PageError({ error, reset }: PageErrorProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-6xl font-bold text-[hsl(var(--color-status-error))] mb-4">!</div>
        <h2 className="text-xl font-bold text-[hsl(var(--color-ink))] mb-2">
          {t("error.title") || "Something went wrong"}
        </h2>
        <p className="text-[hsl(var(--color-ink-muted))] mb-4 text-sm">
          {error.message || t("error.description")}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("error.retry") || "Try again"}
        </button>
      </div>
    </div>
  );
}
