import { describe, expect, it } from "vitest";

import { datePresetStart, utcDaysAgo, utcMonth } from "../dates";

// 2026-06-30 23:59 UTC is already 1 July east of Greenwich: a local-field reading would say 2026-07 / 07-01.
const EDGE = new Date(Date.UTC(2026, 5, 30, 23, 59));

describe("the backend's calendar is UTC", () => {
  it("utcMonth reads the UTC month", () => {
    expect(utcMonth(EDGE)).toBe("2026-06");
    expect(utcMonth(new Date(Date.UTC(2026, 6, 1, 0, 0)))).toBe("2026-07");
  });
  it("utcDaysAgo counts whole 24 h days back from now, as a UTC day", () => {
    expect(utcDaysAgo(0, EDGE)).toBe("2026-06-30");
    expect(utcDaysAgo(7, EDGE)).toBe("2026-06-23");
    expect(utcDaysAgo(29, EDGE.getTime())).toBe("2026-06-01");
  });
  it("datePresetStart: 7 or 30 days back, '' for 全部", () => {
    expect(datePresetStart("7d", EDGE)).toBe("2026-06-23");
    expect(datePresetStart("30d", EDGE)).toBe("2026-05-31");
    expect(datePresetStart("", EDGE)).toBe("");
  });
});
