import { describe, expect, it } from "vitest";

import { mfaDigits, secretLines } from "../mfa";

describe("mfaDigits: only the six digits a code box takes", () => {
  it("drops everything that is not a digit, and anything past six", () => {
    expect(mfaDigits("12 34-56")).toBe("123456");
    expect(mfaDigits("1234567")).toBe("123456");
    expect(mfaDigits("ab1c2")).toBe("12");
    expect(mfaDigits("")).toBe("");
  });
});

describe("secretLines: four to a group, four groups to a line", () => {
  it("splits 32 characters into two lines and keeps a short tail", () => {
    const s = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    expect(secretLines(s)).toEqual(["ABCD EFGH IJKL MNOP", "QRST UVWX YZ23 4567"]);
    expect(secretLines("ABCDEF")).toEqual(["ABCD EF"]);
    expect(secretLines("")).toEqual([]);
  });
});
