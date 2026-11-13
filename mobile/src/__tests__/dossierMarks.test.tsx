/**
 * 卷宗 marks and seals (batch 30 step 3): the shape says merit or demerit, the seal exists for the four
 * civilizations and not for the neutral skin, and 申诉被驳回 is ⊘ while 已驳回 keeps ✕.
 */
import { render } from "@testing-library/react-native";

import { DossierSeal, MeritMark } from "../dossierMarks";
import { APPLICATION_BADGES } from "../rules";

const svgOf = (el: ReturnType<typeof render>) => JSON.stringify(el.toJSON());

describe("MeritMark", () => {
  it.each(["cn", "eu", "eg", "gr"] as const)("%s: merit and demerit are drawn differently", (civ) => {
    const merit = svgOf(render(<MeritMark civ={civ} demerit={false} ink="#111" ground="#fff" />));
    const demerit = svgOf(render(<MeritMark civ={civ} demerit ink="#111" ground="#fff" />));
    expect(merit).not.toBe(demerit);
  });

  it("the ink given is what draws the mark (colour is not the mark's to choose)", () => {
    const a = svgOf(render(<MeritMark civ="gr" demerit ink="#123456" ground="#abcdef" />));
    const b = svgOf(render(<MeritMark civ="gr" demerit ink="#654321" ground="#abcdef" />));
    expect(a).not.toBe(b);
  });
});

describe("DossierSeal", () => {
  it.each(["cn", "eu", "eg", "gr"] as const)("%s: a set seal and its dashed preview differ", (civ) => {
    const set = svgOf(render(<DossierSeal civ={civ} scheme="light" />));
    const pending = svgOf(render(<DossierSeal civ={civ} scheme="light" pending />));
    expect(set).not.toBe(pending);
    expect(pending).toContain("strokeDasharray");
  });

  it("地府's seal carries the court number; the neutral skin has none", () => {
    expect(svgOf(render(<DossierSeal civ="cn" scheme="dark" court={5} />))).toContain("五");
    expect(render(<DossierSeal civ="neutral" scheme="dark" />).toJSON()).toBeNull();
  });
});

describe("application tags", () => {
  it("申诉被驳回 is ⊘, 已驳回 stays ✕", () => {
    expect(APPLICATION_BADGES.APPEAL_REJECTED.glyph).toBe("⊘");
    expect(APPLICATION_BADGES.REJECTED.glyph).toBe("✕");
  });
});
