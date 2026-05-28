"use client";

import { useI18n } from "@/src/contexts/I18nContext";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] flex items-center justify-center">
      <div className="text-center">
        <div className="text-8xl font-bold text-[hsl(var(--color-accent))] mb-4">404</div>
        <h1 className="text-2xl font-bold text-[hsl(var(--color-ink))] mb-2">{t("not_found.title")}</h1>
        <p className="text-[hsl(var(--color-ink-muted))] mb-6">{t("not_found.description")}</p>
        <a
          href="/"
          className="px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          {t("not_found.home")}
        </a>
      </div>
    </div>
  );
}
