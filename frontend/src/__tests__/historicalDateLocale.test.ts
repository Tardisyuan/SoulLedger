/**
 * `formatHistoricalDate` writes the month name itself, in the caller's locale.
 *
 * WHY THIS FILE EXISTS. The month came from
 * `new Date(2000, month - 1).toLocaleString("en", { month: "long" })` — the
 * locale hardcoded to English inside a package whose `DEFAULT_LOCALE` is
 * `zh-Hans` and which ships `zh-Hans`, `en` and `egy` bundles. A Chinese-locale
 * user read `1066 CE · March 15`. Nothing in the frontend suites or the
 * cross-tree contract tests named a month, so this was unexamined behaviour
 * rather than pinned behaviour, and a fix would have been indistinguishable
 * from a regression.
 *
 * Presence AND absence, on purpose. "the Chinese month is shown" stays true
 * while an English one sits beside it, and the defect being closed here is
 * precisely an English month appearing where it should not.
 */
import { formatHistoricalDate } from "@soulledger/core/domain/dates";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@soulledger/core/config/locale";

const CRUCIFIXION = { year: 1066, month: 3, day: 15 };

describe("the default locale is not English", () => {
  it("is zh-Hans, which is what makes the assertions below mean anything", () => {
    // If the package default ever becomes `en`, every "no English month"
    // assertion here turns into a claim about a locale nobody defaults to.
    expect(DEFAULT_LOCALE).toBe("zh-Hans");
  });

  it("renders a Chinese month for a caller that passes no locale", () => {
    expect(formatHistoricalDate(CRUCIFIXION)).toBe("1066 CE · 3月15日");
  });

  it("renders no English month for a caller that passes no locale", () => {
    expect(formatHistoricalDate(CRUCIFIXION)).not.toContain("March");
    expect(formatHistoricalDate({ year: -44, month: 3, day: null })).not.toContain("March");
  });

  it("agrees with an explicit DEFAULT_LOCALE", () => {
    expect(formatHistoricalDate(CRUCIFIXION)).toBe(formatHistoricalDate(CRUCIFIXION, DEFAULT_LOCALE));
  });
});

describe("each locale gets its own month name", () => {
  it("en", () => {
    expect(formatHistoricalDate(CRUCIFIXION, "en")).toBe("1066 CE · March 15");
    expect(formatHistoricalDate({ year: -44, month: 3, day: 15 }, "en")).toBe("44 BCE · March 15");
  });

  it("zh-Hans", () => {
    expect(formatHistoricalDate({ year: -44, month: 3, day: 15 }, "zh-Hans")).toBe("44 BCE · 3月15日");
  });

  it("egy reuses the English names, the way BCP47_FOR_LOCALE and INTL_LOCALE do", () => {
    // `messages/egy.json` carries no month names — it is an English base with
    // the Egyptian terminology substituted in. Asserted rather than assumed so
    // that a real civil-calendar month list arriving one day is a deliberate
    // edit here, not a silent divergence.
    expect(formatHistoricalDate(CRUCIFIXION, "egy")).toBe(formatHistoricalDate(CRUCIFIXION, "en"));
  });

  it("has a month name for every supported locale and every month", () => {
    // The floor for the two lists above: a locale added to SUPPORTED_LOCALES
    // without a row in the month table, or a table row of the wrong length,
    // would leave those assertions green while some month rendered as the year
    // alone.
    expect(SUPPORTED_LOCALES.length).toBe(3);
    for (const locale of SUPPORTED_LOCALES) {
      for (let month = 1; month <= 12; month += 1) {
        const out = formatHistoricalDate({ year: 1066, month, day: null }, locale);
        expect(out).toMatch(/^1066 CE · .+$/);
      }
    }
  });
});

describe("no Intl, so no ICU-less runtime can change the answer", () => {
  it("does not call Date.prototype.toLocaleString", () => {
    // The second half of the original defect: on a React Native Android build
    // without full ICU, `toLocaleString` ignores the options bag and returns
    // the whole date, rendering `1066 CE · Wed Mar 01 2000 15`. That cannot be
    // reproduced in jsdom, so the guard is that the function no longer reaches
    // for the API at all.
    const spy = jest.spyOn(Date.prototype, "toLocaleString");
    formatHistoricalDate(CRUCIFIXION, "en");
    formatHistoricalDate(CRUCIFIXION);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("months outside 1-12", () => {
  it("fall back to the year rather than rolling over or printing undefined", () => {
    // `new Date(2000, 12)` was January of the following year, so month 13
    // used to render as "January".
    expect(formatHistoricalDate({ year: 1066, month: 13, day: null })).toBe("1066 CE");
    expect(formatHistoricalDate({ year: 1066, month: 0, day: 5 })).toBe("1066 CE");
  });
});

describe("the year half is untouched", () => {
  it("still writes BCE/CE and omits an absent month", () => {
    expect(formatHistoricalDate({ year: 1066, month: null, day: null })).toBe("1066 CE");
    expect(formatHistoricalDate({ year: -44, month: null, day: null })).toBe("44 BCE");
    expect(formatHistoricalDate({ year: 0, month: null, day: null })).toBe("0 BCE");
    expect(formatHistoricalDate(null)).toBeNull();
    expect(formatHistoricalDate(undefined)).toBeNull();
  });
});
