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
import { AccessibilityInfo, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppHeader } from "../chrome";
import { HERO } from "../emblems";
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

/**
 * v2 补足 C15 supersedes 1c / 1d: a sub-page's title bar is the simplified plaque — the
 * 匾色 ground and the civilization's 22pt band at its foot, in place of v1's 6pt band.
 */
describe("the simplified plaque on every other title bar (补足 C15)", () => {
  it.each(CIVS.filter((c) => c !== "neutral"))("%s: 匾色 ground, its own band only, the title in its face at 20", async (civ) => {
    wrap(<AppHeader title="设置" onBack={jest.fn()} />, civ);
    const theme = themeFor(CIVILIZATION[civ], "dark");
    expect(StyleSheet.flatten(screen.getByTestId("header").props.style).backgroundColor).toBe(theme.band);
    expect(screen.getByTestId(`plaque-band-${civ}`)).toBeTruthy();
    for (const other of CIVS.filter((c) => c !== civ && c !== "neutral")) expect(screen.queryByTestId(`plaque-band-${other}`)).toBeNull();
    const title = StyleSheet.flatten(screen.getByRole("header").props.style);
    expect(title).toMatchObject({ fontSize: 20, color: theme.onPlaque });
    // v1's 6pt band is gone, not doubled under the plaque's.
    expect(screen.queryAllByTestId(/^header-band-/)).toEqual([]);
    await act(async () => {});
  });

  it("neutral (before sign-in): the neutral plaque, no band, the title in the interface face", () => {
    wrap(<AppHeader title="灵魂簿" />, "neutral");
    expect(StyleSheet.flatten(screen.getByTestId("header").props.style).backgroundColor).toBe(themeFor(null, "dark").band);
    expect(screen.queryAllByTestId(/^plaque-band-/)).toEqual([]);
    expect(StyleSheet.flatten(screen.getByRole("header").props.style).fontSize).toBe(15);
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
  // Once per soul × civilization per process is module state: each test is a soul of its own.
  let n = 0;
  const P = (over: Record<string, unknown>) => ({ ...PROFILE, soul_code: `SL-CN-W${++n}`, ...over }) as never;

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

  const OK = { status: 200, data: { welcomed_civilizations: ["CHINESE"] } };
  const tree = (profile: never) => (
    <I18nProvider>
      <Welcome profile={profile} scheme="dark" />
    </I18nProvider>
  );
  function play(profile: never, reply: { status: number; data?: unknown } = OK) {
    const calls = stubApi({ "POST /me/welcomed/": reply });
    const view = render(tree(profile));
    return { calls, view };
  }
  const writes = (calls: { url: string }[]) => calls.filter((c) => c.url === "/me/welcomed/");

  it("first sign-in: neutral → the Diyu, named as the underworld, not the civilization", async () => {
    play(P({ welcomed_civilizations: [] }));
    await act(async () => {});
    expect(screen.getByTestId("welcome-neutral-cn")).toBeTruthy();
    expect(screen.getByText("你已进入中国地府")).toBeTruthy();
    expect(screen.queryByText("你已进入中国")).toBeNull();
  });

  it("each civilization is entered by its underworld's name", async () => {
    const names: [string, string][] = [["EUROPEAN", "你已进入天堂与地狱"], ["EGYPTIAN", "你已进入杜阿特"], ["GREEK", "你已进入希腊冥界"]];
    for (const [civilization, text] of names) {
      const { view } = play(P({ civilization, home_civilization: civilization, welcomed_civilizations: [] }));
      await act(async () => {});
      expect(screen.getByText(text)).toBeTruthy();
      view.unmount();
    }
  });

  describe("the record is written once the welcome has been seen — not when it starts", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("started, then unmounted before it finished: nothing is written", async () => {
      const { calls, view } = play(P({ welcomed_civilizations: [] }));
      await act(async () => {});
      expect(screen.getByTestId("welcome")).toBeTruthy();
      await act(async () => void jest.advanceTimersByTime(700)); // faded in, still holding
      view.unmount();
      await act(async () => void jest.advanceTimersByTime(5000));
      expect(writes(calls)).toEqual([]);
    });

    it("played to the end: written once, and the overlay is gone", async () => {
      const { calls } = play(P({ welcomed_civilizations: [] }));
      await act(async () => {});
      await act(async () => void jest.advanceTimersByTime(1000));
      expect(writes(calls)).toEqual([]); // mid-way: not yet
      await act(async () => void jest.advanceTimersByTime(3000));
      expect(screen.queryByTestId("welcome")).toBeNull();
      expect(writes(calls)).toEqual([expect.objectContaining({ method: "POST", body: { civilization: "CHINESE" } })]);
    });

    it("skipped with a tap: written once, at the tap", async () => {
      const { calls } = play(P({ welcomed_civilizations: [] }));
      await act(async () => {});
      expect(writes(calls)).toEqual([]);
      fireEvent.press(screen.getByTestId("welcome-skip"));
      await act(async () => {});
      expect(screen.queryByTestId("welcome")).toBeNull();
      expect(writes(calls)).toHaveLength(1);
      await act(async () => void jest.advanceTimersByTime(5000));
      expect(writes(calls)).toHaveLength(1);
    });
  });

  it("plays once per soul × civilization: the same profile again does not replay or rewrite", async () => {
    const profile = P({ welcomed_civilizations: [] });
    const { calls, view } = play(profile);
    await act(async () => {});
    fireEvent.press(screen.getByTestId("welcome-skip"));
    view.rerender(tree(profile));
    await act(async () => {});
    expect(screen.queryByTestId("welcome")).toBeNull();
    // Nor after a remount (sign out and in) in the same process.
    view.unmount();
    render(tree(profile));
    await act(async () => {});
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(writes(calls)).toHaveLength(1);
  });

  it("the server already has it: nothing plays and nothing is written", async () => {
    const { calls } = play(P({ welcomed_civilizations: ["CHINESE"] }));
    await act(async () => {});
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("home again after a residence: the Duat → the Diyu, although home was recorded before", async () => {
    play(P({ welcomed_civilizations: ["CHINESE", "EGYPTIAN"] }));
    await act(async () => {});
    expect(screen.getByTestId("welcome-eg-cn")).toBeTruthy();
  });

  it("reduce-motion: nothing shown, and the record is written at once", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const { calls } = play(P({ welcomed_civilizations: [] }));
    await act(async () => {});
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(writes(calls)).toHaveLength(1);
  });

  it("the write fails: no replay in this process (the next launch decides again)", async () => {
    const profile = P({ welcomed_civilizations: [] });
    const { calls, view } = play(profile, { status: 500 });
    await act(async () => {});
    fireEvent.press(screen.getByTestId("welcome-skip"));
    await act(async () => {});
    view.rerender(tree(profile));
    await act(async () => {});
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(writes(calls)).toHaveLength(1);
  });
});
