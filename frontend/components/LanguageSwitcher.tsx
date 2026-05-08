"use client";

import { useI18n, LOCALE_LABELS, Locale } from "@/src/contexts/I18nContext";

export function LanguageSwitcher() {
  const { locale, setLocale, hydrated } = useI18n();

  return (
    <div className="flex items-center gap-1" suppressHydrationWarning>
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
        <button
          key={loc}
          onClick={() => setLocale(loc)}
          className={`px-3 py-1 rounded text-sm transition-colors ${
            locale === loc && hydrated
              ? "bg-amber-600 text-white"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
        >
          {LOCALE_LABELS[loc]}
        </button>
      ))}
    </div>
  );
}
