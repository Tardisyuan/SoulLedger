import { describe, expect, it } from "vitest";

import { thisLifeLabel } from "../lifeLabel";

const t = (key: string, params?: Record<string, string>) => (params ? `${key}(${JSON.stringify(params)})` : key);

describe("thisLifeLabel (v4 第十批第 4 条)", () => {
  it("Europe and Egypt: 「此生」, and after a transfer 「此生 · 此前另有 m 世」 with m = n − 1", () => {
    expect(thisLifeLabel(t, "EUROPEAN", 1)).toBe("souls.life_label.this_life");
    expect(thisLifeLabel(t, "EG_DUAT", 1)).toBe("souls.life_label.this_life");
    expect(thisLifeLabel(t, "EGYPTIAN", 3)).toBe('souls.life_label.this_life_prior({"m":"2"})');
  });

  it("Diyu, Greece, and an unknown civilization keep their own 「第 n 世」 (null)", () => {
    for (const civ of ["CHINESE", "GR_HADES", "GREEK", "ATLANTEAN", "", null, undefined]) expect(thisLifeLabel(t, civ, 2)).toBeNull();
  });
});
