/**
 * The app follows the system's light / dark setting (app.json
 * `userInterfaceStyle: "automatic"`; `useColorScheme` in the navigator),
 * on every screen including the sign-in.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { StyleSheet } from "react-native";

import { RootNavigator } from "../navigation";
import { installMobilePlatform } from "../platform";
import { SessionProvider } from "../session";
import { NEUTRAL_CIV, v4 } from "../theme";
import { renderSoul } from "./harness";
import { resetLoginMemory } from "./stubApi";

const appJson = require("../../app.json") as { expo: { userInterfaceStyle?: string } };

let mockScheme: "light" | "dark" | null = "dark";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

function renderApp() {
  return renderSoul(
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
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
  resetLoginMemory();
  secure.clear();
  await AsyncStorage.clear();
});

it("app.json asks the OS to follow the system setting", () => {
  expect(appJson.expo.userInterfaceStyle).toBe("automatic");
});

// v2: the primary button is one of the plaque's five places; before sign-in that is
// the neutral plaque (补足 C 组 login: 中性皮), no longer the canvas's ink fill.
// v3 (2026-10-02): no parchment before sign-in — the login is on v3's neutrals.
// 第三十批 墨色实底 (dossier step 1): the primary button is ink everywhere, the login included —
// the scheme's own ink, no longer the neutral plaque.
it.each(["dark", "light"] as const)("system %s → v4's neutrals of that scheme, primary button in that scheme's ink", async (scheme) => {
  mockScheme = scheme;
  renderApp();
  await screen.findByTestId("login-submit");
  expect(loginGround()).toBe(v4[scheme].card);
  // 「登录」 is pressable once there is a full number and a password: only then is it the ink button.
  fireEvent.changeText(screen.getByTestId("login-soul-code"), "QU33Q9FW5F");
  fireEvent.changeText(screen.getByTestId("login-password"), "x");
  const submit = StyleSheet.flatten(screen.getByTestId("login-submit").props.style) as { backgroundColor?: string };
  expect(submit.backgroundColor).toBe(v4[scheme].ink);
  expect(submit.backgroundColor).not.toBe(scheme === "dark" ? NEUTRAL_CIV.sD : NEUTRAL_CIV.sL);
  expect(loginGround()).not.toBe(v4[scheme === "dark" ? "light" : "dark"].card);
});

it("no system preference reported → dark (the design's primary scheme)", async () => {
  mockScheme = null;
  renderApp();
  await screen.findByTestId("login-submit");
  expect(loginGround()).toBe(v4.dark.card);
});
