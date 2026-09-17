import { BCP47_FOR_LOCALE, DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "@soulledger/core/config/locale";
import { resolveEnumDisplay, type EnumDisplay } from "@soulledger/core/domain/enumDisplay";
import egy from "@soulledger/core/messages/egy.json";
import en from "@soulledger/core/messages/en.json";
import zh from "@soulledger/core/messages/zh-Hans.json";
import { platform } from "@soulledger/core/platform";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const BUNDLES: Record<Locale, unknown> = { "zh-Hans": zh, en, egy };

function lookup(bundle: unknown, key: string): string | undefined {
  let node = bundle;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Same contract as the web's `t`: a miss in the active bundle falls back to
 * the default locale, a miss everywhere echoes the key (which is what
 * `resolveEnumDisplay` detects), and `{{name}}` placeholders are filled.
 */
export function translate(locale: Locale, key: string, params?: Record<string, string>): string {
  const value = lookup(BUNDLES[locale], key) ?? lookup(BUNDLES[DEFAULT_LOCALE], key);
  if (value === undefined) return key;
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => (name in params ? params[name] : whole));
}

export function formatDateTime(iso: string | null | undefined, locale: Locale): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(BCP47_FOR_LOCALE[locale], { year: "numeric", month: "short", day: "numeric" });
}

interface I18n {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
  enumLabel: (namespace: string, raw: string | null | undefined) => EnumDisplay;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = platform().persistent.get(LOCALE_COOKIE);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  });
  const setLocale = useCallback((next: Locale) => {
    platform().persistent.set(LOCALE_COOKIE, next);
    setLocaleState(next);
  }, []);
  const value = useMemo<I18n>(() => {
    const t = (key: string, params?: Record<string, string>) => translate(locale, key, params);
    return { locale, setLocale, t, enumLabel: (ns, raw) => resolveEnumDisplay(t, ns, raw) };
  }, [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n outside I18nProvider");
  return value;
}
