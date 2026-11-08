import { describe, expect, it } from "vitest";

import { formatStamp, hhmm, mmdd, pad2 } from "../dates";

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

describe("pad2 / hhmm / mmdd: the shared clock pieces both apps print", () => {
  it("pads to two digits and leaves wider numbers alone", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(7)).toBe("07");
    expect(pad2(12)).toBe("12");
    expect(pad2(123)).toBe("123");
  });
  it("reads local fields, not UTC", () => {
    const d = new Date(2026, 0, 2, 3, 4);
    expect(hhmm(d)).toBe("03:04");
    expect(mmdd(d)).toBe("01-02");
    expect(hhmm(new Date(2026, 11, 31, 23, 59))).toBe("23:59");
    expect(mmdd(new Date(2026, 11, 31, 23, 59))).toBe("12-31");
  });
});
