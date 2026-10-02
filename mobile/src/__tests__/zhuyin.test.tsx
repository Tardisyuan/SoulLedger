/**
 * v2「朱印」App chrome: the seal, the plaque on the life tab, and the cold start.
 */
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SplashScreen from "expo-splash-screen";
import type { ReactNode } from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RING_D, SVG } from "../art";
import { AppHeader, PlaqueHeader, TabBar } from "../chrome";
import { ColdStart, coldStart } from "../coldStart";
import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { DEFAULT_GLYPHS, OutlineSeal, Seal, sealGlyphs } from "../seal";
import { SessionContext, type SessionState } from "../session";
import { motion, themeFor, v3, v3Band } from "../theme";
import { ThemeContext } from "../ui";
import { PROFILE } from "./stubApi";

// Every other suite gets jest.setup's inert double; this one tests the real thing.
jest.unmock("../coldStart");

// expo-font's registry, as the native side keeps it: a name is loaded once loadAsync for it
// has resolved, and not before. `__state.fail` makes the next load reject, as a missing file would.
jest.mock("expo-font", () => {
  const actual = jest.requireActual<object>("expo-font");
  const loaded = new Set();
  const state = { fail: false };
  return {
    ...actual,
    __loaded: loaded,
    __state: state,
    isLoaded: (name: string) => loaded.has(name),
    loadAsync: jest.fn(async (map: Record<string, unknown>) => {
      if (state.fail) throw new Error("font file missing");
      Object.keys(map).forEach((name) => loaded.add(name));
    }),
  };
});

/** The seal beside words and the cold start are hidden from assistive tech; queries must ask for them. */
const H = { includeHiddenElements: true };
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const argb = (hex: string) => 0xff000000 + parseInt(hex.slice(1), 16);

function wrap(children: ReactNode, session: SessionState, civilization: string | null = "CHINESE") {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <SessionContext.Provider value={{ state: session } as never}>
          <ThemeContext.Provider value={themeFor(civilization, "light")}>
            <NavigationContainer>{children}</NavigationContainer>
          </ThemeContext.Provider>
        </SessionContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const signedIn = (overrides: Record<string, unknown> = {}): SessionState =>
  ({ status: "signedIn", profile: { ...PROFILE, ...overrides } }) as never;

beforeEach(() => installMobilePlatform());

describe("the art Design delivered", () => {
  it("carries no c2pa metadata, and every civilization has its four seal drawings — and no v2 band", () => {
    expect(Object.entries(SVG).filter(([, xml]) => /<metadata|c2pa:manifest/.test(xml))).toEqual([]);
    for (const civ of ["cn", "eu", "eg", "gr"]) {
      for (const part of ["seal-%-body", "seal-%-ring", "seal-%-line", "seal-%-line-small"]) {
        expect(SVG).toHaveProperty(part.replace("%", civ));
      }
      expect(RING_D[civ as keyof typeof RING_D]).toMatch(/^M/);
    }
    // v2's ornament band went with v3 (2026-10-02): nothing draws it, so it is not shipped.
    expect(Object.keys(SVG).filter((k) => k.startsWith("band-"))).toEqual([]);
  });
});

describe("the seal's glyphs (补足 A6)", () => {
  it("empty or missing: the civilization's default", () => {
    expect(sealGlyphs("cn", [])).toEqual(["冥"]);
    expect(sealGlyphs("eu", null)).toEqual(["J"]);
    expect(sealGlyphs("eg", undefined)).toEqual(["\u{13184}"]);
    expect(sealGlyphs("gr", [])).toEqual(["Μ"]);
  });

  it("the tenant's own glyph wins; two only for 杜阿特, else the default rather than a cut", () => {
    expect(sealGlyphs("cn", ["五"])).toEqual(["五"]);
    expect(sealGlyphs("eg", ["\u{13184}", "\u{131CB}"])).toEqual(["\u{13184}", "\u{131CB}"]);
    expect(sealGlyphs("cn", ["五", "殿"])).toEqual([DEFAULT_GLYPHS.cn]);
    expect(sealGlyphs("eg", ["a", "b", "c"])).toEqual([DEFAULT_GLYPHS.eg]);
    expect(sealGlyphs("gr", [""])).toEqual([DEFAULT_GLYPHS.gr]);
  });
});

describe("Seal", () => {
  const t = themeFor("CHINESE", "light");

  it("reads its label, not its glyph; the glyph is in the civilization's seal face", () => {
    wrap(<Seal testID="s" civ="cn" size={52} theme={t} glyphs={["五"]} label="第五殿之印" />, signedIn());
    expect(screen.getByTestId("s").props.accessibilityLabel).toBe("第五殿之印");
    const glyph = screen.getByTestId("s-glyph", H);
    expect(glyph.props.children).toBe("五");
    expect(flat(glyph)).toMatchObject({ fontFamily: "LXGWSeal_400", fontSize: 28, color: "#FFFFFF" });
  });

  it("above 32: the edge scan shows in the ring; at 32 and below it goes", () => {
    render(
      <>
        <Seal testID="big" civ="cn" size={52} theme={t} />
        <Seal testID="s" civ="cn" size={32} theme={t} />
      </>
    );
    expect(screen.getByTestId("big-ring", H)).toBeTruthy();
    expect(screen.queryByTestId("s-ring", H)).toBeNull();
    expect(screen.getByTestId("s-glyph", H).props.children).toBe("冥");
  });

  it("两个圣书字 stack, each at 0.46 of the seal", () => {
    wrap(<Seal testID="s" civ="eg" size={100} theme={themeFor("EGYPTIAN", "light")} glyphs={["\u{13184}", "\u{131CB}"]} />, signedIn());
    const glyphs = screen.getAllByTestId("s-glyph", H);
    expect(glyphs.map((g) => g.props.children)).toEqual(["\u{13184}", "\u{131CB}"]);
    expect(glyphs.map((g) => flat(g).fontSize)).toEqual([46, 46]);
  });
});

describe("v3 OutlineSeal", () => {
  const seal = (civ: "cn" | "eu" | "eg" | "gr", size = 52, extra: Record<string, unknown> = {}) =>
    render(<OutlineSeal testID="s" civ={civ} size={size} color="#123456" {...extra} />);
  const d = (id: string) => screen.getByTestId(id, H).props.d as string;

  it("an outline, not a body: a 2px frame 1 in and a 1px frame 5.5 in, both in the colour, nothing filled", () => {
    seal("cn");
    const outer = screen.getByTestId("s-outer", H).props;
    const inner = screen.getByTestId("s-inner", H).props;
    expect(d("s-outer")).toBe("M1 1H51V51H1Z");
    expect(d("s-inner")).toBe("M5.5 5.5H46.5V46.5H5.5Z");
    expect([outer.strokeWidth, inner.strokeWidth]).toEqual([2, 1]);
    // react-native-svg hands the native side ARGB integers; `none` is no fill at all.
    expect([outer.stroke.payload, inner.stroke.payload, outer.fill, inner.fill]).toEqual([argb("#123456"), argb("#123456"), null, null]);
  });

  it("at 32 and below: a 1px frame and the inner one 3.5 in", () => {
    seal("cn", 28);
    expect(d("s-outer")).toBe("M0.5 0.5H27.5V27.5H0.5Z");
    expect(d("s-inner")).toBe("M3.5 3.5H24.5V24.5H3.5Z");
    expect(screen.getByTestId("s-outer", H).props.strokeWidth).toBe(1);
  });

  it("the shape is the civilization's: circle, arch 70/64 tall, hexagon", () => {
    seal("eu");
    expect(d("s-outer")).toMatch(/^M1 26A25 25 0 1 0 51 26A25 25/);
    screen.unmount();
    seal("eg", 64);
    expect(flat(screen.getByTestId("s", H))).toMatchObject({ width: 64, height: 70 });
    expect(d("s-outer")).toBe("M1 69V32A31 31 0 0 1 63 32V69Z");
    screen.unmount();
    seal("gr", 52);
    expect(d("s-outer").split("L")).toHaveLength(6);
    expect(d("s-outer")).toMatch(/^M7 1L45 1L51 26L45 51L7 51L1 26Z$/);
  });

  it("the glyph: the colour, 0.44 of the width (0.5 at ≤ 32, 0.34 each for two), in the app's serif or the hieroglyph face", () => {
    seal("cn", 64, { glyphs: ["五"] });
    expect(flat(screen.getByTestId("s-glyph", H))).toMatchObject({ fontFamily: "NotoSerifSC_400", fontSize: 28, color: "#123456" });
    screen.unmount();
    seal("eu", 30);
    expect(flat(screen.getByTestId("s-glyph", H))).toMatchObject({ fontFamily: "SourceSerif4_400Regular", fontSize: 15 });
    expect(screen.getByTestId("s-glyph", H).props.children).toBe("J");
    screen.unmount();
    seal("gr");
    expect(screen.getByTestId("s-glyph", H).props.children).toBe("Μ");
    expect(flat(screen.getByTestId("s-glyph", H)).fontFamily).toBe("SourceSerif4_400Regular");
    screen.unmount();
    seal("eg", 100, { glyphs: ["\u{13184}", "\u{131CB}"] });
    const glyphs = screen.getAllByTestId("s-glyph", H);
    expect(glyphs.map((g) => [flat(g).fontFamily, flat(g).fontSize])).toEqual([
      ["NotoSansEgyptianHieroglyphs_400Regular", 34],
      ["NotoSansEgyptianHieroglyphs_400Regular", 34],
    ]);
  });

  it("reads its label, never its glyph; a soul of no known civilization has none", () => {
    seal("cn", 52, { label: "第五殿之印" });
    expect(screen.getByTestId("s").props.accessibilityLabel).toBe("第五殿之印");
    screen.unmount();
    render(<OutlineSeal testID="n" civ="neutral" size={52} color="#000000" />);
    expect(screen.queryByTestId("n", H)).toBeNull();
  });
});

describe("the band on a tab's root (v3 short identity band)", () => {
  it("the band ground, the tenant's seal in white read as 「第五殿之印」, the meta line, the title at 20 / 600 in the interface face", async () => {
    wrap(<PlaqueHeader title="书信" onAccount={() => {}} />, signedIn({ tenant: { ...PROFILE.tenant, seal_glyphs: ["五"] } }));
    expect(flat(screen.getByTestId("plaque")).backgroundColor).toBe(v3Band(v3.civ.cn.light));
    expect(screen.getByTestId("plaque-seal").props.accessibilityLabel).toBe("第五殿之印");
    expect(flat(screen.getByTestId("plaque-seal", H))).toMatchObject({ width: 38, height: 38 });
    expect(screen.getByTestId("plaque-seal-glyph", H).props.children).toBe("五");
    expect(screen.getByTestId("plaque-seal-outer", H).props.stroke.payload).toBe(argb("#FFFFFF"));
    expect(flat(screen.getByTestId("plaque-title"))).toMatchObject({ fontFamily: "Archivo_600SemiBold", fontSize: 20, color: "#FFFFFF" });
    expect(screen.getByTestId("plaque-meta").props.children).toBe("中国 · 第 2 世 · 第五殿");
    expect(flat(screen.getByTestId("plaque-meta"))).toMatchObject({ fontFamily: "IBMPlexMono_400Regular", fontSize: 11 });
    expect(screen.getByTestId("header-account")).toBeTruthy();
    // v2's ornament band and texture are gone.
    expect(screen.queryAllByTestId(/^plaque-band-/, H)).toEqual([]);
    await act(async () => {});
  });

  it("an empty seal_glyphs shows the default, 冥", async () => {
    wrap(<PlaqueHeader title="书信" onAccount={() => {}} />, signedIn());
    expect(screen.getByTestId("plaque-seal-glyph", H).props.children).toBe("冥");
    await act(async () => {});
  });

  it("every tab's root wears it, with the tab's own actions where the account icon was", async () => {
    const onPress = jest.fn();
    wrap(<PlaqueHeader title="书信" action={{ icon: "plus", framed: true, label: "写信", testID: "chat-new", onPress }} />, signedIn());
    expect(screen.getByTestId("plaque-seal")).toBeTruthy();
    expect(screen.queryByTestId("header-account")).toBeNull();
    fireEvent.press(screen.getByTestId("chat-new"));
    expect(onPress).toHaveBeenCalled();
    await act(async () => {});
  });

  it("a civilization the app does not know gets one neutral row: no seal", () => {
    wrap(<PlaqueHeader title="本世" onAccount={() => {}} />, signedIn({ civilization: "ATLANTEAN" }), "ATLANTEAN");
    expect(screen.queryByTestId("plaque")).toBeNull();
    expect(screen.queryByTestId("plaque-seal", H)).toBeNull();
    expect(flat(screen.getByTestId("header")).backgroundColor).toBe(themeFor(null, "light").band);
  });
});

describe("no civilization display face on any bar (v3; v2's 匾题字 and Ma Shan Zheng are gone)", () => {
  const Font = jest.requireMock("expo-font") as { loadAsync: jest.Mock };
  beforeEach(() => Font.loadAsync.mockClear());

  it.each(["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"])("%s: the tab root and a sub-page bar are both the interface face, and nothing is loaded", async (civilization) => {
    wrap(<PlaqueHeader title="Life" onAccount={() => {}} />, signedIn({ civilization }), civilization);
    expect(flat(screen.getByTestId("plaque-title")).fontFamily).toBe("Archivo_600SemiBold");
    screen.unmount();
    wrap(<AppHeader title="设置" onBack={() => {}} />, signedIn({ civilization }), civilization);
    expect(flat(screen.getByRole("header"))).toMatchObject({ fontFamily: "Archivo_600SemiBold", fontSize: 20 });
    await act(async () => {});
    expect(Font.loadAsync).not.toHaveBeenCalled();
  });

  it("the pre-login bar keeps the app name in the serif (product decision 2026-09-26)", () => {
    wrap(<AppHeader title="灵魂簿" serif />, { status: "signedOut" } as never, null);
    expect(flat(screen.getByRole("header")).fontFamily).toBe("NotoSerifSC_400");
  });
});

describe("the tab bar (补足 B11 / C14)", () => {
  const bar = (titles: string[], index = 0) => {
    const routes = ["Life", "Applications", "Letters", "Circle"].map((name) => ({ key: `${name}-k`, name }));
    const descriptors = Object.fromEntries(routes.map((r, i) => [r.key, { options: { title: titles[i] } }]));
    const navigation = { emit: () => ({ defaultPrevented: false }), navigate: jest.fn() };
    const props = { state: { index, routes }, descriptors, navigation, insets: {} } as unknown as Parameters<typeof TabBar>[0];
    return <TabBar {...props} />;
  };
  const label = (name: string) => flat(screen.getByTestId(`tab-${name}-label`));

  it("the current tab: a 2px rule in 匾色 and its label in ink 600; the rest ink3 400", () => {
    // v3: the bar wears v3's neutrals and the civilization's v3 colour.
    const t = themeFor("CHINESE", "light");
    expect([t.plaque, t.ink, t.inkSubtle, t.s1]).toEqual([v3.civ.cn.light, v3.light.ink, v3.light.muted, v3.light.surface]);
    wrap(bar(["本世", "转生", "书信", "朋友圈"], 2), signedIn());
    expect(screen.getAllByTestId("tab-current-rule")).toHaveLength(1);
    expect(flat(screen.getByTestId("tab-current-rule"))).toMatchObject({ backgroundColor: t.plaque });
    expect(label("Letters")).toMatchObject({ color: t.ink, fontFamily: "Archivo_600SemiBold", fontSize: 12 });
    expect(label("Life")).toMatchObject({ color: t.inkSubtle, fontFamily: "Archivo_400Regular" });
    // The label stays ink: as text every dark v3 colour is under 4.5:1 on the dark surface.
    expect(label("Letters").color).not.toBe(t.plaque);
    expect(flat(screen.getByTestId("tab-bar"))).toMatchObject({ backgroundColor: v3.light.surface, borderTopColor: v3.light.line });
  });

  it("one label past the pillar's threshold (core's pillarIsWide): all four go to 11, not only that one", () => {
    wrap(bar(["Ankh Pen", "Sesh Ba", "Medew", "Wehem Mesut"]), signedIn());
    for (const name of ["Life", "Applications", "Letters", "Circle"]) expect(label(name).fontSize).toBe(11);
    screen.unmount();
    wrap(bar(["本世", "转生", "书信", "朋友圈"]), signedIn());
    for (const name of ["Life", "Applications", "Letters", "Circle"]) expect(label(name).fontSize).toBe(12);
  });
});

describe("the cold start (补足 C18)", () => {
  const hide = SplashScreen.hideAsync as jest.Mock;
  let reduced = false;
  beforeEach(() => {
    coldStart.played = false;
    reduced = false;
    hide.mockClear();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => reduced);
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  const layout = () => fireEvent(screen.getByTestId("cold-start-skip", H), "layout", { nativeEvent: { layout: { width: 390, height: 844 } } });

  it("stamps, hides the native splash only once its own first frame is laid out, is usable at 480 and gone at 720", async () => {
    render(<ColdStart session={{ status: "signedOut" }} scheme="light" />);
    await act(async () => {});
    expect(screen.getByTestId("cold-start", H)).toBeTruthy();
    expect(hide).not.toHaveBeenCalled();
    layout();
    expect(hide).toHaveBeenCalledTimes(1);
    // Before sign-in: the neutral seal — no glyph.
    expect(screen.queryByTestId("cold-start-seal-glyph", H)).toBeNull();
    expect(screen.getByTestId("cold-start", H).props.pointerEvents).toBe("auto");
    act(() => jest.advanceTimersByTime(motion.coldStartInteractive));
    expect(screen.getByTestId("cold-start", H).props.pointerEvents).toBe("none");
    act(() => jest.advanceTimersByTime(motion.coldStart - motion.coldStartInteractive));
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
  });

  it("signed in: the civilization's seal and glyph", async () => {
    render(<ColdStart session={signedIn()} scheme="dark" />);
    await act(async () => {});
    expect(screen.getByTestId("cold-start-seal-glyph", H).props.children).toBe("冥");
    expect(flat(screen.getByTestId("cold-start-skip", H)).backgroundColor).toBe("#100e0d");
  });

  it("印泥 120–320: the civilization seal's edge scan soaks in to 0.8; the neutral seal has no scan to show", async () => {
    // Reanimated's jest mock settles a timing at once and never re-renders a style, so the curve is
    // read off the calls that build it; the first frame is read off the tree.
    const R = jest.requireMock("react-native-reanimated") as Record<string, (...a: unknown[]) => unknown>;
    const timing = jest.spyOn(R, "withTiming");
    const delay = jest.spyOn(R, "withDelay");
    render(<ColdStart session={signedIn()} scheme="light" />);
    await act(async () => {});
    // Frame 0: the scan is not there yet — the seal lands on paper, then the ink soaks in.
    expect(flat(screen.getByTestId("cold-start-seal-ring-layer", H)).opacity).toBe(0);
    const soak = motion.stampBloom / 2;
    expect(timing.mock.calls).toEqual(expect.arrayContaining([[0.95, { duration: soak }], [0.8, { duration: soak }]]));
    // It starts at the press (120) and is done by 320.
    expect(motion.stampDrop + motion.stampBloom).toBe(320);
    expect(delay.mock.calls.filter(([ms]) => ms === motion.stampDrop).length).toBeGreaterThanOrEqual(2); // press and 印泥
    timing.mockRestore();
    delay.mockRestore();
    screen.unmount();
    // Before sign-in: the neutral seal, and no scan layer at all (C18: 中性皮没有印泥层).
    coldStart.played = false;
    render(<ColdStart session={{ status: "signedOut" }} scheme="light" />);
    await act(async () => {});
    expect(screen.getByTestId("cold-start-seal", H)).toBeTruthy();
    expect(screen.queryByTestId("cold-start-seal-ring-layer", H)).toBeNull();
    screen.unmount();
    // A seal outside the cold start has no such layer style: its scan is simply there.
    render(<Seal testID="still" civ="cn" size={52} theme={themeFor("CHINESE", "light")} />);
    expect(flat(screen.getByTestId("still-ring-layer", H)).opacity).toBeUndefined();
  });

  it("a tap skips to the end", async () => {
    render(<ColdStart session={{ status: "signedOut" }} scheme="light" />);
    await act(async () => {});
    fireEvent.press(screen.getByTestId("cold-start-skip", H));
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
  });

  it("reduce motion: no stamp — the splash hides and the app is there", async () => {
    reduced = true;
    render(<ColdStart session={{ status: "signedOut" }} scheme="light" />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("the civilization's welcome is due: that plays instead, never both", async () => {
    const first = signedIn({ welcomed_civilizations: [] });
    render(<ColdStart session={first} scheme="light" />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("waits on a booting session, but only so long: then the neutral seal", async () => {
    render(<ColdStart session={{ status: "booting" }} scheme="light" />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("cold-start", H)).toBeTruthy();
  });

  it("once per process: a remount (sign out, sign in) is not a cold start", async () => {
    const { unmount } = render(<ColdStart session={{ status: "signedOut" }} scheme="light" />);
    await act(async () => {});
    fireEvent.press(screen.getByTestId("cold-start-skip", H));
    unmount();
    render(<ColdStart session={signedIn()} scheme="light" />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
  });
});
