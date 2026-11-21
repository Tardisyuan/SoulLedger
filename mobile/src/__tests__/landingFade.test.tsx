/**
 * The changed-row / push-landing ground: one recipe in both apps and on the web (第四十批 S-e 「同其他推送的 2 秒底色」):
 * held for `highlight - highlightFade` (1600), then faded over `highlightFade` (400) on the exit curve — 2s in all.
 * The web's half (`row-changed`) is held to the same numbers by frontend/src/__tests__/motionParity.test.ts.
 *
 * Mutations seen red: the hold `motion.highlight - motion.highlightFade` → `1200` (the timing test); cooldown.tsx back
 * on its own `Animated.timing` (the one-recipe test).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderHook } from "@testing-library/react-native";
import { Animated } from "react-native";

import { motion } from "@soulledger/mobile-ui/src/theme";
import { EASE, useLandingFade } from "@soulledger/mobile-ui/src/ui";

describe("useLandingFade", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("holds 1600, then fades over 400 on the exit curve", () => {
    const start = jest.fn();
    const timing = jest.spyOn(Animated, "timing").mockReturnValue({ start, stop: jest.fn(), reset: jest.fn() } as unknown as Animated.CompositeAnimation);
    renderHook(() => useLandingFade(true, false));
    jest.advanceTimersByTime(1599);
    expect(start).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0][1]).toMatchObject({ toValue: 0, duration: 400, easing: EASE.exit });
    expect([motion.highlight, motion.highlightFade]).toEqual([2000, 400]);
  });

  it.each([
    ["reduce motion", true, true],
    ["not landed", false, false],
  ])("%s: nothing runs", (_n, reduced, on) => {
    const timing = jest.spyOn(Animated, "timing");
    renderHook(() => useLandingFade(on, reduced));
    jest.advanceTimersByTime(5000);
    expect(timing).not.toHaveBeenCalled();
  });
});

describe("one recipe: every landing in both apps uses it", () => {
  const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", "..", ...p), "utf8");
  it.each([
    ["packages/mobile-ui/src/ui.tsx", "LandingWash"],
    ["mobile/src/screens/cooldown.tsx", "LandingWash"],
    ["mobile/src/screens/applications.tsx", "LandingHighlight"],
    ["mobile/src/screens/conversation.tsx", "Bubble"],
    ["mobile-officer/src/kit.tsx", "Highlight"],
  ])("%s (%s)", (file, fn) => {
    const src = read(file);
    const at = src.search(new RegExp(`function ${fn}\\(`));
    expect(at).toBeGreaterThan(-1);
    // A top-level function ends at the first unindented `}` (`Bubble` is wrapped in `memo(...)`: `});`).
    const end = src.indexOf(fn === "Bubble" ? "\n});" : "\n}\n", at);
    expect(end).toBeGreaterThan(at);
    const body = src.slice(at, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(body).toMatch(/useLandingFade\(/);
    expect(body).not.toMatch(/Animated\.timing\(/);
    expect(body).not.toMatch(/\b(1200|400|1600)\b/);
  });
});
