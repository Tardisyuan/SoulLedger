/**
 * Design v4 第六十二批 §二: after 「登录」 — the welcome redrawn (canvas ground, the top line drawing in, the seal
 * stamped down, the sentence), timed as an entrance 360, a still hold 900 and a hand-off 320; a tap skips the hold,
 * not the hand-off; reduce motion shows a still frame; the 「下次用面容登录?」 sheet waits for the hand-off's end.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";

import { headerSeal, lifeEntrance } from "../entrance";
import { I18nProvider } from "../i18n";
import { motion, seal, themeFor, v4 } from "../theme";
import { OutlineSeal } from "../seal";
import { WELCOME, Welcome, flightTo, useArrival } from "../welcome";
import { PROFILE, stubApi } from "./stubApi";

let n = 0;
const P = (over: Record<string, unknown> = {}) => ({ ...PROFILE, soul_code: `SL-CN-X${++n}`, welcomed_civilizations: [], ...over }) as never;
const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) as Record<string, unknown>;
const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const durations = (spy: jest.SpyInstance) => spy.mock.calls.map(([, c]) => (c as { duration: number }).duration);

describe("第六十二批 · the welcome", () => {
  let reduced = false;
  beforeEach(() => {
    reduced = false;
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => reduced);
    stubApi({ "POST /me/welcomed/": { status: 200, data: { welcomed_civilizations: ["CHINESE"] } } });
    jest.useFakeTimers();
    headerSeal.current = null;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    headerSeal.current = null;
  });

  const play = async (profile = P(), onSettled = jest.fn()) => {
    render(
      <I18nProvider>
        <Welcome profile={profile} scheme="light" onSettled={onSettled} />
      </I18nProvider>,
    );
    await act(async () => {});
    return onSettled;
  };

  it("the timetable: two pieces of motion, each inside 480 — no new named exception — around a still 900", () => {
    const entrance = Math.max(WELCOME.line, WELCOME.sealAt + WELCOME.seal, WELCOME.textAt + WELCOME.text);
    const handOff = Math.max(WELCOME.flight, WELCOME.textOut, WELCOME.riseAt + WELCOME.rise);
    expect([entrance, WELCOME.hold, handOff]).toEqual([360, 900, 320]);
    expect([motion.welcomeIn, motion.welcomeHold, motion.welcomeOut]).toEqual([entrance, WELCOME.hold, handOff]);
    expect(Math.max(entrance, handOff)).toBeLessThanOrEqual(480);
    expect(WELCOME.still).toBe(80);
  });

  it("the ground is the page's canvas, never a wash of the civilization's colour; the seal is the header seal's plaque, stamped 1.18 → 1", async () => {
    await play();
    const cn = themeFor("CHINESE", "light");
    expect(flat("welcome-ground").backgroundColor).toBe(cn.s0);
    expect(flat("welcome-ground").backgroundColor).toBe(v4.light.main);
    expect(flat("welcome-ground").backgroundColor).not.toBe(cn.s1);
    // Frame 0: nothing drawn yet — the line at 0 wide, the seal up at 1.18 and clear, the sentence clear.
    expect(flat("welcome-line").transform).toEqual([{ scaleX: 0 }]);
    expect(flat("welcome-seal").opacity).toBe(0);
    expect(flat("welcome-text").opacity).toBe(0);
    expect(screen.getByText("你已进入中国地府")).toBeTruthy();
    // 第六十三批 三 d: the header seal's colour (`plaque`, civT), not the `seal` token — it shrinks into that seal.
    expect(seal.cn.light).not.toBe(cn.plaque);
    expect(screen.UNSAFE_getByType(OutlineSeal).props.color).toBe(cn.plaque);
  });

  it("entrance 360, hold 900, then the hand-off 320: the sheet's wait ends only when the hand-off does", async () => {
    const timing = jest.spyOn(Animated, "timing");
    const settled = await play();
    // The entrance's three pieces: the line 240, the seal 200, the sentence 160 — nothing else moves.
    expect(durations(timing)).toEqual([WELCOME.line, WELCOME.seal, WELCOME.text]);
    timing.mockClear();
    // Jest's Animated clock is coarse (frames of 16, the sequence's joins), so the hold is checked in its middle.
    await advance(motion.welcomeIn + motion.welcomeHold / 2);
    expect(durations(timing)).toEqual([]); // the hold is still
    expect(settled).not.toHaveBeenCalled();
    expect(screen.getByTestId("welcome")).toBeTruthy();
    // Step to the hand-off's start: its pieces begin, and the sheet still waits.
    for (let i = 0; i < 40 && !timing.mock.calls.length; i++) await advance(20);
    expect(durations(timing)).toEqual(expect.arrayContaining([WELCOME.textOut, WELCOME.rise]));
    expect(settled).not.toHaveBeenCalled(); // the hand-off has begun: the sheet still waits for its end
    expect(screen.getByTestId("welcome")).toBeTruthy();
    await advance(motion.welcomeOut + 40);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("welcome")).toBeNull();
  });

  it("held under 「已锁定」: nothing shows and nothing is recorded; it plays once the lock is down", async () => {
    const calls = stubApi({ "POST /me/welcomed/": { status: 200, data: { welcomed_civilizations: ["CHINESE"] } } });
    const profile = P();
    const settled = jest.fn();
    const tree = (held: boolean) => (
      <I18nProvider>
        <Welcome profile={profile} scheme="light" onSettled={settled} held={held} />
      </I18nProvider>
    );
    const { rerender } = render(tree(true));
    await act(async () => {});
    await advance(motion.welcomeIn + motion.welcomeHold + motion.welcomeOut + 200);
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(calls.filter((c) => c.url.includes("/me/welcomed/"))).toEqual([]);
    expect(settled).not.toHaveBeenCalled();
    rerender(tree(false));
    await act(async () => {});
    expect(screen.getByTestId("welcome")).toBeTruthy();
  });

  it("a tap skips the hold, not the hand-off: the hand-off runs from the tap, and the sheet waits for its end", async () => {
    const settled = await play();
    await advance(100); // mid-entrance
    const timing = jest.spyOn(Animated, "timing");
    fireEvent.press(screen.getByTestId("welcome-skip"));
    await act(async () => {});
    // The entrance lands on its end, then the hand-off's pieces start: no header seal on screen, so it fades in place.
    expect(screen.getByTestId("welcome")).toBeTruthy();
    expect(settled).not.toHaveBeenCalled();
    expect(durations(timing)).toEqual(expect.arrayContaining([WELCOME.textOut, WELCOME.textOut, WELCOME.rise]));
    expect(durations(timing)).not.toContain(WELCOME.flight);
    await advance(motion.welcomeOut + 40);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("welcome")).toBeNull();
  });

  it("the hand-off: the seal shrinks onto the 本世 header's seal, wherever that is on screen", async () => {
    await play();
    fireEvent(screen.getByTestId("welcome-seal"), "layout", { nativeEvent: { layout: { x: 147, y: 330, width: 96, height: 96 } } });
    headerSeal.current = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(20, 70, 64, 64) } as never;
    const timing = jest.spyOn(Animated, "timing");
    await advance(motion.welcomeIn + motion.welcomeHold + 10);
    expect(durations(timing)).toContain(WELCOME.flight);
    // The seal's own fade (the fallback) does not run: it flies instead.
    const fades = timing.mock.calls.filter(([, c]) => (c as { toValue: number }).toValue === 0).map(([, c]) => (c as { duration: number }).duration);
    expect(fades.sort()).toEqual([WELCOME.textOut, WELCOME.rise].sort()); // the sentence and the ground; the seal does not fade
  });

  it("the flight: centre to centre, scaled to the header seal's width; nowhere to land, no flight", () => {
    // Centre (195, 378) → (52, 102), 96 → 64.
    expect(flightTo({ x: 147, y: 330, width: 96, height: 96 }, { x: 20, y: 70, width: 64, height: 64 }, 852)).toEqual({ dx: -143, dy: -276, scale: 64 / 96 });
    expect(flightTo({ x: 147, y: 330, width: 96, height: 96 }, { x: 20, y: -80, width: 64, height: 64 }, 852)).toBeNull(); // scrolled off
    expect(flightTo({ x: 147, y: 330, width: 96, height: 96 }, { x: 20, y: 900, width: 64, height: 64 }, 852)).toBeNull();
    expect(flightTo({ x: 147, y: 330, width: 96, height: 96 }, { x: 0, y: 0, width: 0, height: 0 }, 852)).toBeNull(); // not laid out
    expect(flightTo(null, { x: 20, y: 70, width: 64, height: 64 }, 852)).toBeNull();
  });

  it("the 本世 page waits 8 low under the ground and rises into place in the hand-off", async () => {
    await play();
    expect((lifeEntrance.rise as unknown as { __getValue(): number }).__getValue()).toBe(0);
    await advance(motion.welcomeIn + motion.welcomeHold + motion.welcomeOut + 40);
    expect((lifeEntrance.rise as unknown as { __getValue(): number }).__getValue()).toBe(1);
    expect((lifeEntrance.opacity as unknown as { __getValue(): number }).__getValue()).toBe(1);
  });

  describe("a later sign-in (no welcome): 320, not a cut", () => {
    function Arrive({ on }: { on: boolean }) {
      useArrival(on);
      return null;
    }
    const value = (v: Animated.Value) => (v as unknown as { __getValue(): number }).__getValue();

    it("the page waits 8 low and clear, then rises and fades in from 80 over 240; no seal", async () => {
      const timing = jest.spyOn(Animated, "timing");
      render(<Arrive on />);
      await act(async () => {});
      expect([value(lifeEntrance.opacity), value(lifeEntrance.rise)]).toEqual([0, 0]);
      expect(durations(timing)).toEqual([WELCOME.rise, WELCOME.rise]);
      expect(WELCOME.riseAt + WELCOME.rise).toBe(320);
      expect(screen.queryByTestId("welcome-seal")).toBeNull();
    });

    it("reduce motion: an 80 fade, no rise", async () => {
      reduced = true;
      const timing = jest.spyOn(Animated, "timing");
      render(<Arrive on />);
      await act(async () => {});
      expect([value(lifeEntrance.opacity), value(lifeEntrance.rise)]).toEqual([0, 1]);
      expect(durations(timing)).toEqual([WELCOME.still]);
    });

    it("not a sign-in (a restored session, or a welcome due): the page is left alone", async () => {
      const timing = jest.spyOn(Animated, "timing");
      render(<Arrive on={false} />);
      await act(async () => {});
      expect(timing).not.toHaveBeenCalled();
      expect([value(lifeEntrance.opacity), value(lifeEntrance.rise)]).toEqual([1, 1]);
    });
  });

  it("reduce motion: a still frame — everything in place, no scale, no line drawing — 80 in, 900, 80 out", async () => {
    reduced = true;
    const timing = jest.spyOn(Animated, "timing");
    const settled = await play();
    expect(flat("welcome-line").transform).toEqual([{ scaleX: 1 }]);
    expect(flat("welcome-seal").opacity).toBe(1);
    expect((flat("welcome-seal").transform as Record<string, number>[])[2].scale).toBe(1);
    expect(flat("welcome").opacity).toBe(0);
    expect(durations(timing)).toEqual([WELCOME.still]); // the whole frame fading in, and nothing else
    await advance(WELCOME.still + WELCOME.hold / 2);
    expect(settled).not.toHaveBeenCalled();
    for (let i = 0; i < 60 && timing.mock.calls.length < 2; i++) await advance(20);
    // Out: the frame fades 80, then the page 80 — opacity only, no rise.
    expect(durations(timing)).toEqual([WELCOME.still, WELCOME.still, WELCOME.still]);
    await advance(WELCOME.still * 2 + 40);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("welcome")).toBeNull();
  });
});
