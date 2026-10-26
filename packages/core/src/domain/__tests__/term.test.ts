import { describe, expect, it } from "vitest";

import { daysLeft, historicalDateMs, termFraction } from "../term";

const NOW = Date.parse("2026-10-09T12:00:00Z");

describe("historicalDateMs: no year 0", () => {
  it("CE is the plain UTC date", () => {
    expect(historicalDateMs({ year: 2026, month: 10, day: 9 })).toBe(Date.parse("2026-10-09T00:00:00Z"));
    expect(new Date(historicalDateMs({ year: 1, month: null, day: null })).getUTCFullYear()).toBe(1);
  });
  it("1 BCE is the year right before 1 CE (not two years before)", () => {
    const span = historicalDateMs({ year: 1, month: 1, day: 1 }) - historicalDateMs({ year: -1, month: 1, day: 1 });
    expect(Math.round(span / 86_400_000)).toBe(366); // 1 BCE is astronomical year 0, a leap year
  });
  it("a term crossing the era boundary is one year shorter than naive subtraction", () => {
    const start = historicalDateMs({ year: -5, month: 1, day: 1 });
    const end = historicalDateMs({ year: 5, month: 1, day: 1 });
    expect(Math.round((end - start) / 86_400_000 / 365.25)).toBe(9); // 5 BCE .. 5 CE = 9 years, not 10
  });
});

describe("daysLeft", () => {
  it("rounds up, floors at 0, treats none / past / junk as 0", () => {
    expect(daysLeft("2026-10-12T12:00:01Z", NOW)).toBe(4);
    expect(daysLeft("2026-10-12T12:00:00Z", NOW)).toBe(3);
    expect(daysLeft("2026-10-01T00:00:00Z", NOW)).toBe(0);
    expect(daysLeft(null, NOW)).toBe(0);
    expect(daysLeft("not a date", NOW)).toBe(0);
  });
  it("min raises the floor for an expiry that is still being shown", () => {
    expect(daysLeft("2026-10-09T12:00:00Z", NOW, 1)).toBe(1);
    expect(daysLeft("2026-10-12T12:00:00Z", NOW, 1)).toBe(3);
  });
  it("takes epoch milliseconds too", () => {
    expect(daysLeft(NOW + 2 * 86_400_000, NOW)).toBe(2);
  });
});

describe("termFraction", () => {
  it("is the share served, clamped to 0-1", () => {
    const a = Date.parse("2026-01-01");
    const b = Date.parse("2027-01-01");
    expect(termFraction(a, b, Date.parse("2026-07-02T12:00:00Z"))).toBeCloseTo(0.5, 2);
    expect(termFraction(a, b, Date.parse("2030-01-01"))).toBe(1);
    expect(termFraction(a, b, Date.parse("2020-01-01"))).toBe(0);
  });
  it("is null when the end is not after the start, or either is not a date", () => {
    expect(termFraction(10, 10, 5)).toBeNull();
    expect(termFraction(10, 5, 5)).toBeNull();
    expect(termFraction(NaN, 5, 5)).toBeNull();
  });
});
