/**
 * App 手感(2026-11-15,主会话确认第 2 条)里官员端自己的两件:底栏随字号长高(最少 56),iOS 从左缘右滑返回。
 * 按下态的规则与扫描在 mobile/src/__tests__/pressedState.test.tsx(两个 App 共用 `Press`)。
 *
 * 变异(本轮验过):kit.tsx `tab` 的 `minHeight: 56` 改回 `height: 56` →「随字号长高」红;
 * `EdgeBack` 的 `width / 3` 改成 `width` →「过三分之一」红。
 */
import { act, render, screen, within } from "@testing-library/react-native";
import { State, type PanGesture } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { Platform, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { EdgeBack, TAB_FONT_SCALE, TabBar } from "../kit";
import { renderOfficer } from "./harness";

const flat = (node: { props: { style?: unknown } }): ViewStyle => StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {};

describe("the bottom bar at large text", () => {
  it("each door grows from 56 instead of being held at it, and its glyph and name stop at TAB_FONT_SCALE", () => {
    renderOfficer(<TabBar current="queue" onSelect={() => {}} />);
    const cell = flat(screen.getByTestId("door-desk"));
    expect(cell.minHeight).toBe(56);
    expect(cell.height).toBeUndefined();
    expect(TAB_FONT_SCALE).toBeLessThanOrEqual(1.3);
    const texts = within(screen.getByTestId("door-desk")).UNSAFE_getAllByType(Text);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text.props.maxFontSizeMultiplier).toBe(TAB_FONT_SCALE);
  });
});

describe("the iOS back swipe from the left edge", () => {
  const realOS = Platform.OS;
  const setOS = (os: string) => Object.defineProperty(Platform, "OS", { value: os, configurable: true });
  afterEach(() => setOS(realOS));

  const swipe = (dx: number, velocityX = 0) =>
    act(() =>
      fireGestureHandler<PanGesture>(getByGestureTestId("edge-back"), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: 0 },
        { translationX: dx, velocityX },
        { state: State.END, translationX: dx, velocityX },
      ])
    );

  it("past a third of the width it goes back; short of it, it does not", () => {
    setOS("ios");
    const onBack = jest.fn();
    render(
      <EdgeBack onBack={onBack}>
        <Text>page</Text>
      </EdgeBack>
    );
    swipe(100); // 750-wide test window: a third is 250
    expect(onBack).not.toHaveBeenCalled();
    swipe(300);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a fling goes back however short it was", () => {
    setOS("ios");
    const onBack = jest.fn();
    render(
      <EdgeBack onBack={onBack}>
        <Text>page</Text>
      </EdgeBack>
    );
    swipe(60, 900);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("Android keeps its own back gesture: no pan is attached", () => {
    setOS("android");
    render(
      <EdgeBack onBack={() => {}}>
        <Text>page</Text>
      </EdgeBack>
    );
    // Nothing wrapped round the page: no detector, no view that would follow a finger.
    expect((screen.toJSON() as { type: string }).type).toBe("Text");
  });
});
