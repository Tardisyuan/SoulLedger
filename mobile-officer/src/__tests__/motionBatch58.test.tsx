/**
 * Design 第五十八 / 五十九批, the officer app's half (the soul app's: mobile/src/__tests__/motionBatch58.test.tsx):
 * a tab cross-fades in and a screen over the tabs slides in (M1), the busy action button (M10), 「加载更多」 as two
 * skeleton rows (M9), a reload in place runs the top line (M8), and the pushed row's one highlight strength (第五十九批).
 * The edge swipe's follow-off and snap-back are in appFeel.test.tsx, the card snap-back in swipe.test.tsx, the
 * banner's fold in offline.test.tsx.
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import { useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text } from "react-native";

import { ActionButton, Highlight, PageEnter } from "../kit";
import { MoreRow } from "../paged";
import { useOnBump } from "../readCache";
import { EASE, HIGHLIGHT_ALPHA, Topline } from "../shared";
import { renderOfficer } from "./harness";

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const reduce = (on: boolean) => jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(on);
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

afterEach(() => jest.restoreAllMocks());

describe("M1: a tab fades in; a screen over the tabs slides in from the right", () => {
  // Mutation seen red: `moves ? 1 : p` → `1` (the tab's fade gone); the translateX dropped (the slide gone).
  it.each([
    [false, "page-fade"],
    [true, "page-slide"],
  ])("slide %s", async (slide, id) => {
    reduce(false);
    const timing = jest.spyOn(Animated, "timing");
    renderOfficer(
      <PageEnter slide={slide}>
        <Text>page</Text>
      </PageEnter>
    );
    // At its first frame a tab's page is clear (it fades in); a slid-in screen is opaque (it moves in).
    expect(flat(screen.getByTestId(id)).opacity).toBe(slide ? 1 : 0);
    await act(async () => {});
    const style = flat(screen.getByTestId(id));
    expect(timing.mock.calls.at(-1)![1]).toMatchObject({ toValue: 1, duration: 240, easing: EASE.enter });
    if (slide) expect(JSON.stringify(style.transform)).toContain("translateX");
    else expect(style.transform).toEqual([]);
  });

  it("reduce motion: an 80 fade, nothing moves", async () => {
    reduce(true);
    const timing = jest.spyOn(Animated, "timing");
    renderOfficer(
      <PageEnter slide>
        <Text>page</Text>
      </PageEnter>
    );
    await act(async () => {});
    expect(flat(screen.getByTestId("page-slide")).transform).toEqual([]);
    expect(timing.mock.calls.at(-1)![1]).toMatchObject({ toValue: 1, duration: 80 });
  });
});

describe("M10: a busy action button keeps its look; past 160 a line in its own ink runs along its foot", () => {
  // Mutation seen red: `opacity: pressed || busy ? 0.7 : 1` back → the opacity assertion.
  it("not dimmed, not pressable, the line after 160 in the text colour", async () => {
    reduce(false);
    const onPress = jest.fn();
    renderOfficer(<ActionButton testID="a" kind="primary" title="批准" busy onPress={onPress} />);
    await act(async () => {});
    expect(flat(screen.getByTestId("a")).opacity).toBe(1);
    fireEvent.press(screen.getByTestId("a"));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.queryByTestId("a-busy", { includeHiddenElements: true })).toBeNull();
    await wait(200);
    const run = flat(screen.getByTestId("a-busy-run", { includeHiddenElements: true }));
    expect(run).toMatchObject({ height: 2, opacity: 0.6 });
    expect(run.backgroundColor).toBe(flat(screen.getByText("批准")).color);
  });
});

describe("M9: 「加载更多」 on its way is two skeleton rows, not the breathing mark", () => {
  // Mutation seen red: the Loader back in MoreRow → no `list-more-busy-bars`.
  it("after the skeleton's 400 wait", async () => {
    renderOfficer(<MoreRow more={jest.fn()} state="busy" />);
    expect(screen.queryByTestId("list-more-busy")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    await wait(450);
    expect(screen.getByTestId("list-more-busy-bars").children).toHaveLength(2);
  });
});

describe("M8: a reload in place runs the top line", () => {
  // Mutation seen red: `runTopline()` dropped from useOnBump.
  it("a bump of the shell's version", async () => {
    reduce(false);
    const run = jest.fn();
    function Tab() {
      const [bump, setBump] = useState(0);
      useOnBump(bump, run);
      return (
        <>
          <Topline />
          <Pressable testID="bump" onPress={() => setBump((n) => n + 1)} />
        </>
      );
    }
    renderOfficer(<Tab />);
    await act(async () => {});
    expect(screen.queryByTestId("topline-run")).toBeNull();
    fireEvent.press(screen.getByTestId("bump"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("topline-run")).toBeTruthy();
    await wait(1400);
  });
});

describe("第五十九批: the pushed row's wash is ink at 10%", () => {
  // Mutation seen red: HIGHLIGHT_ALPHA back to rules.ts's 0.07.
  it("at its peak", async () => {
    reduce(false);
    renderOfficer(<Highlight />);
    await act(async () => {});
    expect(HIGHLIGHT_ALPHA).toBe(0.1);
    expect(flat(screen.getByTestId("row-highlight")).opacity).toBeCloseTo(0.1);
  });
});
