/**
 * Design 第六十批 in the apps (the officer app shares both through mobile-officer/src/shared.ts):
 *   P4 — under reduce motion a bottom sheet does not slide: it fades in place over 80, and its scrim fades on the same
 *        value, so the two start and end together.
 *   P6 — closing a photo viewer shrinks the layer back onto the thumbnail of the photo in front over 160 on the exit
 *        curve; a thumbnail off screen or gone fades in place over 160; under reduce motion an 80 fade.
 * Mutations seen red: `photoShrinkTo`'s off-screen test dropped (always shrink) → the fallback cases; FadeModal's
 * `motion.photoClose` → `motion.dialogIn` → the 160 cases; the sheet's reduced fade `motion.reduced` → `motion.sheetIn`.
 */
import { act, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import * as Reanimated from "react-native-reanimated";

import { Sheet } from "../feedback";
import { motion } from "../theme";
import { EASE, FadeModal, containRect, photoShrinkTo, thumbRef } from "../ui";
import { inSoulFrame, renderSoul } from "./harness";

const reduce = (on: boolean) => jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(on);
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

afterEach(() => jest.restoreAllMocks());

describe("P6: photoShrinkTo", () => {
  const win = { width: 400, height: 800 };
  it("lays the full window onto a thumbnail on screen", () => {
    expect(photoShrinkTo({ x: 20, y: 100, width: 100, height: 100 }, win)).toEqual({ dx: 70 - 200, dy: 150 - 400, scale: 0.25 });
  });
  it.each([
    ["scrolled above the screen", { x: 20, y: -200, width: 100, height: 100 }],
    ["scrolled below", { x: 20, y: 800, width: 100, height: 100 }],
    ["gone (no size)", { x: 0, y: 0, width: 0, height: 0 }],
  ])("%s: null, fade in place", (_n, rect) => {
    expect(photoShrinkTo(rect, win)).toBeNull();
  });
  // iPhone 17, 2026-11-21: the whole window was laid on the tile, so a 4:3 photo under the 48 pt bar landed low and spilled
  // past a square tile. From the photo's own rect it lands centred on the tile and inside it.
  it("from the photo's own rect: lands centred on the tile, fitted inside it", () => {
    const thumb = { x: 20, y: 300, width: 100, height: 100 };
    const photo = containRect({ x: 0, y: 100, width: 400, height: 652 }, { width: 1200, height: 900 });
    expect(photo).toEqual({ x: 0, y: 276, width: 400, height: 300 });
    const s = photoShrinkTo(thumb, win, photo)!;
    const land = (px: number, py: number) => ({ x: 200 + s.scale * (px - 200) + s.dx, y: 400 + s.scale * (py - 400) + s.dy });
    const tl = land(photo.x, photo.y);
    const br = land(photo.x + photo.width, photo.y + photo.height);
    expect([(tl.x + br.x) / 2, (tl.y + br.y) / 2]).toEqual([70, 350]);
    expect(br.x - tl.x).toBeCloseTo(100);
    expect(br.y - tl.y).toBeLessThanOrEqual(100);
    expect(tl.y).toBeGreaterThanOrEqual(300);
  });
  it("is 160 on the exit curve (motion.photo-close)", () => {
    expect(motion.photoClose).toBe(160);
  });
});

describe("P6: closing a photo viewer", () => {
  function Thumb({ at }: { at?: { x: number; y: number; width: number; height: number } }) {
    return (
      <View
        testID="thumb"
        ref={(node) => {
          if (node && at) jest.spyOn(node, "measureInWindow").mockImplementation((cb) => cb(at.x, at.y, at.width, at.height));
          return thumbRef("t:1")(node);
        }}
      />
    );
  }
  const ui = (visible: boolean, thumb: React.ReactNode) => (
    <>
      {thumb}
      <FadeModal visible={visible} onRequestClose={jest.fn()} closeTo={() => "t:1"}>
        {visible ? <Text testID="photo">x</Text> : null}
      </FadeModal>
    </>
  );
  const close = async (reduced: boolean, thumb: React.ReactNode) => {
    reduce(reduced);
    const view = renderSoul(ui(true, thumb));
    await act(async () => {});
    const timing = jest.spyOn(Animated, "timing");
    view.rerender(inSoulFrame(ui(false, thumb)));
    await act(async () => {});
    // Right after the close: what the leaving layer looks like, and that it still shows the photo.
    const layer = screen.queryByTestId("fade-modal");
    const leaving = layer ? { transform: flat(layer).transform, photo: !!screen.queryByTestId("photo") } : null;
    await wait(motion.photoClose + 50);
    return { calls: timing.mock.calls.map((c) => c[1]), leaving };
  };

  it("thumbnail on screen: shrinks onto it over 160, exit curve, and the photo stays drawn while it does", async () => {
    const { calls, leaving } = await close(false, <Thumb at={{ x: 0, y: 0, width: 100, height: 100 }} />);
    expect(calls).toEqual([
      expect.objectContaining({ toValue: 0, duration: 160, easing: EASE.exit }),
      expect.objectContaining({ toValue: 1, duration: 160, easing: EASE.exit }),
    ]);
    expect(JSON.stringify(leaving?.transform)).toContain("scale");
    expect(leaving?.photo).toBe(true);
  });

  it("thumbnail off screen: fades in place over 160, no shrink", async () => {
    const { calls, leaving } = await close(false, <Thumb at={{ x: 0, y: -500, width: 100, height: 100 }} />);
    expect(calls).toEqual([expect.objectContaining({ toValue: 0, duration: 160, easing: EASE.exit })]);
    expect(leaving?.transform).toBeUndefined();
  });

  it("thumbnail gone: fades in place over 160", async () => {
    const { calls } = await close(false, null);
    expect(calls).toEqual([expect.objectContaining({ toValue: 0, duration: 160, easing: EASE.exit })]);
  });

  it("reduce motion: an 80 fade, even with the thumbnail on screen", async () => {
    const { calls } = await close(true, <Thumb at={{ x: 0, y: 0, width: 100, height: 100 }} />);
    expect(calls).toEqual([expect.objectContaining({ toValue: 0, duration: 80, easing: EASE.exit })]);
  });
});

describe("P4: a bottom sheet under reduce motion fades in place, its scrim with it", () => {
  const ui = (open: boolean) => (
    <Sheet open={open} onClose={jest.fn()} edge="#000" closeLabel="close">
      <Text testID="sheet-body">x</Text>
    </Sheet>
  );

  it("reduce motion: in and out over 80 on one value; the sheet and the scrim carry the same style", async () => {
    reduce(true);
    const view = renderSoul(ui(false));
    await act(async () => {});
    const timing = jest.spyOn(Reanimated, "withTiming");
    view.rerender(inSoulFrame(ui(true)));
    await act(async () => {});
    expect(timing.mock.calls.map((c) => [c[0], c[1]?.duration])).toEqual([[1, 80]]);
    const sheet = flat(screen.getByTestId("bottom-sheet"));
    const scrim = flat(screen.getByTestId("sheet-scrim"));
    expect(sheet.opacity).toBe(1);
    expect(scrim.opacity).toBe(sheet.opacity);
    view.rerender(inSoulFrame(ui(false)));
    expect(timing.mock.calls.map((c) => [c[0], c[1]?.duration])).toEqual([
      [1, 80],
      [0, 80],
    ]);
    // Still up through the 80 fade, then down.
    expect(screen.getByTestId("sheet-body")).toBeTruthy();
    await wait(motion.reduced + 20);
    expect(screen.queryByTestId("sheet-body")).toBeNull();
  });

  it("motion on: no fade of its own, the library's backdrop and slide (240 in)", async () => {
    reduce(false);
    const view = renderSoul(ui(false));
    await act(async () => {});
    const timing = jest.spyOn(Reanimated, "withTiming");
    view.rerender(inSoulFrame(ui(true)));
    await act(async () => {});
    expect(timing).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sheet-scrim")).toBeNull();
    expect(screen.queryByTestId("bottom-sheet")).toBeNull();
    expect(motion.sheetIn).toBe(240);
  });
});
