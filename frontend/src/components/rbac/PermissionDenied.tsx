"use client";

import { useI18n } from "@/src/contexts/I18nContext";

export function PermissionDenied() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
      <div className="text-6xl mb-4">🔒</div>
      <h1 className="text-2xl font-bold text-[hsl(var(--color-ink))] mb-2">{t("permission.denied_title")}</h1>
      <p className="text-[hsl(var(--color-ink-muted))]">
        {t("permission.denied_message")}
      </p>
    </div>
  );
}
