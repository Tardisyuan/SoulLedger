"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import zhMessages from "../../messages/zh-Hans.json";
import enMessages from "../../messages/en.json";
import egyMessages from "../../messages/egy.json";

export type Locale = "zh-Hans" | "en" | "egy";

const messages: Record<Locale, Record<string, unknown>> = {
  "zh-Hans": zhMessages,
  en: enMessages,
  egy: egyMessages,
};

export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-Hans": "简体中文",
  en: "English",
  // Kemet ("the black land") is what ancient Egypt called itself. This label
  // used to read "𓋴 العربية" — literally "Arabic" — which is a language that
  // reached Egypt some 1400 years after the period this locale evokes.
  // The hieroglyph that survived that fix is gone as well: U+132F4 needs a
  // font no default Windows or Linux install ships, and the two labels above
  // it are plain words carrying no glyph at all.
  egy: "Kemet",
};

const LOCALE_COOKIE = "soulledger-locale";
const DEFAULT_LOCALE: Locale = "zh-Hans";

// `egy` is an internal-only pseudo-locale used for the Egyptian civilization
// theme copy. There is no "ancient Egyptian" ICU locale, so number and date
// formatting has to be pointed somewhere real — this map points it at "en".
//
// 这段注释此前写的是「`egy` 不是合法的 BCP-47 标签,直接传给
// Intl.DateTimeFormat/NumberFormat 会抛 RangeError」。**两半都是错的**,而且
// 错的方向让这张表看起来只是个便利。实测(node 18.20.8 / ICU 74.2 与 22.22.1,
// 两个构造器都测):
//   Intl.getCanonicalLocales("egy")        → ["egy"]      合法,三字母语言子标签
//   new Intl.DateTimeFormat("egy")         → 不抛
//   new Intl.NumberFormat("egy")           → 不抛
//   new Intl.DateTimeFormat("e_gy")        → 才抛 RangeError(真正畸形的标签)
//
// 真实行为比抛错糟:没有 `egy` 的 ICU 数据时,它回退到**观看者的系统默认区域**,
// 不是 "en"。同一段代码在不同机器上实测:
//   LANG=de-DE → 解析为 de-DE,日期渲染 "1. Januar 1970"
//   LANG=zh-CN → 解析为 zh-CN,日期渲染 "1970年1月1日"
//   LANG=ja-JP → 解析为 ja-JP
//
// 也就是说,没有这张表,一个 egy 界面的日期会跟着**用户的操作系统**变语言,
// 而不是跟着界面语言 —— 一个只在别人机器上出现的 bug。这张表不是便利,
// 它是唯一挡住这件事的东西。`docs/design-handoff/tables/README.md` 也照抄了
// 那个 RangeError 的说法,已一并更正。
const INTL_LOCALE: Record<Locale, string> = {
  "zh-Hans": "zh-Hans",
  en: "en",
  egy: "en",
};

function toIntlLocale(locale: Locale): string {
  return INTL_LOCALE[locale];
}

type DateInput = Date | string | number;

function formatDateWith(locale: Locale, value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(toIntlLocale(locale), options).format(date);
}

// Intl rejects dateStyle/timeStyle mixed with individual component options
// (year, hour, ...) — it throws RangeError rather than letting one win. So the
// medium/medium default below has to be dropped entirely as soon as the caller
// asks for components, instead of being spread under them.
const DATE_COMPONENT_KEYS = [
  "weekday", "era", "year", "month", "day",
  "hour", "minute", "second", "dayPeriod",
  "fractionalSecondDigits", "timeZoneName",
] as const;

function hasComponentOptions(options?: Intl.DateTimeFormatOptions): boolean {
  if (!options) return false;
  return DATE_COMPONENT_KEYS.some((k) => options[k] !== undefined);
}

function formatDateTimeWith(locale: Locale, value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  const resolved: Intl.DateTimeFormatOptions = hasComponentOptions(options)
    ? { ...options }
    : { dateStyle: "medium", timeStyle: "medium", ...options };
  return new Intl.DateTimeFormat(toIntlLocale(locale), resolved).format(date);
}

function formatNumberWith(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(toIntlLocale(locale), options).format(value);
}

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
  hydrated: boolean;
  /** Locale-aware date formatting (maps `egy` -> `en` for Intl, see INTL_LOCALE above). */
  formatDate: (value: DateInput, options?: Intl.DateTimeFormatOptions) => string;
  /** Locale-aware date+time formatting; defaults to medium date + medium time style. */
  formatDateTime: (value: DateInput, options?: Intl.DateTimeFormatOptions) => string;
  /** Locale-aware number formatting. */
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key) => key,
  hydrated: false,
  formatDate: (value, options) => formatDateWith(DEFAULT_LOCALE, value, options),
  formatDateTime: (value, options) => formatDateTimeWith(DEFAULT_LOCALE, value, options),
  formatNumber: (value, options) => formatNumberWith(DEFAULT_LOCALE, value, options),
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
      const lookup = (bundle: Record<string, unknown>): string | null => {
        let value: unknown = bundle;
        for (const part of parts) {
          if (value && typeof value === "object" && part in (value as Record<string, unknown>)) {
            value = (value as Record<string, unknown>)[part];
          } else {
            return null;
          }
        }
        return typeof value === "string" ? value : null;
      };
      // Fall back to the default locale before giving up, so a bundle that is
      // only partially translated shows real copy instead of a raw key.
      const value = lookup(messages[locale]) ?? lookup(messages[DEFAULT_LOCALE]);
      if (value === null) return key;
      if (!params) return value;
      return value.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_, p1, p2) => {
        const k = p1 ?? p2;
        return k in params ? params[k] : _;
      });
    },
    [locale]
  );

  const formatDate = useCallback(
    (value: DateInput, options?: Intl.DateTimeFormatOptions) => formatDateWith(locale, value, options),
    [locale]
  );

  const formatDateTime = useCallback(
    (value: DateInput, options?: Intl.DateTimeFormatOptions) => formatDateTimeWith(locale, value, options),
    [locale]
  );

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) => formatNumberWith(locale, value, options),
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, hydrated, formatDate, formatDateTime, formatNumber }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
