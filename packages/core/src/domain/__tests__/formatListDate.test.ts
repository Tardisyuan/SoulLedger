import { describe, expect, it } from "vitest";

import { formatListDate } from "../dates";

// 第三十批「卷宗」:列表日期当年省年份、不写秒,跨年写全年。时间按本地字段造,任何时区下预期都成立。
const NOW = new Date(2026, 10, 13, 9, 0);

describe("formatListDate: a list's date, without this year and without seconds", () => {
  it("this year: no year, no seconds", () => {
    const out = formatListDate(new Date(2026, 9, 28, 14, 5, 59), "zh-Hans", { now: NOW })!;
    expect(out).toContain("10月28日");
    expect(out).toContain("14:05");
    expect(out).not.toContain("2026");
    expect(out).not.toContain(":59");
  });

  it("another year: the year written in full", () => {
    expect(formatListDate(new Date(2025, 9, 28, 14, 5), "zh-Hans", { now: NOW })).toContain("2025");
    expect(formatListDate(new Date(2025, 9, 28, 14, 5), "en", { now: NOW })).toContain("2025");
  });

  it("time: false is the day alone; egy reads as en", () => {
    const out = formatListDate(new Date(2026, 9, 28, 14, 5), "egy", { now: NOW, time: false })!;
    expect(out).toBe(formatListDate(new Date(2026, 9, 28, 14, 5), "en", { now: NOW, time: false }));
    expect(out).not.toContain("14");
  });

  it("nothing or an unparseable value is null", () => {
    expect(formatListDate(null)).toBeNull();
    expect(formatListDate("")).toBeNull();
    expect(formatListDate("not a date")).toBeNull();
  });
});
