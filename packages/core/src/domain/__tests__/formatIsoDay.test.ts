import { describe, expect, it } from "vitest";

import { formatIsoDay } from "../dates";

describe("formatIsoDay: an ISO day in the same words as formatHistoricalDate", () => {
  it("writes the day out, not the raw ISO string", () => {
    expect(formatIsoDay("2027-12-01", "zh-Hans")).toBe("2027年 · 12月1日");
    expect(formatIsoDay("2027-12-01", "zh-Hans")).not.toContain("2027-12-01");
    expect(formatIsoDay("2027-12-01", "en")).toBe("2027 CE · December 1");
  });
  it("nothing in, nothing out; an unparseable value comes back as given", () => {
    expect(formatIsoDay(null)).toBe("");
    expect(formatIsoDay(undefined)).toBe("");
    expect(formatIsoDay("someday")).toBe("someday");
  });
});
