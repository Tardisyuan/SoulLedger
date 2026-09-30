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
import { PlaqueHeader } from "../chrome";
import { ColdStart, coldStart } from "../coldStart";
import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { DEFAULT_GLYPHS, Seal, sealGlyphs } from "../seal";
import { SessionContext, type SessionState } from "../session";
import { motion, themeFor } from "../theme";
import { ThemeContext } from "../ui";
import { PROFILE } from "./stubApi";

// Every other suite gets jest.setup's inert double; this one tests the real thing.
jest.unmock("../coldStart");

/** The seal beside words and the cold start are hidden from assistive tech; queries must ask for them. */
const H = { includeHiddenElements: true };
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

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
  it("carries no c2pa metadata, and every civilization has its six drawings", () => {
    expect(Object.entries(SVG).filter(([, xml]) => /<metadata|c2pa:manifest/.test(xml))).toEqual([]);
    for (const civ of ["cn", "eu", "eg", "gr"]) {
      for (const part of ["seal-%-body", "seal-%-ring", "seal-%-line", "seal-%-line-small", "band-%", "band-%-compact"]) {
        expect(SVG).toHaveProperty(part.replace("%", civ));
      }
      expect(RING_D[civ as keyof typeof RING_D]).toMatch(/^M/);
    }
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
    expect(flat(glyph)).toMatchObject({ fontFamily: "LXGWSeal_400", fontSize: 28, color: "#FFF4E8" });
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

describe("the plaque on the life tab", () => {
  it("匾色 ground, the tenant's seal read as 「第五殿之印」, the title, the life and the hall, the band", () => {
    wrap(<PlaqueHeader title="本世" onAccount={() => {}} />, signedIn({ tenant: { ...PROFILE.tenant, seal_glyphs: ["五"] } }));
    expect(flat(screen.getByTestId("plaque")).backgroundColor).toBe("#9A2F1F");
    expect(screen.getByTestId("plaque-seal").props.accessibilityLabel).toBe("第五殿之印");
    expect(screen.getByTestId("plaque-seal-glyph").props.children).toBe("五");
    expect(flat(screen.getByText("本世"))).toMatchObject({ fontSize: 28, fontFamily: "NotoSerifSC_400", color: "#FFF4E8" });
    expect(screen.getByText("第 2 世 · 第五殿")).toBeTruthy();
    expect(screen.getByTestId("plaque-band-cn")).toBeTruthy();
    expect(screen.getByTestId("header-account")).toBeTruthy();
  });

  it("an empty seal_glyphs shows the default, 冥", () => {
    wrap(<PlaqueHeader title="本世" onAccount={() => {}} />, signedIn());
    expect(screen.getByTestId("plaque-seal-glyph").props.children).toBe("冥");
  });

  it("a civilization the app does not know gets the plain bar, no plaque and no seal", () => {
    wrap(<PlaqueHeader title="本世" onAccount={() => {}} />, signedIn({ civilization: "ATLANTEAN" }), "ATLANTEAN");
    expect(screen.queryByTestId("plaque")).toBeNull();
    expect(screen.getByTestId("header")).toBeTruthy();
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
