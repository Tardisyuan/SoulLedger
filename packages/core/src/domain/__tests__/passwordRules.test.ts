import { describe, expect, it } from "vitest";

import { minLengthRuleKey, passwordMinLength, passwordRulesMet, passwordsMatch, ruleDisplay, unmetRules } from "../passwordRules";

describe("passwordRulesMet", () => {
  it("nothing typed: nothing is met, and the third rule exists only when there is a current-password box", () => {
    expect(passwordRulesMet("", "old-one")).toEqual({ min_length: false, not_digits: false, not_current: false });
    expect(passwordRulesMet("")).toEqual({ min_length: false, not_digits: false });
    expect("not_current" in passwordRulesMet("abc")).toBe(false);
  });

  it("length is 8 or more; seven is not", () => {
    expect(passwordRulesMet("abcdefg").min_length).toBe(false);
    expect(passwordRulesMet("abcdefgh").min_length).toBe(true);
  });

  it("only numbers is not met; one letter among them is", () => {
    expect(passwordRulesMet("12345678").not_digits).toBe(false);
    expect(passwordRulesMet("1234567a").not_digits).toBe(true);
  });

  it("differs from the current password -- and is not ticked before the current one is typed", () => {
    expect(passwordRulesMet("same-pass", "same-pass").not_current).toBe(false);
    expect(passwordRulesMet("other-pass", "same-pass").not_current).toBe(true);
    expect(passwordRulesMet("other-pass", "").not_current).toBe(false);
  });
});

describe("the rest", () => {
  it("an empty confirmation matches nothing", () => {
    expect(passwordsMatch("", "")).toBe(false);
    expect(passwordsMatch("abc", "abc")).toBe(true);
    expect(passwordsMatch("abc", "abd")).toBe(false);
  });

  it("unmet is a circle while typing and a mark only once judged; met is a tick either way", () => {
    expect(ruleDisplay(false, false)).toBe("idle");
    expect(ruleDisplay(false, true)).toBe("bad");
    expect(ruleDisplay(true, false)).toBe("ok");
    expect(ruleDisplay(true, true)).toBe("ok");
  });

  it("lists the unmet rules in display order, without the third when there is no current-password box", () => {
    expect(unmetRules("1234", "x")).toEqual(["min_length", "not_digits", "not_current"].slice(0, 2));
    expect(unmetRules("12345678")).toEqual(["not_digits"]);
    expect(unmetRules("same-pass", "same-pass")).toEqual(["not_current"]);
    expect(unmetRules("good-pass-1", "old-pass")).toEqual([]);
  });
});

describe("administrators need 12", () => {
  it("the role picks the length and the wording of the first rule", () => {
    expect(passwordMinLength("ADMIN")).toBe(12);
    expect(["JUDGE", "VIEWER", undefined].map(passwordMinLength)).toEqual([8, 8, 8]);
    expect(minLengthRuleKey(12)).toBe("password_rules.min_length_admin");
    expect(minLengthRuleKey(8)).toBe("password_rules.min_length");
  });

  it("eleven is short for an administrator, twelve is not; both pass for the default", () => {
    expect(passwordRulesMet("abcdefghijk", undefined, 12).min_length).toBe(false);
    expect(passwordRulesMet("abcdefghijkl", undefined, 12).min_length).toBe(true);
    expect(unmetRules("abcdefghij", undefined, 12)).toEqual(["min_length"]);
    expect(unmetRules("abcdefghij")).toEqual([]);
  });
});
