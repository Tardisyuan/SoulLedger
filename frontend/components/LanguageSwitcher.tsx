"use client";

import { useI18n, LOCALE_LABELS, Locale } from "@/src/contexts/I18nContext";

export function LanguageSwitcher() {
  const { locale, setLocale, hydrated, t } = useI18n();

  if (!hydrated) {
    // Placeholder for the pre-hydration render. Disabled so it can't be
    // operated before setLocale is wired up, and hidden from assistive tech
    // since the real control replaces it a tick later.
    return (
      <select
        disabled
        aria-hidden="true"
        tabIndex={-1}
        className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] text-sm px-3 py-1.5 border border-[hsl(var(--color-hairline))] cursor-pointer"
      >
        <option>—</option>
      </select>
    );
  }

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label={t("nav.language")}
      className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] text-sm px-3 py-1.5 border border-[hsl(var(--color-hairline))] cursor-pointer hover:border-[hsl(var(--color-hairline))] transition-colors"
    >
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc]}
        </option>
      ))}
    </select>
  );
}
