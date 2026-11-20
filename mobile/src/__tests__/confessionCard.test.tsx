/**
 * 第六十二批 · 四十二条否定告白:页面开着时新记下一条,只有那一格动 —— 它的填充 160 淡入(进曲线);
 * 打开页面时什么都不动;减少动态效果时直接换状态。
 */
import { act, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";

import { ConfessionCard } from "../screens/lifeProgress";
import { motion } from "../theme";
import { inSoulFrame, renderSoul } from "./harness";

const tally = (marks: string) => ({
  truthful: [...marks].filter((m) => m === "T").length,
  untruthful: [...marks].filter((m) => m === "U").length,
  unheard: [...marks].filter((m) => m === "-").length,
  total: marks.length,
  items: [...marks].map((m, i) => ({ n: i + 1, state: (m === "T" ? "TRUTHFUL" : m === "U" ? "UNTRUTHFUL" : "UNHEARD") as "TRUTHFUL" })),
});

const BEFORE = "TTTTTT-" + "-".repeat(35);
const AFTER = "TTTTTTU" + "-".repeat(35);

describe("a denial recorded while the page is open", () => {
  let reduced = false;
  beforeEach(() => {
    reduced = false;
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => reduced);
  });
  afterEach(() => jest.restoreAllMocks());

  const open = async (marks: string) => {
    const view = renderSoul(<ConfessionCard tally={tally(marks)} />);
    await act(async () => {});
    return view;
  };

  it("opening the page animates nothing: every recorded cell is already filled", async () => {
    const timing = jest.spyOn(Animated, "timing");
    await open(AFTER);
    expect(timing).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(screen.getByTestId("confession-fill-1").props.style).opacity).toBe(1);
  });

  it("only the new cell fills, over 160 on the enter curve; no other cell moves", async () => {
    const view = await open(BEFORE);
    const timing = jest.spyOn(Animated, "timing");
    view.rerender(inSoulFrame(<ConfessionCard tally={tally(AFTER)} />));
    await act(async () => {});
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0][1]).toMatchObject({ toValue: 1, duration: motion.fade, useNativeDriver: true });
    expect(motion.fade).toBe(160);
    // The stripe appears with the fill: it is inside the fading layer of § 7.
    expect(screen.getByTestId("confession-fill-7")).toBeTruthy();
    expect(screen.queryByTestId("confession-fill-8")).toBeNull();
  });

  it("reduce motion: the state just changes", async () => {
    reduced = true;
    const view = await open(BEFORE);
    const timing = jest.spyOn(Animated, "timing");
    view.rerender(inSoulFrame(<ConfessionCard tally={tally(AFTER)} />));
    await act(async () => {});
    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByTestId("confession-fill-7")).toBeTruthy();
  });
});
