/**
 * Offline (用户拍板 2026-09-30): the app keeps no copy, so a bar says 「已离线」 with a
 * retry, and goes when the network is back. Real providers and navigator; the network
 * state is jest.setup's expo-network double, which tells its listeners as the OS does.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, sessionStore } from "../platform";
import { SessionProvider } from "../session";
import { motion } from "../theme";
import { PROFILE, life, stubApi } from "./stubApi";

const net = Network as unknown as {
  __set: (s: Partial<Network.NetworkState>) => void;
  __reset: () => void;
  getNetworkStateAsync: jest.Mock;
};
const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const TOP = 47;
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

function renderApp() {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: TOP, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const drop = () => act(async () => net.__set({ isConnected: false, isInternetReachable: false }));
const restore = () => act(async () => net.__set({ isConnected: true, isInternetReachable: true }));

beforeEach(async () => {
  installMobilePlatform();
  secure.clear();
  sessionStore.remove("soulledger_access");
  await AsyncStorage.clear();
  net.__reset();
  net.getNetworkStateAsync.mockClear();
});

describe("the offline bar", () => {
  it("online: no bar", async () => {
    renderApp();
    await screen.findByTestId("login-submit");
    expect(screen.queryByTestId("offline-bar")).toBeNull();
  });

  it("the network drops: 已离线 and a retry at the top, the screen still there beneath; back: the bar goes by itself", async () => {
    renderApp();
    await screen.findByTestId("login-submit");
    await drop();
    expect(screen.getByTestId("offline-text").props.children).toBe("已离线");
    expect(screen.getByTestId("offline-retry")).toBeTruthy();
    // It pushes the screen down, never covers it or takes its place.
    expect(screen.getByTestId("login-submit")).toBeTruthy();
    // No promise of old content: the app has none to show.
    expect(screen.queryByText(/上次同步/)).toBeNull();
    await restore();
    expect(screen.queryByTestId("offline-bar")).toBeNull();
    expect(screen.getByTestId("login-submit")).toBeTruthy();
  });

  it.each([false, true])("v3: the bar opens from 0 to its height over 200ms (reduce motion %s: at once)", async (reduced) => {
    const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
    renderApp();
    await screen.findByTestId("login-submit");
    await drop();
    if (reduced) {
      expect(screen.queryByTestId("grow")).toBeNull();
      expect(screen.getByTestId("offline-bar")).toBeTruthy();
      spy.mockResolvedValue(false);
      return;
    }
    expect(flat(screen.getByTestId("grow"))).toMatchObject({ height: 0, overflow: "hidden" });
    fireEvent(screen.getByTestId("offline-inset").parent!, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: TOP + 40 } } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, motion.offlineBar + 150));
    });
    expect(screen.queryByTestId("grow")).toBeNull();
    expect(screen.getByTestId("offline-bar")).toBeTruthy();
    spy.mockResolvedValue(false);
  });

  it("offline at launch: the first answer the OS gives is enough", async () => {
    net.__set({ isConnected: false });
    renderApp();
    expect(await screen.findByTestId("offline-bar")).toBeTruthy();
  });

  it("a network the OS cannot vouch for yet (undefined) is not offline", async () => {
    net.__set({ isConnected: undefined, isInternetReachable: undefined });
    renderApp();
    await screen.findByTestId("login-submit");
    expect(screen.queryByTestId("offline-bar")).toBeNull();
  });

  it("retry asks the OS again: still offline keeps the bar; found the network drops it", async () => {
    renderApp();
    await screen.findByTestId("login-submit");
    await drop();
    const before = net.getNetworkStateAsync.mock.calls.length;
    await act(async () => fireEvent.press(screen.getByTestId("offline-retry")));
    expect(net.getNetworkStateAsync.mock.calls.length).toBe(before + 1);
    expect(screen.getByTestId("offline-bar")).toBeTruthy();
    // The network is back but no event has come yet: the retry is what notices.
    net.getNetworkStateAsync.mockResolvedValueOnce({ isConnected: true, isInternetReachable: true });
    await act(async () => fireEvent.press(screen.getByTestId("offline-retry")));
    expect(screen.queryByTestId("offline-bar")).toBeNull();
  });

  it("the bar takes the status-bar inset; the header under it does not take it again", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    stubApi({ "/me/": { status: 200, data: PROFILE }, "/me/life/": { status: 200, data: life(1) } });
    renderApp();
    await screen.findByTestId("profile-card");
    expect(flat(screen.getByTestId("plaque")).paddingTop).toBe(TOP);
    await drop();
    expect(flat(screen.getByTestId("offline-inset"))).toMatchObject({ paddingTop: TOP });
    expect(flat(screen.getByTestId("plaque")).paddingTop).toBe(0);
    await restore();
    expect(flat(screen.getByTestId("plaque")).paddingTop).toBe(TOP);
  });

  it("back online, the life tab loads again without being pulled; staying offline does not", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    const calls = stubApi({ "/me/": { status: 200, data: PROFILE }, "/me/life/": { status: 200, data: life(1) } });
    renderApp();
    await screen.findByTestId("profile-card");
    const lifeCalls = () => calls.filter((c) => c.url === "/me/life/").length;
    const loaded = lifeCalls();
    await drop();
    await act(async () => net.__set({ isInternetReachable: false })); // another offline event: no return
    expect(lifeCalls()).toBe(loaded);
    await restore();
    expect(lifeCalls()).toBe(loaded + 1);
  });

  // The bug as reported: reduce motion on, the network drops, and the life tab's three requests
  // go out again. Going offline was only the first thing to flush after the mount: the tab
  // navigator first rendered with reduce motion still unanswered ("fade"), then switched to
  // "none" — which turns react-native-screens' container on iOS from RNSScreenContainer into
  // RNSScreenNavigationContainer, a different component, so every tab under it remounted.
  it.each([false, true])("reduce motion %s: the life tab mounts once — going offline does not send its three requests again", async (reduced) => {
    const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
    secure.set(REFRESH_TOKEN_KEY, "R");
    const calls = stubApi({ "/me/": { status: 200, data: PROFILE }, "/me/life/": { status: 200, data: life(1) } });
    renderApp();
    await screen.findByTestId("profile-card");
    await drop();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const count = (u: string) => calls.filter((c) => c.url === u).length;
    expect(["/me/life/", "/me/past-lives/", "/me/sentence-plan/"].map((u) => [u, count(u)])).toEqual([
      ["/me/life/", 1],
      ["/me/past-lives/", 1],
      ["/me/sentence-plan/", 1],
    ]);
    spy.mockResolvedValue(false);
  });
});

// ui.tsx reads the network state from online.ts, never from network.tsx: network.tsx draws the
// bar with ui.tsx's components, so the other direction was a require cycle Metro warned about.
describe("no require cycle between ui.tsx and network.tsx", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("path") as typeof import("path");
  const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
  const imports = (f: string) => [...src(f).matchAll(/from "\.\/([\w-]+)"/g)].map((m) => m[1]);

  it("ui.tsx does not import network.tsx, and online.ts imports neither", () => {
    expect(imports("ui.tsx")).not.toContain("network");
    expect(imports("ui.tsx")).toContain("online");
    expect(imports("online.ts")).toEqual([]);
  });
});
