/**
 * Design v4 第四十六批第四节「两个 App：跟」: the top line's four shapes, the paper texture, and the head mark (civHead.tsx),
 * which the officer app shares (mobile-officer/src/__tests__/tabHead.test.tsx covers its side).
 */
import { LOCALE_COOKIE } from "@soulledger/core/config/locale";
import { platform } from "@soulledger/core/platform";
import { act, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import Svg, { Path, Text as SvgText } from "react-native-svg";

import { HeadMark, Topline, diyuMark, hallNameFor, headTextureShape, markFits, toplineBars } from "../civHead";
import { installMobilePlatform } from "../platform";
import { themeFor, type CivKey } from "../theme";
import { ThemeContext } from "../ui";
import { renderSoul } from "./harness";

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const CIVILIZATION: Record<CivKey, string | null> = { neutral: null, cn: "CHINESE", eu: "EUROPEAN", eg: "EGYPTIAN", gr: "GREEK" };
const NAMES = { "zh-Hans": "秦廣殿", en: "First Court", egy: "Wesekhet 1" };

beforeEach(() => {
  installMobilePlatform();
  platform().persistent.set(LOCALE_COOKIE, "zh-Hans");
});

function draw(civ: CivKey, ui: ReactElement, scheme: "dark" | "light" = "dark") {
  return renderSoul(<ThemeContext.Provider value={themeFor(CIVILIZATION[civ], scheme)}>{ui}</ThemeContext.Provider>);
}

describe("the top line's shapes (the web's .page-head-topline)", () => {
  const covered = (bars: { x: number; w: number }[], x: number) => bars.some((b) => x >= b.x && x < b.x + b.w);

  it("地府: one solid 3; the neutral skin: one solid 2", () => {
    expect(toplineBars("cn", 330)).toEqual([{ x: 0, y: 0, w: 330, h: 3 }]);
    expect(toplineBars("neutral", 330)).toEqual([{ x: 0, y: 0, w: 330, h: 2 }]);
  });

  it("欧洲: 1, a 1 gap, 1 — the middle row is empty", () => {
    const bars = toplineBars("eu", 330);
    expect(bars.map((b) => [b.y, b.h, b.w])).toEqual([
      [0, 1, 330],
      [2, 1, 330],
    ]);
    expect(bars.some((b) => b.y <= 1 && b.y + b.h > 1)).toBe(false);
  });

  it("埃及: a 6 gap every 48, 3 high, the last piece cut at the line's end", () => {
    const bars = toplineBars("eg", 330);
    expect(bars.every((b) => b.h === 3 && b.y === 0)).toBe(true);
    expect(covered(bars, 41)).toBe(true);
    expect([42, 45, 47].some((x) => covered(bars, x))).toBe(false);
    expect(covered(bars, 48)).toBe(true);
    expect(Math.max(...bars.map((b) => b.x + b.w))).toBe(330);
  });

  it("希腊: 2-high teeth 4 wide every 8 over a 1 base line", () => {
    const bars = toplineBars("gr", 330);
    const teeth = bars.filter((b) => b.h === 2);
    expect(teeth.every((b) => b.y === 0 && b.w <= 4)).toBe(true);
    expect(teeth.map((b) => b.x).slice(0, 3)).toEqual([0, 8, 16]);
    expect(covered(teeth, 5)).toBe(false);
    expect(bars.filter((b) => b.h === 1)).toEqual([{ x: 0, y: 2, w: 330, h: 1 }]);
  });

  it.each(["cn", "eu", "eg", "gr", "neutral"] as const)("%s: at the top of the screen, inset 30 each side, in the civilization's colour", (civ) => {
    draw(civ, <Topline />);
    const theme = themeFor(CIVILIZATION[civ], "dark");
    expect(StyleSheet.flatten(screen.getByTestId("topline").props.style)).toMatchObject({ position: "absolute", top: 0, left: 30, right: 30, height: civ === "neutral" ? 2 : 3 });
    const bars = screen.getAllByTestId("topline-bar").map((b) => StyleSheet.flatten(b.props.style));
    expect(bars).toHaveLength(toplineBars(civ, 390 - 60).length);
    expect(new Set(bars.map((b) => b.backgroundColor))).toEqual(new Set([theme.plaque]));
  });
});

describe("the paper texture (the web's .page-head-pat)", () => {
  it("地府 verticals every 24 · 埃及 rules every 22 · 欧洲 45° hatching · 希腊 filled dots every 8", () => {
    expect(headTextureShape("cn", 60, 40)).toEqual({ fill: false, d: "M0.5 0V40M24.5 0V40M48.5 0V40" });
    expect(headTextureShape("eg", 30, 50)).toEqual({ fill: false, d: "M0 21.5H30M0 43.5H30" });
    const eu = headTextureShape("eu", 30, 10);
    expect(eu.fill).toBe(false);
    // Each stripe drops as far as it runs: 45°.
    expect(eu.d.startsWith("M-10.00 0L0.00 10")).toBe(true);
    const gr = headTextureShape("gr", 16, 8);
    expect(gr.fill).toBe(true);
    expect(gr.d.match(/M/g)).toHaveLength(2);
    expect(gr.d).toContain("M2.7 4a1.3 1.3");
  });
});

describe("the head mark", () => {
  it("hall names: zh-Hans its own; en English; egy its own unless it is only the zh fallback", () => {
    expect(hallNameFor(NAMES, "zh-Hans")).toBe("秦廣殿");
    expect(hallNameFor(NAMES, "en")).toBe("First Court");
    expect(hallNameFor(NAMES, "egy")).toBe("Wesekhet 1");
    expect(hallNameFor({ "zh-Hans": "秦廣殿", en: "First Court", egy: "秦廣殿" }, "egy")).toBe("First Court");
    expect(hallNameFor(undefined, "zh-Hans")).toBeUndefined();
  });

  it("地府: Han up to 5 characters, else 地府; Latin capitals up to 14, else DIYU; no hall: 地府 / DIYU", () => {
    expect(diyuMark("轉輪王殿", "zh-Hans")).toEqual({ script: "han", text: "轉輪王殿" });
    expect(diyuMark("一二三四五", "zh-Hans").text).toBe("一二三四五");
    expect(diyuMark("一二三四五六", "zh-Hans").text).toBe("地府");
    expect(diyuMark(undefined, "zh-Hans").text).toBe("地府");
    expect(diyuMark("First Court", "en")).toEqual({ script: "latin", text: "FIRST COURT" });
    expect(diyuMark("ABCDEFGHIJKLMN", "en").text).toBe("ABCDEFGHIJKLMN");
    expect(diyuMark("ABCDEFGHIJKLMNO", "egy").text).toBe("DIYU");
    expect(diyuMark(undefined, "egy").text).toBe("DIYU");
  });

  it("clears the text by 24 or is not drawn", () => {
    expect(markFits(100, 124)).toBe(true);
    expect(markFits(101, 124)).toBe(false);
  });

  const mark = (civ: CivKey) => screen.getByTestId(`head-mark-${civ}`, { includeHiddenElements: true });
  const style = (civ: CivKey) => StyleSheet.flatten(mark(civ).props.style) as Record<string, unknown>;
  const texts = (civ: CivKey) =>
    mark(civ)
      .findAll((n) => String(n.type) === "Text")
      .map((n) => n.props.children);

  it("地府 in Chinese: the hall's name one character a line at 20/23, ink at 34% (dark), hidden from screen readers", () => {
    draw("cn", <HeadMark names={NAMES} />);
    expect(screen.queryByTestId("head-mark-cn")).toBeNull();
    expect(mark("cn").props.importantForAccessibility).toBe("no-hide-descendants");
    expect(mark("cn").props.accessibilityElementsHidden).toBe(true);
    expect(texts("cn")).toEqual(["秦", "廣", "殿"]);
    const glyph = StyleSheet.flatten(mark("cn").findAll((n) => String(n.type) === "Text")[0].props.style);
    expect([glyph.fontSize, glyph.lineHeight, glyph.color]).toEqual([20, 23, themeFor("CHINESE", "dark").ink]);
    expect(style("cn")).toMatchObject({ right: 20, top: 12, opacity: 0.34 });
  });

  it("地府 in English: the hall's name in capitals, turned to read down; a name too long: DIYU", async () => {
    platform().persistent.set(LOCALE_COOKIE, "en");
    draw("cn", <HeadMark names={NAMES} />, "light");
    const word = mark("cn").findByType(SvgText);
    expect(word.props.children).toBe("FIRST COURT");
    expect(word.props.transform).toContain("rotate(90)");
    expect(style("cn").opacity).toBe(0.3);
    screen.unmount();
    draw("cn", <HeadMark names={{ ...NAMES, en: "The Court of the First King" }} />);
    expect(mark("cn").findByType(SvgText).props.children).toBe("DIYU");
    await act(async () => {});
  });

  it("欧洲 IVSTITIA and 希腊 ΚΡΙΣΙΣ at 14, not translated; 埃及 the drawing, not hieroglyph text", () => {
    platform().persistent.set(LOCALE_COOKIE, "en");
    draw("eu", <HeadMark names={NAMES} right={80} />);
    expect(texts("eu")).toEqual(["IVSTITIA"]);
    expect(StyleSheet.flatten(mark("eu").findAll((n) => String(n.type) === "Text")[0].props.style).fontSize).toBe(14);
    expect(style("eu").right).toBe(80);
    screen.unmount();
    draw("gr", <HeadMark names={NAMES} />);
    expect(texts("gr")).toEqual(["ΚΡΙΣΙΣ"]);
    screen.unmount();
    draw("eg", <HeadMark names={NAMES} />);
    expect(texts("eg")).toEqual([]);
    const art = mark("eg").findByType(Svg);
    expect([art.props.width, art.props.height]).toEqual([90, 24]);
    expect(mark("eg").findAllByType(Path).length).toBeGreaterThan(3);
  });

  it("the neutral skin has no mark; `hidden` keeps it laid out at opacity 0", () => {
    draw("neutral", <HeadMark names={NAMES} />);
    expect(screen.queryByTestId("head-mark-neutral", { includeHiddenElements: true })).toBeNull();
    screen.unmount();
    draw("gr", <HeadMark names={NAMES} hidden />);
    expect(style("gr").opacity).toBe(0);
  });
});
