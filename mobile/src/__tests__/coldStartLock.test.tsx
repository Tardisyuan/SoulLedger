/**
 * A cold start with the stored session restored and 切回 App 时也要验证 on (iOS Simulator, 2026-11-27): the face prompt
 * waits until the cold start is off the screen, so the system sheet opens over 「已锁定」 and not over the blank native
 * splash -- asked at once, iOS took the app to `inactive` in the middle of the cold start and the splash was still up a
 * minute after the face was recognised. The real navigator, session and cold start; the system's face is the double in
 * jest.setup.js, and AppState is driven by hand in the order iOS sends it around the face sheet.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { AccessibilityInfo, AppState, Platform } from "react-native";

import { coldStart } from "../coldStart";
import { APP_LOCK_KEY, BIO_KEY } from "../deviceLogin";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, persistentStore } from "@soulledger/mobile-ui/src/platform";
import { SessionProvider } from "../session";
import { renderSoul } from "./harness";
import { PROFILE, life, resetLoginMemory, stubApi } from "./stubApi";

// Every other suite gets jest.setup's inert double; this one needs the real cold start over the real app.
jest.unmock("../coldStart");

const H = { includeHiddenElements: true };
const hide = SplashScreen.hideAsync as jest.Mock;
const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const bio = LocalAuthentication as unknown as { __state: { recognised: boolean; gate: Promise<void> | null; prompts: string[] } };
type Listener = (state: string) => void;
let listeners: Set<Listener>;
const appState = (state: string) => act(async () => void listeners.forEach((l) => l(state)));
const realOS = Platform.OS;

beforeEach(async () => {
  installMobilePlatform();
  resetLoginMemory();
  secure.clear();
  await AsyncStorage.clear();
  coldStart.played = false;
  hide.mockClear();
  bio.__state.recognised = true;
  bio.__state.prompts.length = 0;
  bio.__state.gate = null;
  listeners = new Set();
  Platform.OS = "ios";
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => false);
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: Listener) => {
    listeners.add(handler);
    return { remove: () => void listeners.delete(handler) };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  Platform.OS = realOS;
  jest.restoreAllMocks();
});

it("asks for the face only once the cold start is off the screen; recognised, the home page is there", async () => {
  persistentStore.set(BIO_KEY, "face");
  persistentStore.set(APP_LOCK_KEY, "1");
  secure.set(REFRESH_TOKEN_KEY, "R");
  stubApi({
    "/me/": { status: 200, data: PROFILE },
    "/me/life/": { status: 200, data: life(1) },
    "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
  });
  let recognise!: () => void;
  bio.__state.gate = new Promise<void>((resolve) => (recognise = resolve));
  renderSoul(
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
  await screen.findByTestId("app-lock");
  await screen.findByTestId("cold-start", H);
  // The cold start is up and the native splash not yet hidden: no system sheet over it.
  await act(async () => new Promise((r) => setTimeout(r, 50)));
  expect(hide).not.toHaveBeenCalled();
  expect(bio.__state.prompts).toEqual([]);
  fireEvent(screen.getByTestId("cold-start-skip", H), "layout", { nativeEvent: { layout: { width: 390, height: 844 } } });
  expect(hide).toHaveBeenCalledTimes(1);
  expect(bio.__state.prompts).toEqual([]);
  // A tap ends it (as its own clock would): now 「已锁定」 is what is on screen, and the system asks.
  fireEvent.press(screen.getByTestId("cold-start-skip", H));
  await waitFor(() => expect(bio.__state.prompts).toEqual(["用来解锁灵魂簿。"]));
  expect(screen.queryByTestId("cold-start", H)).toBeNull();
  expect(screen.getByTestId("app-lock")).toBeTruthy();
  // iOS around the face sheet: active -> inactive, recognised, -> active. Not a return; nothing asks again.
  await appState("inactive");
  await act(async () => recognise());
  await appState("active");
  await waitFor(() => expect(screen.queryByTestId("app-lock")).toBeNull());
  expect(screen.queryByTestId("app-lock-cover")).toBeNull();
  expect(screen.getByTestId("profile-card")).toBeTruthy();
  expect(bio.__state.prompts).toHaveLength(1);
});
