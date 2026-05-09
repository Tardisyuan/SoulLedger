"use client";

import { useI18n, LOCALE_LABELS, Locale } from "@/src/contexts/I18nContext";

export function LanguageSwitcher() {
  const { locale, setLocale, hydrated } = useI18n();

  if (!hydrated) {
    return (
      <select className="bg-surface-2 text-ink-muted text-sm rounded-md px-3 py-1.5 border border-hairline cursor-pointer">
        <option>—</option>
      </select>
    );
  }

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className="bg-surface-2 text-ink-muted text-sm rounded-md px-3 py-1.5 border border-hairline cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500 hover:border-hairline transition-colors"
    >
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc]}
        </option>
      ))}
    </select>
  );
}
