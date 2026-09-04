"use client";

import {
  DEFAULT_LOCALE,
  BCP47_FOR_LOCALE as HTML_LANG_MAP,
  isLocale as isLocaleGuard,
  type Locale,
  LOCALE_COOKIE as LOCALE_COOKIE_NAME,
} from "@soulledger/core/config/locale";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import defaultMessages from "@soulledger/core/messages/zh-Hans.json";
import { publishTranslator } from "@/lib/i18n/activeTranslator";

// Locale 的类型与常量在 src/config/locale.ts —— 那个模块不带 "use client",
// 所以服务端的 app/layout.tsx 也能 import。这里 re-export 是为了不打断既有引用。
export type { Locale } from "@soulledger/core/config/locale";
export { isLocale, LOCALE_COOKIE } from "@soulledger/core/config/locale";

type Bundle = Record<string, unknown>;

/**
 * Only the default bundle is static. The others arrive when they are asked for.
 *
 * All three were `import`ed eagerly, and `I18nProvider` wraps the root layout,
 * so every route shipped and parsed all of them: 47.7KB gzipped (zh-Hans 17.4,
 * en 16.3, egy 14.0) of which two thirds is dead weight for any given reader.
 *
 * WHY THE DEFAULT CANNOT BE LAZY. `t()` falls back to `DEFAULT_LOCALE` for any
 * key the active bundle is missing, which is what keeps a partially translated
 * locale showing real copy instead of raw keys. That fallback has to be
 * resident. So this is three-to-one for a zh-Hans reader and three-to-two for
 * the others, not three-to-one for everybody.
 *
 * THE COST, STATED PLAINLY. Between first paint and the chunk arriving, an
 * `en` or `egy` reader sees the default bundle's copy — Chinese — through the
 * same fallback path a missing key already takes. It is a flash, not a
 * failure, and it is the price of not blocking first paint on a fetch. The
 * alternative (hold `children` until the bundle lands) trades a flash for a
 * delay; this one was chosen deliberately.
 */
const LAZY_BUNDLES: Record<string, () => Promise<unknown>> = {
  en: () => import("@soulledger/core/messages/en.json"),
  egy: () => import("@soulledger/core/messages/egy.json"),
};

/**
 * `mod.default ?? mod`, and it is not defensive padding.
 *
 * A dynamic `import()` of JSON resolves to `{ default: … }` under the app's
 * ESM build and, under ts-jest's CommonJS transform, to the object itself.
 * Reading only `.default` made every switching test return the fallback copy
 * — the bundle arrived and was stored as `undefined`. Both shapes are real
 * here, so both are handled.
 */
function unwrapBundle(mod: unknown): Bundle {
  const m = mod as { default?: Bundle };
  return (m && typeof m === "object" && m.default ? m.default : (mod as Bundle));
}

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

/** What a formatter shows when it was handed something it cannot read.
 *
 * Not an empty string: a blank cell says "this record has no date", which is a
 * claim about the data. An em dash says "nothing renderable here", which is a
 * claim about this cell.
 */
const UNRENDERABLE_DATE = "—";

/** `Intl.DateTimeFormat.format` throws `RangeError: Invalid time value` on an
 * unparseable date, and neither formatter caught it.
 *
 * Measured 2026-08-29: opening `/judgment/{id}` with a payload whose date key
 * did not match the serializer's put `undefined` through here, and the
 * `RangeError` propagated out of a render into the route's error boundary --
 * the entire page became "服务器错误 / Invalid time value". One bad timestamp
 * in one field took out everything around it, including the parts that had
 * nothing to do with dates.
 *
 * That particular undefined came from a fixture and is fixed at the source.
 * The guard stays because the input is a wire value: a null column, a
 * half-migrated row or a field renamed on the backend all arrive the same way,
 * and none of them should be able to blank a screen.
 */
function safeFormat(
  format: () => string,
  value: DateInput
): string {
  // Each input type has to be tested the way `new Date()` reads it. My first
  // version ran `Date.parse(String(value))` for everything, which turns a
  // perfectly good epoch-millisecond number into a NaN -- the existing
  // "accepts string and number inputs" test went red on it immediately.
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  if (!Number.isFinite(time)) return UNRENDERABLE_DATE;
  try {
    return format();
  } catch {
    // Reached only if Intl rejects the *options*, which is a programming
    // error rather than bad data -- but a wrong option should still not take
    // the page down with it.
    return UNRENDERABLE_DATE;
  }
}

function formatDateWith(locale: Locale, value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return safeFormat(
    () => new Intl.DateTimeFormat(toIntlLocale(locale), options).format(date),
    value
  );
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
  return safeFormat(
    () => new Intl.DateTimeFormat(toIntlLocale(locale), resolved).format(date),
    value
  );
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
}

/* THERE WAS A `formatNumber` HERE, AND NOTHING EVER CALLED IT.
 *
 * Measured across every git-tracked source file under `frontend/` and
 * `packages/`, comments stripped first: `t` 129 destructuring sites,
 * `formatDateTime` 15, `formatDate` 7, `locale` 4, `setLocale` 1, `hydrated` 1,
 * `formatNumber` **0**. Every occurrence of the name was its own declaration,
 * its own test (`I18nContext.formatters.test.tsx`), or a `useI18n` double in an
 * unrelated suite. `Intl.NumberFormat` appears nowhere else in the tree either,
 * so this was not shadowed by someone rolling their own — the app formats no
 * numbers by locale at all.
 *
 * It was dead surface held up by a test that asserted it existed, which is a
 * shape worth naming: a test can keep an API alive indefinitely without a
 * single caller, and the suite reports that as coverage.
 *
 * Not a platform-boundary decision. `Intl.NumberFormat` exists in React Native's
 * Hermes and this would have ported unchanged; it was removed for being unused,
 * and should come back the moment something needs it — `formatDateWith` above is
 * the pattern.
 */

const I18nContext = createContext<I18nContextType>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key) => key,
  hydrated: false,
  formatDate: (value, options) => formatDateWith(DEFAULT_LOCALE, value, options),
  formatDateTime: (value, options) => formatDateTimeWith(DEFAULT_LOCALE, value, options),
});

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  /** 服务端从 cookie 读到的 locale。
   *
   * 有了它,首帧的 `<html lang>` 与首帧的文案出自同一个值。此前服务端固定渲染
   * `zh-Hans`、客户端 mount 后再从 cookie 纠正,于是一个 en 用户的首帧是中文,
   * 而 `<html lang>` 永远停在 zh-Hans —— 文案会自愈,lang 不会。 */
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(initialLocale !== undefined);
  const [loadedBundles, setLoadedBundles] = useState<Partial<Record<Locale, Bundle>>>({});

  // Fetch the active bundle if it is not the default and not already here.
  // Cancelled on unmount/locale change so a slow chunk cannot overwrite a
  // newer choice.
  useEffect(() => {
    const loader = LAZY_BUNDLES[locale];
    if (!loader || loadedBundles[locale]) return;
    let cancelled = false;
    loader()
      .then((mod) => {
        if (!cancelled) setLoadedBundles((prev) => ({ ...prev, [locale]: unwrapBundle(mod) }));
      })
      .catch((err) => {
        // Not fatal: `t()` keeps answering from the default bundle. Logged
        // rather than toasted — the reader can see the language is wrong and
        // has no action to take about a failed chunk fetch.
        console.error(`[i18n] failed to load the "${locale}" bundle`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, loadedBundles]);

  useEffect(() => {
    // 服务端已经给了值就不必再读 cookie —— 两者同源,重读只会多一次渲染。
    if (initialLocale !== undefined) return;
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${LOCALE_COOKIE_NAME}=`));
    const saved = match?.split("=")[1];
    // `isLocale`, not "is there a bundle for it" — the bundles are no longer
    // all resident, so their presence stopped being a membership test.
    if (isLocaleGuard(saved)) {
      setLocaleState(saved);
    }
    setHydrated(true);
  }, [initialLocale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    document.cookie = `${LOCALE_COOKIE_NAME}=${newLocale};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
    // 切语言不刷新页面(AGENTS.md 明确要求),所以服务端渲染的 `lang` 不会重算 ——
    // 这里必须自己同步,否则切到 en 之后 `<html lang>` 仍是 zh-Hans。
    document.documentElement.lang = HTML_LANG_MAP[newLocale];
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
      const active = locale === DEFAULT_LOCALE ? defaultMessages : loadedBundles[locale];
      // `?? lookup(defaultMessages)` is doing two jobs now: the original one
      // (a key missing from a partial translation) and covering the window
      // before a lazy bundle has arrived.
      const value = (active ? lookup(active as Bundle) : null) ?? lookup(defaultMessages);
      if (value === null) return key;
      if (!params) return value;
      return value.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_, p1, p2) => {
        const k = p1 ?? p2;
        return k in params ? params[k] : _;
      });
    },
    // `loadedBundles` belongs here. Without it the memoised `t` closes over the
    // bundle map as it was when the locale changed — which is empty, since the
    // chunk has not arrived yet — so it kept answering from the default bundle
    // forever. Visible as: switching language does nothing until you navigate.
    [locale, loadedBundles]
  );

  // Hand `t` to the one reader that cannot use a hook: the platform adapter's
  // `notify`, which is given a message key by code in `@soulledger/core` and
  // has to turn it into words outside any component. See
  // `lib/i18n/activeTranslator.ts` for why it holds this function rather than
  // keeping a second lookup of its own.
  useEffect(() => {
    publishTranslator(t);
    return () => publishTranslator(null);
  }, [t]);

  const formatDate = useCallback(
    (value: DateInput, options?: Intl.DateTimeFormatOptions) => formatDateWith(locale, value, options),
    [locale]
  );

  const formatDateTime = useCallback(
    (value: DateInput, options?: Intl.DateTimeFormatOptions) => formatDateTimeWith(locale, value, options),
    [locale]
  );

  // Every member here is already stable on its own — `setLocale` is
  // `useCallback([])`, `t` moves only with `locale`/`loadedBundles`, and the two
  // formatters move only with `locale` — so this memo is not wrapping a bag of
  // functions that churn underneath it. It is the object literal itself that
  // was new on every render.
  const value = useMemo(
    () => ({ locale, setLocale, t, hydrated, formatDate, formatDateTime }),
    [locale, setLocale, t, hydrated, formatDate, formatDateTime]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
