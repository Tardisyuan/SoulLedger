/**
 * The small-screen and large-text layouts (handoff 2c / 2d), rendered with a
 * controlled window: the thresholds themselves are in rules.test.ts.
 */
import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { ApplicationDetailScreen } from "../screens/applications";
import { SignInsScreen } from "../screens/signIns";
import { themeFor } from "../theme";
import { DataRow, Input, OneLine, ThemeContext } from "../ui";
import { application, stubApi } from "./stubApi";

const mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

function wrap(children: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: mockWindow.width, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ThemeContext.Provider value={themeFor("CHINESE", "dark")}>
          <NavigationContainer>{children}</NavigationContainer>
        </ThemeContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  installMobilePlatform();
  Object.assign(mockWindow, { width: 393, fontScale: 1 });
});

describe("320pt", () => {
  it("every data row stacks, even with a short label; at 393pt the same row stays side by side", () => {
    Object.assign(mockWindow, { width: 320 });
    const { unmount } = wrap(<DataRow testID="row" label="籍贯">江苏 · 扬州</DataRow>);
    expect(flat(screen.getByTestId("row")).flexDirection).toBe("column");
    unmount();
    Object.assign(mockWindow, { width: 393 });
    wrap(<DataRow testID="row" label="籍贯">江苏 · 扬州</DataRow>);
    expect(flat(screen.getByTestId("row")).flexDirection).toBe("row");
  });
});

describe("200% text", () => {
  it("the password reveal leaves the field for a full-width row of its own", () => {
    Object.assign(mockWindow, { fontScale: 2 });
    wrap(<Input testID="pw" label="密码" value="" secureTextEntry secureToggle={{ show: "显示", hide: "隐藏" }} />);
    expect(flat(screen.getByTestId("pw-reveal"))).toMatchObject({ minHeight: 60, borderWidth: 1 });
  });

  it("labelHidden keeps the label for screen readers and draws no label row", () => {
    wrap(<Input testID="ask" label="问一问" labelHidden value="" />);
    expect(screen.getByTestId("ask").props.accessibilityLabel).toBe("问一问");
    expect(screen.queryByText("问一问")).toBeNull();
  });

  it("at normal size the reveal sits inside the field's right edge", () => {
    wrap(<Input testID="pw" label="密码" value="" secureTextEntry secureToggle={{ show: "显示", hide: "隐藏" }} />);
    expect(flat(screen.getByTestId("pw-reveal"))).toMatchObject({ width: 52, borderLeftWidth: 1 });
  });

  it("the flow drops its rail — no dashed line — and the step boxes grow to 16", async () => {
    stubApi({ "/me/rebirth-applications/a1/": { status: 200, data: application() } });
    Object.assign(mockWindow, { fontScale: 2 });
    const { unmount } = wrap(<ApplicationDetailScreen id="a1" />);
    const dot = await screen.findByTestId("step-current-now");
    expect(flat(dot)).toMatchObject({ width: 16, height: 16 });
    expect(screen.queryByTestId("step-current-dashed")).toBeNull();
    unmount();

    Object.assign(mockWindow, { fontScale: 1 });
    wrap(<ApplicationDetailScreen id="a1" />);
    expect(flat(await screen.findByTestId("step-current-now"))).toMatchObject({ width: 11 });
    expect(screen.getByTestId("step-current-dashed")).toBeTruthy();
  });
});

/**
 * 第二十八批 S4 at the largest system sizes: identifiers / times / amounts keep to one line (cut with …,
 * long-press for the whole value); "text left, time right" rows become two lines above 1.5×.
 */
describe("S4 · one line, and two lines above 1.5×", () => {
  afterEach(() => jest.restoreAllMocks());

  it("OneLine is one line, cut at the tail, and a long press shows all of it", () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    wrap(<OneLine testID="v">2026-10-12 08:02 · SL-0000-0000-0000</OneLine>);
    const v = screen.getByTestId("v");
    expect(v.props.numberOfLines).toBe(1);
    expect(v.props.ellipsizeMode).toBe("tail");
    expect(alert).not.toHaveBeenCalled();
    fireEvent(v, "longPress");
    expect(alert).toHaveBeenCalledWith("2026-10-12 08:02 · SL-0000-0000-0000");
  });

  it("a pressable row's own press still reaches the row through the one-line value", () => {
    const onPress = jest.fn();
    wrap(<OneLine testID="v" onPress={onPress}>2026-10-12 08:02</OneLine>);
    fireEvent.press(screen.getByTestId("v"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("a mono data value keeps to one line; a plain one may wrap", () => {
    wrap(
      <>
        <DataRow label="提交于" mono>2026-10-12 08:02</DataRow>
        <DataRow label="籍贯">江苏 · 扬州</DataRow>
      </>
    );
    expect(screen.getByText("2026-10-12 08:02").props.numberOfLines).toBe(1);
    expect(screen.getByText("江苏 · 扬州").props.numberOfLines).toBeUndefined();
  });

  it("a sign-in record puts its time under the line at 1.5×, beside it at 1×; the time is one line either way", async () => {
    const at = new Date(2026, 9, 12, 8, 2).toISOString();
    const routes = {
      "GET /me/sessions/": { status: 200, data: [] },
      "GET /me/sign-ins/": { status: 200, data: [{ at, ok: true, method: "password", device: "Android 手机", count: 1, reason: "" }] },
    };
    stubApi(routes);
    Object.assign(mockWindow, { fontScale: 1.5 });
    const { unmount } = wrap(<SignInsScreen />);
    const row = await screen.findByTestId("sign-in-record");
    expect(flat(row).flexDirection).toBe("column");
    expect(within(row).getByTestId("sign-in-record-stamp").props.numberOfLines).toBe(1);
    expect(within(row).getByText("2026-10-12 08:02")).toBeTruthy();
    unmount();

    stubApi(routes);
    Object.assign(mockWindow, { fontScale: 1 });
    wrap(<SignInsScreen />);
    const side = await screen.findByTestId("sign-in-record");
    expect(flat(side).flexDirection).toBe("row");
    expect(within(side).getByTestId("sign-in-record-stamp").props.numberOfLines).toBe(1);
  });
});
