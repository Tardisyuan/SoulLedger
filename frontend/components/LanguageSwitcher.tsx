"use client";

import { useI18n, LOCALE_LABELS, Locale } from "@/src/contexts/I18nContext";

export function LanguageSwitcher() {
  const { locale, setLocale, hydrated } = useI18n();

  if (!hydrated) {
    return (
      <select className="bg-zinc-800 text-zinc-300 text-sm rounded px-3 py-1.5 border border-zinc-600 cursor-pointer">
        <option>—</option>
      </select>
    );
  }

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className="bg-zinc-800 text-zinc-300 text-sm rounded px-3 py-1.5 border border-zinc-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500 hover:border-zinc-500 transition-colors"
    >
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc]}
        </option>
      ))}
    </select>
  );
}
