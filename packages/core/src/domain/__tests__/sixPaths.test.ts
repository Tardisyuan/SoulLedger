import { describe, expect, it } from "vitest";

import { hasSixPaths } from "../sixPaths";

describe("hasSixPaths: only a soul of Diyu chooses one of the six paths (reincarnation/services.py)", () => {
  it("CHINESE yes; every other civilization, and none, no", () => {
    expect(hasSixPaths("CHINESE")).toBe(true);
    for (const civ of ["GREEK", "EUROPEAN", "EGYPTIAN", "", null, undefined]) expect(hasSixPaths(civ)).toBe(false);
  });
});
