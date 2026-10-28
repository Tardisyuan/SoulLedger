import { describe, expect, it } from "vitest";

import { CITY_GOD_BUREAU_GROUPS, CITY_GOD_BUREAU_PRESETS, CITY_GOD_RANKS } from "../cityGods";

const ALL = CITY_GOD_BUREAU_GROUPS.flatMap((g) => g.bureaus);

describe("城隍各级预设(第五十七批补表第二节)", () => {
  it("县 10、州 18、府 23、都 25,逐级包含下一级", () => {
    expect(CITY_GOD_RANKS.map((r) => CITY_GOD_BUREAU_PRESETS[r].length)).toEqual([25, 23, 18, 10]);
    for (let i = 1; i < CITY_GOD_RANKS.length; i++) {
      const lower = CITY_GOD_BUREAU_PRESETS[CITY_GOD_RANKS[i]];
      const higher = new Set(CITY_GOD_BUREAU_PRESETS[CITY_GOD_RANKS[i - 1]]);
      expect(lower.filter((b) => !higher.has(b))).toEqual([]);
    }
  });

  it("只用已有的司,不重复", () => {
    for (const r of CITY_GOD_RANKS) {
      const preset = CITY_GOD_BUREAU_PRESETS[r];
      expect(preset.filter((b) => !ALL.includes(b))).toEqual([]);
      expect(new Set(preset).size).toBe(preset.length);
    }
  });
});
