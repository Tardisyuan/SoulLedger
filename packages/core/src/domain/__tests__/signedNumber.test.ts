import { describe, expect, it } from "vitest";

import { signedNumber, signedTone } from "../signedNumber";

describe("signedNumber", () => {
  it("zero has no sign; a negative takes U+2212", () => {
    expect([signedNumber(7), signedNumber(-7), signedNumber(0), signedNumber(-0)]).toEqual(["+7", "−7", "0", "0"]);
    expect(signedNumber(-7)).not.toContain("-");
  });
  it("groups thousands when asked", () => {
    expect([signedNumber(1284, { grouping: true }), signedNumber(-937, { grouping: true })]).toEqual(["+1,284", "−937"]);
  });
  it("a value that rounds to zero is zero", () => {
    expect(signedNumber(42.66, { fractionDigits: 1 })).toBe("+42.7");
    expect(signedNumber(-3.21, { fractionDigits: 1 })).toBe("−3.2");
    expect(signedNumber(-0.04, { fractionDigits: 1 })).toBe("0.0");
    expect(signedNumber(0, { fractionDigits: 1 })).toBe("0.0");
  });
  it("tone follows the sign; zero is neutral", () => {
    expect([signedTone(1), signedTone(-1), signedTone(0)]).toEqual(["success", "error", "neutral"]);
  });
});
