/**
 * The app follows the system's light / dark setting (app.json
 * `userInterfaceStyle: "automatic"`; `useColorScheme` in the navigator),
 * on every screen including the neutral sign-in.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform } from "../platform";
import { SessionProvider } from "../session";
import { civ } from "../theme";

const appJson = require("../../app.json") as { expo: { userInterfaceStyle?: string } };

let mockScheme: "light" | "dark" | null = "dark";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

function renderApp() {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

/** The nearest filled surface around the soul-code field: its input box (s1). */
function loginGround(): string | undefined {
  let node = screen.getByTestId("login-soul-code").parent;
  while (node) {
    const bg = (StyleSheet.flatten(node.props.style) as { backgroundColor?: string } | undefined)?.backgroundColor;
    if (bg) return bg;
    node = node.parent;
  }
  return undefined;
}

beforeEach(async () => {
  installMobilePlatform();
  secure.clear();
  await AsyncStorage.clear();
});

it("app.json asks the OS to follow the system setting", () => {
  expect(appJson.expo.userInterfaceStyle).toBe("automatic");
});

it.each([
  ["dark", civ.neutral.dark.s1],
  ["light", civ.neutral.light.s1],
] as const)("system %s → the neutral %s input surface", async (scheme, ground) => {
  mockScheme = scheme;
  renderApp();
  await screen.findByTestId("login-submit");
  expect(loginGround()).toBe(ground);
});

it("no system preference reported → dark (the design's primary scheme)", async () => {
  mockScheme = null;
  renderApp();
  await screen.findByTestId("login-submit");
  expect(loginGround()).toBe(civ.neutral.dark.s1);
});
