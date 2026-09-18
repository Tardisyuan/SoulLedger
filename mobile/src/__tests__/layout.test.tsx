/**
 * The small-screen and large-text layouts (handoff 2c / 2d), rendered with a
 * controlled window: the thresholds themselves are in rules.test.ts.
 */
import { NavigationContainer } from "@react-navigation/native";
import { render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { ApplicationDetailScreen } from "../screens/applications";
import { themeFor } from "../theme";
import { DataRow, Input, ThemeContext } from "../ui";
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
