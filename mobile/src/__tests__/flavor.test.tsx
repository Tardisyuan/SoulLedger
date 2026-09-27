/**
 * Civilization flavour (handoff "灵魂簿 App · 文明气质"): the title-bar band,
 * the whole-page empty illustration, the breathing loader and the welcome.
 * The officer letter's corners are asserted in chat.test.tsx beside the
 * officer bubble; the three pages' empty states beside their own tests
 * (chat / circle / residence).
 */
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, StyleSheet, processColor } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppHeader, bandUnits } from "../chrome";
import { BAND, HERO } from "../emblems";
import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { LifeSections } from "../screens/life";
import { themeFor, type CivKey } from "../theme";
import { Button, Loader, ThemeContext } from "../ui";
import { Welcome, welcomeFrom } from "../welcome";
import { PROFILE, life, stubApi } from "./stubApi";

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const CIVILIZATION: Record<CivKey, string | null> = { neutral: null, cn: "CHINESE", eu: "EUROPEAN", eg: "EGYPTIAN", gr: "GREEK" };
const CIVS = Object.keys(CIVILIZATION) as CivKey[];

type Node = { type: unknown; props: Record<string, unknown> };
/** Every path drawn under `root` (host nodes only), as its `d`. */
const paths = (root: { findAll: (p: (n: Node) => boolean) => Node[] }) =>
  root.findAll((n) => typeof n.type === "string" && typeof n.props.d === "string").map((n) => n.props.d as string);
/** A host Svg node carries its stroke as a processed colour. */
const strokeOf = (testID: string) => (screen.getByTestId(testID).props.stroke as { payload: unknown }).payload;

function wrap(children: ReactNode, civ: CivKey = "cn") {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ThemeContext.Provider value={themeFor(CIVILIZATION[civ], "dark")}>
          <NavigationContainer>{children}</NavigationContainer>
        </ThemeContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  installMobilePlatform();
  Object.assign(mockWindow, { width: 390, fontScale: 1 });
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

describe("the title-bar band (1c / 1d)", () => {
  it("offset = (W mod 12) / 2: 236 cuts 4 off each end; 240 divides and starts at 0", () => {
    const at236 = bandUnits(236, false).map((u) => u.x);
    expect(at236[0]).toBe(-8); // the left unit's cut half: its visible part starts at 0
    expect(at236[1]).toBe(4);
    expect(at236[at236.length - 1]).toBe(232); // 232 + 12 = 244: 8 of it past the edge
    expect(bandUnits(240, false).map((u) => u.x)).toEqual(Array.from({ length: 20 }, (_, i) => i * 12));
  });

  it("compact keeps the motif on one unit in three", () => {
    const units = bandUnits(240, true);
    expect(units.filter((u) => u.motif)).toHaveLength(Math.ceil((units.length - 1) / 3));
    expect(units.slice(0, 6).map((u) => u.motif)).toEqual([false, true, false, false, true, false]);
  });

  it.each(CIVS.filter((c) => c !== "neutral"))("%s: its motif across the bar and a mark baseline, in place of the 1px rule", (civ) => {
    wrap(<AppHeader title="本世" />, civ);
    const band = screen.getByTestId(`header-band-${civ}`);
    const drawn = paths(band);
    expect(drawn.filter((d) => d === BAND[civ].d)).toHaveLength(bandUnits(390, false).length);
    expect(StyleSheet.flatten(band.props.style)).toMatchObject({ position: "absolute", left: 0, right: 0, bottom: 0 });
    expect(strokeOf("header-band-baseline")).toBe(processColor(themeFor(CIVILIZATION[civ], "dark").mark));
    // Only its own civilization's motif.
    for (const other of CIVS.filter((c) => c !== civ && c !== "neutral")) expect(drawn).not.toContain(BAND[other].d);
    // The rule is replaced, not doubled: the bar's container has no border of its own.
    expect(StyleSheet.flatten(screen.getByTestId("header").props.style).borderBottomWidth).toBeUndefined();
  });

  it("neutral: the baseline alone, in hair — the rule exactly as it was", () => {
    wrap(<AppHeader title="灵魂簿" />, "neutral");
    const drawn = paths(screen.getByTestId("header-band-neutral"));
    expect(drawn).toEqual(["M0 5.5H390"]);
    expect(strokeOf("header-band-baseline")).toBe(processColor(themeFor(null, "dark").hair));
  });

  it("compact (< 340pt, or ≥ 1.7× text): the rules on every unit, the motif on one in three", () => {
    Object.assign(mockWindow, { width: 320 });
    const { unmount } = wrap(<AppHeader title="本世" />, "gr");
    let drawn = paths(screen.getByTestId("header-band-gr"));
    expect(drawn.filter((d) => d === BAND.gr.d)).toHaveLength(bandUnits(320, true).filter((u) => u.motif).length);
    expect(drawn.filter((d) => d === BAND.gr.dc)).toHaveLength(bandUnits(320, true).filter((u) => !u.motif).length);
    unmount();
    Object.assign(mockWindow, { width: 390, fontScale: 1.7 });
    wrap(<AppHeader title="本世" />, "gr");
    drawn = paths(screen.getByTestId("header-band-gr"));
    expect(drawn.filter((d) => d === BAND.gr.dc).length).toBeGreaterThan(0);
  });
});

describe("the empty illustration is for whole pages only (1e)", () => {
  it("an empty section inside the life page keeps its dash: no illustration anywhere", () => {
    wrap(<LifeSections lex="cn" life={life(1) as never} />, "cn");
    expect(screen.getByText("尚未收案。审理殿定下后此处入簿。")).toBeTruthy();
    expect(screen.queryAllByTestId(/^empty-hero-/)).toEqual([]);
  });
});

describe("the loader (1h)", () => {
  const flat = () => StyleSheet.flatten(screen.getByTestId("loader").props.style) as Record<string, unknown>;

  it("is the civilization's compact drawing, breathing from 0.35 — never rotated or scaled — and still says it is loading", async () => {
    wrap(<Loader testID="loader" />, "eg");
    await act(async () => {});
    const loader = screen.getByTestId("loader");
    expect(loader.props.accessibilityRole).toBe("progressbar");
    expect(loader.props.accessibilityLabel).toBe("加载中…");
    expect(loader.props.accessibilityState).toEqual({ busy: true });
    expect(paths(loader)).toEqual([HERO.eg.c]);
    expect(flat().transform).toBeUndefined();
    expect(flat().opacity).toBeLessThan(1);
  });

  it("stands still at full opacity under reduce-motion", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    wrap(<Loader testID="loader" />, "eg");
    await act(async () => {});
    expect(flat().opacity).toBe(1);
  });

  it("a busy button waits with it, not with a spinner", async () => {
    wrap(<Button title="正在核验…" busy onPress={jest.fn()} />, "cn");
    await act(async () => {});
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toEqual([]);
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });
});

describe("the welcome (1b)", () => {
  const P = (over: Record<string, unknown>) => ({ ...PROFILE, ...over }) as never;

  it("when it plays, and from which ground", () => {
    const at = (civilization: string, home: string, welcomed: string[]) =>
      welcomeFrom({ civilization, home_civilization: home, welcomed_civilizations: welcomed as never });
    expect(at("CHINESE", "CHINESE", [])).toBe("neutral"); // first sign-in
    expect(at("CHINESE", "CHINESE", ["CHINESE"])).toBeNull(); // any later sign-in, any device
    expect(at("EGYPTIAN", "CHINESE", ["CHINESE"])).toBe("cn"); // a residence starts somewhere new
    expect(at("EGYPTIAN", "CHINESE", ["EGYPTIAN", "CHINESE"])).toBeNull(); // somewhere already welcomed
    expect(at("CHINESE", "CHINESE", ["CHINESE", "EGYPTIAN"])).toBe("eg"); // home again: once more
    expect(at("ATLANTEAN", "ATLANTEAN", [])).toBeNull(); // nothing to enter
  });

  function play(profile: never, reply: { status: number; data?: unknown } = { status: 200, data: { welcomed_civilizations: ["CHINESE"] } }) {
    const calls = stubApi({ "POST /me/welcomed/": reply });
    const view = render(
      <I18nProvider>
        <Welcome profile={profile} scheme="dark" />
      </I18nProvider>
    );
    return { calls, view };
  }

  it("first sign-in: neutral → the civilization, recorded on the server; a tap skips it", async () => {
    const { calls } = play(P({ welcomed_civilizations: [] }));
    await act(async () => {});
    expect(screen.getByTestId("welcome-neutral-cn")).toBeTruthy();
    expect(screen.getByText("你已进入中国")).toBeTruthy();
    expect(calls).toEqual([expect.objectContaining({ method: "POST", url: "/me/welcomed/", body: { civilization: "CHINESE" } })]);
    fireEvent.press(screen.getByTestId("welcome-skip"));
    expect(screen.queryByTestId("welcome")).toBeNull();
  });

  it("plays once per soul × civilization: the same profile again does not replay or rewrite", async () => {
    const { calls, view } = play(P({ welcomed_civilizations: [] }));
    await act(async () => {});
    fireEvent.press(screen.getByTestId("welcome-skip"));
    view.rerender(
      <I18nProvider>
        <Welcome profile={P({ welcomed_civilizations: [] })} scheme="dark" />
      </I18nProvider>
    );
    await act(async () => {});
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("the server already has it: nothing plays and nothing is written", async () => {
    const { calls } = play(P({ welcomed_civilizations: ["CHINESE"] }));
    await act(async () => {});
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("home again after a residence: the Duat → the Diyu, although home was recorded before", async () => {
    const { calls } = play(P({ welcomed_civilizations: ["CHINESE", "EGYPTIAN"] }));
    await act(async () => {});
    expect(screen.getByTestId("welcome-eg-cn")).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("reduce-motion: nothing shown, and the record is still written", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const { calls } = play(P({ welcomed_civilizations: [] }));
    await act(async () => {});
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("the server write fails: it plays anyway (the next launch asks again)", async () => {
    play(P({ welcomed_civilizations: [] }), { status: 500 });
    await act(async () => {});
    expect(screen.getByTestId("welcome-neutral-cn")).toBeTruthy();
  });
});
