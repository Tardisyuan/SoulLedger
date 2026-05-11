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
  egy: "𓋴 العربية",
};

const LOCALE_COOKIE = "soulledger-locale";
const DEFAULT_LOCALE: Locale = "zh-Hans";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
  hydrated: boolean;
}

const I18nContext = createContext<I18nContextType>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key) => key,
  hydrated: false,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

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
    (key: string, params?: Record<string, string>): string => {
      const parts = key.split(".");
      let value: any = messages[locale];
      for (const part of parts) {
        if (value && typeof value === "object" && part in value) {
          value = value[part];
        } else {
          return key;
        }
      }
      if (typeof value !== "string") return key;
      if (!params) return value;
      return value.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_, p1, p2) => {
        const k = p1 ?? p2;
        return k in params ? params[k] : _;
      });
    },
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, hydrated }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
