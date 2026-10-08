/**
 * The cold start is the soul app's animation in the officer's colours: the same nine strokes, ink on
 * paper (not gold on the deep ground), once per process, none under reduced motion.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SplashScreen from "expo-splash-screen";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { Path } from "react-native-svg";

import { OFFICER_BRAND } from "../brand";
import { ColdStart, coldStart } from "../coldStart";
import { STROKES, motion } from "../shared";

// Every other suite gets jest.setup's inert double; this one tests the real thing.
jest.unmock("../coldStart");

const H = { includeHiddenElements: true };
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe("the officer's cold start", () => {
  let reduced = false;
  beforeEach(() => {
    coldStart.played = false;
    reduced = false;
    (SplashScreen.hideAsync as jest.Mock).mockClear();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => reduced);
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("writes the nine strokes in ink on a paper ground, then is gone at the soul app's own time", async () => {
    render(<ColdStart booting={false} />);
    await act(async () => {});
    fireEvent(screen.getByTestId("cold-start-skip", H), "layout", { nativeEvent: { layout: { width: 393, height: 852 } } });
    expect(flat(screen.getByTestId("cold-start-skip", H)).backgroundColor).toBe(OFFICER_BRAND.ground);
    const strokes = screen.UNSAFE_getAllByType(Path).filter((el) => el.props.testID === "cold-start-stroke");
    expect(strokes).toHaveLength(STROKES.length);
    for (const stroke of strokes) expect(stroke.props.stroke).toBe(OFFICER_BRAND.mark);
    act(() => jest.advanceTimersByTime(motion.coldStartDraw + motion.coldStartHold + motion.coldStart));
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
  });

  it("is ink on paper: the mark is the dark one and the ground the light one", () => {
    expect(OFFICER_BRAND).toEqual({ mark: "#181A17", ground: "#EFEFEB" });
  });

  it("the native splash is the same paper, in both modes", () => {
    const plugins = require("../../app.json").expo.plugins as unknown[];
    const [, splash] = plugins.find((p) => Array.isArray(p) && p[0] === "expo-splash-screen") as [string, { backgroundColor: string; dark: { backgroundColor: string } }];
    expect(splash.backgroundColor).toBe(OFFICER_BRAND.ground);
    expect(splash.dark.backgroundColor).toBe(OFFICER_BRAND.ground);
  });

  it("does not play under reduced motion: the native splash simply goes", async () => {
    reduced = true;
    render(<ColdStart booting={false} />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  it("plays once per process", async () => {
    coldStart.played = true;
    render(<ColdStart booting={false} />);
    await act(async () => {});
    expect(screen.queryByTestId("cold-start", H)).toBeNull();
  });
});
