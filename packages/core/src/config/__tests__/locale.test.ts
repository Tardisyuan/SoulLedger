import { describe, expect, it } from "vitest";

import {
  BCP47_FOR_LOCALE,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  isLocale,
  type Locale,
} from "../locale";

/**
 * The locale constants, and the two agreements between them that nothing else
 * holds.
 *
 * WHY NOW. `HTML_LANG` was renamed to `BCP47_FOR_LOCALE` — the table is named
 * for an HTML attribute inside a package that has no HTML, while its *content*
 * (`egy → en`, so a screen reader is not asked to pronounce an interface it
 * has no rules for) is platform-independent and maps straight onto React
 * Native's `accessibilityLanguage`. Moving a thing is the moment to notice it
 * had no test at all: this module is imported by `middleware.ts`,
 * `app/layout.tsx` and `I18nContext.tsx`, and everything asserted below was
 * previously held by nothing but the reading of it.
 *
 * `frontend/src/__tests__/middlewareAuthGate.test.ts` covers what the
 * *middleware* does with these values. This covers the values.
 */

describe("BCP47_FOR_LOCALE", () => {
  it("declares egy as English, because that is the language of the text", () => {
    // The `egy` bundle is an English draft with terminology substituted
    // (messages/egy.json). A page tagged `lang="egy"` asks a screen reader for
    // pronunciation rules for Egyptian, which it does not have and would fall
    // back from — silently, and only for the readers who most depend on it.
    expect(BCP47_FOR_LOCALE.egy).toBe("en");
    // Assert the absence as well as the presence: the failure this guards
    // against is the identity mapping, which looks right in a diff.
    expect(BCP47_FOR_LOCALE.egy).not.toBe("egy");
  });

  it("passes the other two through unchanged", () => {
    expect(BCP47_FOR_LOCALE["zh-Hans"]).toBe("zh-Hans");
    expect(BCP47_FOR_LOCALE.en).toBe("en");
  });

  it("answers for every supported locale and for nothing else", () => {
    // `Record<Locale, string>` makes a missing key a compile error, so this is
    // the half tsc cannot do: an *extra* key, left behind by a locale that was
    // removed from `SUPPORTED_LOCALES` but not from here.
    expect(Object.keys(BCP47_FOR_LOCALE).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("emits only tags whose language the reader is actually given text in", () => {
    // The rule the table encodes, stated as a rule rather than as three rows:
    // a value must be a language the app has a bundle for. `egy` is a real
    // ISO 639-3 code, so "is it well-formed" would pass the exact mistake this
    // file exists to prevent.
    const readableLanguages = ["zh-Hans", "en"];
    for (const locale of SUPPORTED_LOCALES) {
      expect(readableLanguages, `${locale} maps to a tag nothing is written in`).toContain(
        BCP47_FOR_LOCALE[locale],
      );
    }
  });

});

describe("isLocale", () => {
  /**
   * `isLocale` is a hand-written disjunction of three string literals and
   * `SUPPORTED_LOCALES` is a hand-written array of the same three. Two lists,
   * with nothing between them: adding a fourth civilisation's locale to one and
   * not the other type-checks, lints and builds. The guard is what `middleware.ts`
   * uses to decide whether a cookie value is safe to write back, so the half
   * that matters is the second assertion.
   */
  it("accepts exactly the supported locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isLocale(locale), `${locale} is supported but the guard rejects it`).toBe(true);
    }
  });

  it("rejects everything else, including the near-misses", () => {
    const notLocales = ["", "zh", "zh-Hant", "ZH-HANS", "en-US", "eg", "egyptian", "../../etc/passwd"];
    for (const value of notLocales) {
      expect(isLocale(value), `the guard accepts ${JSON.stringify(value)}`).toBe(false);
    }
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("accepts the default locale — which is otherwise only a type", () => {
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });
});

describe("LOCALE_COOKIE", () => {
  /**
   * The name keeps `COOKIE` in it, and the argument for that is over the
   * declaration in ../locale.ts. It is not restated as a test here, and the
   * reason is worth writing down: "this package never reads or writes a cookie"
   * is already enforced, by `platform/__tests__/domBoundary.test.ts` and the
   * `lib: ["ES2020"]` narrowing behind it — `document` does not resolve in this
   * package at all. A second check asserting the same thing from this file
   * would be one of the checks that can never fire, which is the failure this
   * repository keeps recording.
   */
  it("is the name the middleware and the layout both read", () => {
    // A literal, deliberately. The value is written into a browser cookie by
    // one module and read by two others; a test that recomputed it from the
    // same export would agree with any value at all.
    expect(LOCALE_COOKIE).toBe("soulledger-locale");
  });
});

/** The table cannot quietly change shape: a compile error here is the point,
 *  and `Locale` is imported for it. */
const _tableShape: Record<Locale, string> = BCP47_FOR_LOCALE;
void _tableShape;
