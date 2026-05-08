"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import zhMessages from "../../messages/zh-Hans.json";
import enMessages from "../../messages/en.json";
import egyMessages from "../../messages/egy.json";

export type Locale = "zh-Hans" | "en" | "egy";

const messages: Record<Locale, Record<string, any>> = {
  "zh-Hans": zhMessages,
  en: enMessages,
  egy: egyMessages,
};

export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-Hans": "简体中文",
  en: "English",
  egy: "𓇳𓏏𓁹",
};

const LOCALE_COOKIE = "soulledger-locale";
const DEFAULT_LOCALE: Locale = "zh-Hans";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  hydrated: boolean;
}

const I18nContext = createContext<I18nContextType>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key) => key,
  hydrated: false,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Start with default locale to match server render (avoids hydration mismatch)
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  // Read locale from cookie on mount (client only)
  useEffect(() => {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${LOCALE_COOKIE}=`));
    const saved = match?.split("=")[1] as Locale;
    if (saved && messages[saved]) {
      setLocaleState(saved);
    }
    setHydrated(true);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
  }, []);

  const t = useCallback(
    (key: string): string => {
      if (!hydrated) return key;
      const parts = key.split(".");
      let value: any = messages[locale];
      for (const part of parts) {
        if (value && typeof value === "object" && part in value) {
          value = value[part];
        } else {
          return key;
        }
      }
      return typeof value === "string" ? value : key;
    },
    [locale, hydrated]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, hydrated }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
