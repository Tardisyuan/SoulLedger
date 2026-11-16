/**
 * Design 第五十八 / 五十九批, the motion both apps share (the web half is frontend/src/__tests__/motionParity.test.ts):
 * the toast's 8pt rise (M2), the system modals' own fade (M4), the 「此生」 ring's three breaths (M5), the skeleton's 400
 * wait and 300 stay (M6), content's 160 fade (M7), the top line on a refresh (M8), the busy button's line (M10) and the
 * one highlight strength (第五十九批). The officer app's halves: mobile-officer/src/__tests__/motionBatch58.test.tsx.
 *
 * Mutations seen red (each reverted): see the note on each `it`.
 */
import { act, fireEvent, renderHook, screen } from "@testing-library/react-native";
import { useEffect } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text } from "react-native";

import { Topline } from "../civHead";
import { ToastProvider, TOAST_RISE_PT, useToast } from "../feedback";
import { HereRing } from "../screens/life";
import { HIGHLIGHT_ALPHA, motion } from "../theme";
import { Button, EASE, FadeIn, FadeModal, LandingWash, Skeleton, runTopline, skeletonHoldLeft, useRemote } from "../ui";
import { inSoulFrame, renderSoul } from "./harness";

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const reduce = (on: boolean) => jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(on);
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

afterEach(() => jest.restoreAllMocks());

describe("M2: the toast rises 8 as it fades in, on the named curves", () => {
  let say: (m: string) => void = () => {};
  function Say() {
    const show = useToast();
    useEffect(() => {
      say = show;
    }, [show]);
    return null;
  }
  // Mutation: the translateY dropped from feedback.tsx → the reduce-false case red; `reduced ? null :` removed → the
  // reduce-true case red.
  it.each([false, true])("reduce motion %s", async (reduced) => {
    reduce(reduced);
    renderSoul(
      <ToastProvider>
        <Say />
      </ToastProvider>
    );
    await act(async () => {}); // the OS has answered before anything is said
    const timing = jest.spyOn(Animated, "timing");
    act(() => say("已保存"));
    await act(async () => {});
    const style = flat(screen.UNSAFE_getByProps({ accessibilityRole: "alert" }));
    if (reduced) expect(style.transform).toBeUndefined();
    else expect(JSON.stringify(style.transform)).toContain("translateY");
    expect(TOAST_RISE_PT).toBe(8);
    const enter = timing.mock.calls.map((c) => c[1]).filter((c) => c.toValue === 1 && c.easing === EASE.enter).at(-1);
    expect(enter?.duration).toBe(reduced ? 80 : 160);
  });

  it("leaves over 160 (第五十九批: 140 is gone)", () => {
    expect([motion.toastIn, motion.toastOut]).toEqual([160, 160]);
  });
});

describe("M4: a system modal fades on the shared values, 80 under reduce motion, and stays up through its fade-out", () => {
  // Mutation: FadeModal's `dialogOut` → `0` with no fade-out kept → the 'still up after close' assertion red.
  it.each([
    [false, 240, 160],
    [true, 80, 80],
  ])("reduce motion %s: in %d, out %d", async (reduced, inMs, outMs) => {
    reduce(reduced);
    const timing = jest.spyOn(Animated, "timing");
    const ui = (visible: boolean) => (
      <FadeModal visible={visible} onRequestClose={jest.fn()}>
        <Text testID="modal-body">x</Text>
      </FadeModal>
    );
    const view = renderSoul(ui(true));
    await act(async () => {});
    expect(timing.mock.calls.at(-1)![1]).toMatchObject({ toValue: 1, duration: inMs, easing: EASE.enter });
    view.rerender(inSoulFrame(ui(false)));
    expect(timing.mock.calls.at(-1)![1]).toMatchObject({ toValue: 0, duration: outMs, easing: EASE.exit });
    expect(screen.getByTestId("modal-body")).toBeTruthy();
    await wait(outMs + 200);
    expect(screen.queryByTestId("modal-body")).toBeNull();
  });
});

describe("M5: 「此生」's here ring breathes three times, then stops", () => {
  // Mutation: `iterations: BREATHE_MOTION.iterations` removed (loops forever) → red.
  it("2.4s a breath, three of them; not at all under reduce motion", async () => {
    reduce(false);
    const loop = jest.spyOn(Animated, "loop");
    const timing = jest.spyOn(Animated, "timing");
    renderSoul(<HereRing testID="ring" style={{}} />);
    await act(async () => {});
    expect(loop.mock.calls.at(-1)![1]).toEqual({ iterations: 3 });
    expect(timing.mock.calls.slice(-2).map((c) => c[1].duration)).toEqual([1200, 1200]);
    expect(JSON.stringify(flat(screen.getByTestId("ring")).transform)).toContain("scale");
  });

  it("reduce motion: still", async () => {
    reduce(true);
    renderSoul(<HereRing testID="ring" style={{}} />);
    await act(async () => {});
    expect(flat(screen.getByTestId("ring")).transform).toBeUndefined();
    expect(flat(screen.getByTestId("ring")).opacity).toBeUndefined();
  });
});

describe("M6: a skeleton waits 400 before it shows, and once shown stays 300", () => {
  // Mutation: `useAfter(motion.skeletonDelay)` → `useAfter(0)` → the 'nothing at 390' assertion red.
  it("nothing for the first 400", async () => {
    renderSoul(<Skeleton lines={2} testID="sk" />);
    await wait(380);
    expect(screen.queryByTestId("sk")).toBeNull();
    await wait(60);
    expect(screen.getByTestId("sk")).toBeTruthy();
  });

  // Mutation: `since > motion.skeletonDelay` → `since >= 0` → the under-400 case red.
  it("the wait an answer adds: none under 400 (never shown), up to 700 after the start, none past it", () => {
    expect([motion.skeletonDelay, motion.skeletonHold]).toEqual([400, 300]);
    expect(skeletonHoldLeft(50)).toBe(0);
    expect(skeletonHoldLeft(400)).toBe(0);
    expect(skeletonHoldLeft(450)).toBe(250);
    expect(skeletonHoldLeft(699)).toBe(1);
    expect(skeletonHoldLeft(900)).toBe(0);
  });

  // Mutation: `cold ? skeletonHoldLeft(...) : 0` → `0` → red (data at 500, not 700).
  it("useRemote: an answer at 500 with nothing on screen paints at 700; a quick one at once", async () => {
    let answer!: (v: string) => void;
    const slow = () => new Promise<string>((r) => (answer = r));
    const { result } = renderHook(() => useRemote(slow)); // one fetcher for every render (a new one is a new request)
    await wait(500);
    await act(async () => answer("a"));
    expect(result.current.data).toBeNull();
    await wait(150);
    expect(result.current.data).toBeNull();
    await wait(100);
    expect(result.current.data).toBe("a");
    const fast = () => Promise.resolve("b");
    const quick = renderHook(() => useRemote(fast));
    await act(async () => {});
    expect(quick.result.current.data).toBe("b");
  });
});

describe("M7: content after its skeleton fades in over 160 on the enter curve", () => {
  // Mutation: the reveal token back to 200 → red.
  it.each([
    [false, 160],
    [true, 80],
  ])("reduce motion %s: %d", async (reduced, ms) => {
    reduce(reduced);
    const timing = jest.spyOn(Animated, "timing");
    renderSoul(
      <FadeIn>
        <Text>x</Text>
      </FadeIn>
    );
    await act(async () => {});
    expect(timing.mock.calls.at(-1)![1]).toMatchObject({ toValue: 1, duration: ms, easing: EASE.enter });
  });
});

describe("M8: a refresh of what is on screen runs the top line once", () => {
  // Mutation: the `runs` effect in Topline returning early always → the run never appears → red.
  it("runTopline(): one 1.2s run in the civilization's colour, then the line is itself again", async () => {
    reduce(false);
    renderSoul(<Topline />);
    await act(async () => {});
    expect(screen.queryByTestId("topline-run")).toBeNull();
    act(() => runTopline());
    expect(screen.getByTestId("topline-run")).toBeTruthy();
    expect(screen.getAllByTestId("topline-bar").every((b) => flat(b).opacity === 0.3)).toBe(true);
    await wait(motion.loadingLine + 200);
    expect(screen.queryByTestId("topline-run")).toBeNull();
    expect(screen.getAllByTestId("topline-bar").every((b) => flat(b).opacity === 1)).toBe(true);
  });
});

describe("M10: a busy button keeps its words and look; past 160 a line runs along its foot", () => {
  // Mutation: `useAfter(motion.busyDelay)` → `useAfter(0)` → the 'nothing at 100' assertion red; the Loader back in
  // the button → the 'no progressbar' assertion red.
  it("words and ground unchanged, cannot be pressed, the line only after 160, in the text colour at 60%", async () => {
    reduce(false);
    const onPress = jest.fn();
    renderSoul(
      <>
        <Button testID="b" title="提交" busy onPress={onPress} />
        <Button testID="i" title="不忙" onPress={jest.fn()} />
      </>
    );
    await act(async () => {});
    expect(flat(screen.getByTestId("b")).backgroundColor).toBe(flat(screen.getByTestId("i")).backgroundColor);
    expect(flat(screen.getByText("提交")).color).toBe(flat(screen.getByText("不忙")).color);
    expect(screen.getByTestId("b").props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    fireEvent.press(screen.getByTestId("b"));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).toBeNull();
    await wait(100);
    expect(screen.queryByTestId("b-busy", { includeHiddenElements: true })).toBeNull();
    await wait(100);
    const run = screen.getByTestId("b-busy-run", { includeHiddenElements: true });
    expect(flat(run)).toMatchObject({ width: "34%", height: 2, opacity: 0.6 });
    // Not a civilization colour: the button's own text colour (canvas on the ink ground).
    const text = flat(screen.getByText("提交"));
    expect(flat(run).backgroundColor).toBe(text.color);
  });
});

describe("第五十九批: one highlight strength, ink at 10%", () => {
  // Mutation: LandingWash back on `${t.ink}0F` with opacity = fade → red.
  it("the landing wash is the ink at HIGHLIGHT_ALPHA", async () => {
    reduce(false);
    expect(HIGHLIGHT_ALPHA).toBe(0.1);
    renderSoul(
      <LandingWash on>
        <Text>row</Text>
      </LandingWash>
    );
    await act(async () => {});
    const wash = flat(screen.getByTestId("landing-wash"));
    expect(wash.opacity).toBeCloseTo(0.1);
    expect(String(wash.backgroundColor)).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
