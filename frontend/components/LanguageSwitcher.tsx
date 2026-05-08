"use client";

import { useI18n, LOCALE_LABELS, Locale } from "@/src/contexts/I18nContext";

export function LanguageSwitcher() {
  const { locale, setLocale, hydrated } = useI18n();

  if (!hydrated) {
    return (
      <select className="bg-slate-800 text-slate-300 text-sm rounded px-3 py-1.5 border border-slate-600">
        <option>—</option>
      </select>
    );
  }

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className="bg-slate-800 text-white text-sm rounded px-3 py-1.5 border border-slate-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500"
    >
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc]}
        </option>
      ))}
    </select>
  );
}
