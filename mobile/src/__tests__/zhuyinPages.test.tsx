/**
 * v2「朱印」第三阶段 · App 第一批:本世页样板,以及铺开到其余屏幕的共用部件 ——
 * 底部抽屉的下拉阈值、可折叠节、状态徽章、间距刻度。
 */
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { NavigationContainer } from "@react-navigation/native";
import { act, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Sheet, SHEET_CLOSE_DRAG_PT, SHEET_CLOSE_SPEED_PT_PER_MS, sheetReleaseCloses, useSheetGestures } from "../feedback";
import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { themeFor } from "../theme";
import { ThemeContext } from "../ui";


function wrap(children: ReactNode, civilization: string | null = "CHINESE") {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ThemeContext.Provider value={themeFor(civilization, "light")}>
          <NavigationContainer>{children}</NavigationContainer>
        </ThemeContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  installMobilePlatform();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

describe("the bottom sheet's release (交互与动效 第 2 轮 原型 06)", () => {
  it("closes past 90pt down, or faster than 0.6pt/ms; otherwise springs back", () => {
    expect([SHEET_CLOSE_DRAG_PT, SHEET_CLOSE_SPEED_PT_PER_MS]).toEqual([90, 0.6]);
    // Distance alone (velocity is Gesture Handler's pt per second).
    expect(sheetReleaseCloses(91, 0)).toBe(true);
    expect(sheetReleaseCloses(90, 0)).toBe(false);
    expect(sheetReleaseCloses(40, 0)).toBe(false);
    // Speed alone: 0.61pt/ms = 610pt/s.
    expect(sheetReleaseCloses(10, 610)).toBe(true);
    expect(sheetReleaseCloses(10, 600)).toBe(false);
    // A fling upward never closes, however hard.
    expect(sheetReleaseCloses(-30, -2000)).toBe(false);
  });

  it("the sheet hands the library that release, not its snap-point projection", async () => {
    wrap(
      <Sheet open onClose={jest.fn()} edge="#000" closeLabel="关闭">
        <Text>内容</Text>
      </Sheet>
    );
    await act(async () => {});
    expect(screen.UNSAFE_getByType(BottomSheetModal).props.gestureEventsHandlersHook).toBe(useSheetGestures);
    expect(screen.getByText("内容")).toBeTruthy();
  });
});
