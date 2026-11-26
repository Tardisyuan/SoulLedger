/**
 * PhotoPager's zoom and close (ux-motion-mobile B1), shared by the chat's, the circle's and the officer's letters'
 * viewers. jest drives the gestures through gesture-handler's own test utils; how they feel (the pinch about the
 * fingers, the pan's bounds, a drag down beside the pages' own scroll) is for a device.
 * Mutations seen red: `scrollEnabled={!zoomed}` dropped → the paging cases; the down-drag's `onClose` dropped → the close
 * case; the double tap's `reset()` dropped → "a second double tap".
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import { State, type PanGesture, type PinchGesture, type TapGesture } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { Text } from "react-native";

import { CLOSE_DRAG_PT, PhotoPager } from "@soulledger/mobile-ui/src/ui";
import { renderSoul } from "./harness";

// Reanimated's mock makes a new shared value on every render, so a zoom forgot its scale as soon as the page re-rendered
// (a double tap could never go back): a double that behaves like a bug. Here one value lives as long as the component.
jest.mock("react-native-reanimated", () => {
  const mock = jest.requireActual("react-native-reanimated/mock");
  const { useState } = jest.requireActual("react");
  return { ...mock, useSharedValue: (init: unknown) => useState(() => mock.useSharedValue(init))[0] };
});

// The detector swaps in a gesture rebuilt for a new state (zoomed or not) on the next setImmediate.
const applied = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));
const paging = () => screen.getByTestId("pages").props.scrollEnabled;

function pager(tapLabel?: string) {
  const onClose = jest.fn();
  renderSoul(
    <PhotoPager testID="pages" items={["a"]} start={0} keyOf={(s) => s} onIndex={() => {}} onClose={onClose} tapLabel={tapLabel} renderPage={(s) => <Text>{s}</Text>} />
  );
  return onClose;
}

const pinch = (scale: number) =>
  act(() =>
    fireGestureHandler<PinchGesture>(getByGestureTestId("photo-pinch"), [
      { state: State.BEGAN, scale: 1, focalX: 100, focalY: 100 },
      { state: State.ACTIVE, scale: 1, focalX: 100, focalY: 100 },
      { scale, focalX: 100, focalY: 100 },
      { state: State.END, scale, focalX: 100, focalY: 100 },
    ])
  );
const drag = (dy: number) =>
  act(() =>
    fireGestureHandler<PanGesture>(getByGestureTestId("photo-pan"), [
      { state: State.BEGAN, translationX: 0, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: 0, velocityY: 0 },
      { translationX: 0, translationY: dy, velocityY: 0 },
      { state: State.END, translationX: 0, translationY: dy, velocityY: 0 },
    ])
  );
const doubleTap = () =>
  act(() => fireGestureHandler<TapGesture>(getByGestureTestId("photo-double-tap"), [{ state: State.BEGAN, x: 50, y: 50 }, { state: State.ACTIVE, x: 50, y: 50 }, { state: State.END, x: 50, y: 50 }]));

it("pages turn unzoomed; a pinch zooms and they stop turning; pinched back to 1 they turn again", async () => {
  pager();
  expect(paging()).toBe(true);
  await pinch(2);
  expect(paging()).toBe(false);
  await applied();
  await pinch(0.4); // from 2: under 1, so back to 1
  expect(paging()).toBe(true);
});

it("a double tap zooms (no paging); a second double tap goes back (paging)", async () => {
  pager();
  await doubleTap();
  expect(paging()).toBe(false);
  await applied();
  await doubleTap();
  expect(paging()).toBe(true);
});

it("unzoomed, a drag down past the line closes; short of it, it does not", async () => {
  const onClose = pager();
  await drag(CLOSE_DRAG_PT - 20);
  expect(onClose).not.toHaveBeenCalled();
  await drag(CLOSE_DRAG_PT + 20);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("zoomed, the same drag moves the photo and does not close", async () => {
  const onClose = pager();
  await pinch(2);
  await applied();
  await drag(CLOSE_DRAG_PT + 20);
  expect(onClose).not.toHaveBeenCalled();
});

it("with `tapLabel` a single tap closes, and a screen reader's activate does too; without it, neither", async () => {
  const onClose = pager("关闭");
  await act(() => fireGestureHandler<TapGesture>(getByGestureTestId("photo-tap"), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]));
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent(screen.getByLabelText("关闭"), "accessibilityAction", { nativeEvent: { actionName: "activate" } });
  expect(onClose).toHaveBeenCalledTimes(2);
  screen.unmount();
  pager();
  expect(screen.queryByLabelText("关闭")).toBeNull();
});

it("a tap gives up once the finger travels: a swipe (a page turn, a drag while zoomed) is not a tap that closes", () => {
  pager("关闭");
  for (const id of ["photo-tap", "photo-double-tap"]) {
    const config = (getByGestureTestId(id) as unknown as { config: { maxDist?: number } }).config;
    expect([id, config.maxDist]).toEqual([id, 10]);
  }
});
