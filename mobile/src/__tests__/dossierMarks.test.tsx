/**
 * 卷宗 marks and seals (batch 30 step 3): the shape says merit or demerit, the seal exists for the four
 * civilizations and not for the neutral skin, and 申诉被驳回 is ⊘ while 已驳回 keeps ✕.
 */
import { LOCALE_COOKIE } from "@soulledger/core/config/locale";
import { render as rtlRender } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { DossierSeal, MeritMark } from "../dossierMarks";
import { I18nProvider } from "../i18n";
import { installMobilePlatform, persistentStore } from "../platform";
import { APPLICATION_BADGES } from "../rules";

const render = (ui: ReactElement) => rtlRender(<I18nProvider>{ui}</I18nProvider>);
const svgOf = (el: ReturnType<typeof render>) => JSON.stringify(el.toJSON());

beforeEach(() => {
  installMobilePlatform();
  persistentStore.remove(LOCALE_COOKIE);
});

describe("MeritMark", () => {
  it.each(["cn", "eu", "eg", "gr"] as const)("%s: merit and demerit are drawn differently", (civ) => {
    const merit = svgOf(render(<MeritMark civ={civ} demerit={false} ink="#111" ground="#fff" />));
    const demerit = svgOf(render(<MeritMark civ={civ} demerit ink="#111" ground="#fff" />));
    expect(merit).not.toBe(demerit);
  });

  it("地府: 功 / 过 in Chinese, + / − in English and egy (batch 36 §1.1), never the other", () => {
    const cnMark = () => [svgOf(render(<MeritMark civ="cn" demerit={false} ink="#111" ground="#fff" />)), svgOf(render(<MeritMark civ="cn" demerit ink="#111" ground="#fff" />))];
    persistentStore.set(LOCALE_COOKIE, "zh-Hans");
    const [zhMerit, zhDemerit] = cnMark();
    expect(zhMerit).toContain("功");
    expect(zhDemerit).toContain("过");
    for (const locale of ["en", "egy"]) {
      persistentStore.set(LOCALE_COOKIE, locale);
      const [merit, demerit] = cnMark();
      expect(merit).toContain('"+"');
      expect(demerit).toContain('"−"');
      expect(merit + demerit).not.toMatch(/[功过]/);
    }
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
