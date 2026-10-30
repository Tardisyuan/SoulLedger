import { describe, expect, it } from "vitest";

import { formatStamp } from "../dates";

describe("formatStamp: a server timestamp as YYYY-MM-DD HH:mm, device time (both apps)", () => {
  it("pads every field and reads the local clock, not UTC", () => {
    // Built from local fields, so the expectation holds in any TZ the runner has.
    expect(formatStamp(new Date(2026, 0, 2, 3, 4).toISOString())).toBe("2026-01-02 03:04");
    expect(formatStamp(new Date(1999, 11, 31, 23, 59).toISOString())).toBe("1999-12-31 23:59");
  });
  it("nothing or an unparseable value is null, never 'NaN-NaN'", () => {
    expect(formatStamp(null)).toBeNull();
    expect(formatStamp(undefined)).toBeNull();
    expect(formatStamp("")).toBeNull();
    expect(formatStamp("not a date")).toBeNull();
  });
});
