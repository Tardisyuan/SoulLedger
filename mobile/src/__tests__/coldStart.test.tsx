/**
 * The cold start (补足 C18): the ground, then the brand mark written in nine strokes at once
 * (描 0.6s · 停 0.3s, user decision 2026-10-01), then it recedes.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SplashScreen from "expo-splash-screen";
import sharp from "sharp";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { Path } from "react-native-svg";

import { SHAPE, STROKES, VIEWBOX, pathLength } from "../brandMark";
import { ColdStart, coldStart } from "../coldStart";
import type { SessionState } from "../session";
import { motion, v3 } from "../theme";
import { PROFILE } from "./stubApi";

// Every other suite gets jest.setup's inert double; this one tests the real thing.
jest.unmock("../coldStart");

/** The cold start is hidden from assistive tech; queries must ask for it. */
const H = { includeHiddenElements: true };
// Captured at import, before any beforeEach can clear the double: coldStart.tsx sets it at module load.
const splashOptionsAtLoad = jest.mocked(SplashScreen.setOptions).mock.calls.slice();
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const signedIn = (overrides: Record<string, unknown> = {}): SessionState =>
  ({ status: "signedIn", profile: { ...PROFILE, ...overrides } }) as never;

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

  it("hides the native splash only once its own first frame is laid out; usable 480 after the mark is written and held, gone at 720", async () => {
    render(<ColdStart session={{ status: "signedOut" }} />);
    await act(async () => {});
    expect(screen.getByTestId("cold-start", H)).toBeTruthy();
    expect(hide).not.toHaveBeenCalled();
    layout();
    expect(hide).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(motion.coldStartDraw + motion.coldStartHold + motion.coldStartInteractive - 1));
    expect(screen.getByTestId("cold-start", H).props.pointerEvents).toBe("auto");
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByTestId("cold-start", H).props.pointerEvents).toBe("none");
    act(() => jest.advanceTimersByTime(motion.coldStart - motion.coldStartInteractive));
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
  });

  it("the native splash goes at once — no fade of its own under the receding mark", () => {
    // Its default is a 400ms fade: under the lifting mark that read as two marks, offset.
    // Android reads only `duration`; iOS reads `fade`.
    expect(splashOptionsAtLoad).toEqual([[{ duration: 0, fade: false }]]);
  });

  it("frame 0 is the native splash's picture: its ground, no mark yet — every stroke undrawn", async () => {
    const plugins = require("../../app.json").expo.plugins as unknown[];
    const [, splash] = plugins.find((p) => Array.isArray(p) && p[0] === "expo-splash-screen") as [string, Record<string, never>];
    // The ground alone, in both modes (v3's dark canvas): the mark is written by JS, so the native splash carries none.
    expect(splash).toMatchObject({ image: "./assets/splash-blank.png", backgroundColor: v3.dark.canvas, dark: { image: "./assets/splash-blank.png", backgroundColor: v3.dark.canvas } });
    const { data, info } = await sharp(join(__dirname, "../../assets/splash-blank.png")).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(data.some((v, k) => k % 4 === 3 && v > 0)).toBe(false);
    render(<ColdStart session={signedIn()} />);
    await act(async () => {});
    expect(flat(screen.getByTestId("cold-start-skip", H)).backgroundColor).toBe(splash.backgroundColor);
    // The Path elements themselves: the native one below them drops `animatedProps`.
    const strokes = screen.UNSAFE_getAllByType(Path).filter((el) => el.props.testID === "cold-start-stroke");
    expect(strokes).toHaveLength(STROKES.length);
    // Reanimated's jest mock never re-runs animated props, so the tree shows the first frame:
    // each dash pushed back by its whole stroke.
    strokes.forEach((el, i) => {
      const length = pathLength(STROKES[i][0]);
      expect(el.props.strokeDasharray).toEqual([length, length]);
      expect(el.props.animatedProps.strokeDashoffset).toBeCloseTo(length);
    });
    expect(flat(screen.getByTestId("cold-start-mark-layer", H))).toMatchObject({ opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] });
    expect(screen.queryByTestId("cold-start-seal", H)).toBeNull();
  });

  it("the mark's outline is the icon's own: SHAPE is soulledger-mark.svg's paths, its triangle cut folded in", () => {
    const svg = readFileSync(join(__dirname, "../../assets/brand/soulledger-mark.svg"), "utf8");
    const hole = svg.match(/<mask[\s\S]*?<path d="([^"]+)"/)![1];
    const shapes = [...svg.match(/<g fill="currentColor"[^>]*>([\s\S]*)<\/g>/)![1].matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    expect(SHAPE).toEqual([shapes[0], `${shapes[1]} ${hole}`, shapes[2]]);
    expect(VIEWBOX).toBe(svg.match(/viewBox="([^"]+)"/)![1]);
  });

  it("pathLength agrees with the browser's getTotalLength for every stroke", () => {
    // Chrome, 2026-10-01, on these exact centre lines.
    const browser = [1060.31, 377.13, 118.19, 153.89, 288.36, 173.3, 150.82, 239, 252];
    expect(STROKES.map(([d]) => pathLength(d))).toEqual(browser.map((b) => expect.closeTo(b, 0)));
    expect(() => pathLength("M0 0A10 10 0 0 0 5 0")).toThrow(/half-circle/);
    expect(() => pathLength("M0 0S1 1 2 2")).toThrow(/unsupported/);
  });

  it("the strokes write over coldStartDraw; after the hold the mark recedes by 480 — up 8, to 0.96, out — and the ground fades 480 → 720", async () => {
    // The curve is read off the calls that build it.
    const R = jest.requireMock("react-native-reanimated") as Record<string, (...a: unknown[]) => unknown>;
    const timing = jest.spyOn(R, "withTiming");
    const delay = jest.spyOn(R, "withDelay");
    render(<ColdStart session={{ status: "signedOut" }} />);
    await act(async () => {});
    const recede = { duration: motion.coldStartInteractive, easing: expect.anything() };
    expect(timing.mock.calls).toEqual(expect.arrayContaining([[-8, recede], [0.96, recede], [0, recede]]));
    expect(timing.mock.calls).toContainEqual([1, { duration: motion.coldStartDraw, easing: expect.anything() }]);
    expect(timing.mock.calls).toContainEqual([0, { duration: motion.coldStart - motion.coldStartInteractive, easing: expect.anything() }]);
    const written = motion.coldStartDraw + motion.coldStartHold;
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([written, written, written, written + motion.coldStartInteractive]);
    timing.mockRestore();
    delay.mockRestore();
  });

  it("a tap skips to the end", async () => {
    render(<ColdStart session={{ status: "signedOut" }} />);
    await act(async () => {});
    fireEvent.press(screen.getByTestId("cold-start-skip", H));
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
  });

  it("reduce motion: nothing plays — the splash hides and the app is there", async () => {
    reduced = true;
    render(<ColdStart session={{ status: "signedOut" }} />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("the civilization's welcome is due: that plays instead, never both", async () => {
    const first = signedIn({ welcomed_civilizations: [] });
    render(<ColdStart session={first} />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("waits on a booting session, but only so long", async () => {
    render(<ColdStart session={{ status: "booting" }} />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("cold-start", H)).toBeTruthy();
  });

  it("once per process: a remount (sign out, sign in) is not a cold start", async () => {
    const { unmount } = render(<ColdStart session={{ status: "signedOut" }} />);
    await act(async () => {});
    fireEvent.press(screen.getByTestId("cold-start-skip", H));
    unmount();
    render(<ColdStart session={signedIn()} />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
  });
});
