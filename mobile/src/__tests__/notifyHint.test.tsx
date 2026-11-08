/**
 * 「锁屏上看不到进度」 (用户 2026-11-08 决定): Android 12 and below have no notification dialog, so with notifications off
 * (华为 TAS-AL00, API 31) the lock-screen progress never appeared and nothing said why. The first live progress there
 * owes one sheet; Android 13+ keeps its one system dialog and no sheet. Either button ends it for good.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { LIVE_ASKED_KEY, LIVE_HINT_SEEN_KEY, dismissNotifySettingsHint, shouldOfferNotifySettings, showLiveProgress } from "../liveProgress";
import { installMobilePlatform, persistentStore } from "../platform";
import { NotifySettingsHint, setBioSettled } from "../screens/notifyHint";
import type { LiveContent } from "@soulledger/core/domain/soulRoute";

const system = (Notifications as unknown as { __state: { status: string; answer: string; requests: number; canAskAgain?: boolean } }).__state;
const CONTENT = {
  title: "灵魂簿 · 实时进度",
  tag: "",
  headline: "张三 · 第一殿",
  count: "1 / 10",
  compact: "1/10",
  place: "第一殿",
  island: "张三",
  first: "鬼门关",
  current: "第一殿",
  last: "第十殿",
  progress: 0.1,
  ended: false,
} as LiveContent;

describe("shouldOfferNotifySettings", () => {
  it.each([
    [31, "denied", false, true],
    [31, "undetermined", false, true],
    [32, "denied", false, true],
    [31, "granted", false, false],
    [31, "denied", true, false],
    [33, "denied", false, false],
    [34, "undetermined", false, false],
  ] as const)("API %i, %s, seen %s → %s", (apiLevel, permission, seen, offer) => {
    expect(shouldOfferNotifySettings({ apiLevel, permission, seen })).toBe(offer);
  });
});

describe("the sheet", () => {
  const os = Platform.OS;
  const version = Platform.Version;

  const setApi = (v: number) => Object.defineProperty(Platform, "Version", { value: v, configurable: true });
  const renderHint = (held = false) => {
    setBioSettled(!held);
    return render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <I18nProvider>
          <NotifySettingsHint />
        </I18nProvider>
      </SafeAreaProvider>
    );
  };

  beforeEach(() => {
    installMobilePlatform();
    dismissNotifySettingsHint();
    persistentStore.remove(LIVE_HINT_SEEN_KEY);
    persistentStore.remove(LIVE_ASKED_KEY);
    Object.assign(system, { status: "denied", answer: "denied", requests: 0, canAskAgain: false });
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    setApi(31);
  });
  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: os, configurable: true });
    Object.defineProperty(Platform, "Version", { value: version, configurable: true });
  });

  it("API 31, notifications off: the first live progress owes the sheet, and asks the system nothing", async () => {
    renderHint();
    expect(screen.queryByTestId("notify-hint")).toBeNull();
    await act(() => showLiveProgress(CONTENT, "#C8604F"));
    expect(await screen.findByTestId("notify-hint")).toBeTruthy();
    expect(system.requests).toBe(0);
  });

  it("held (the fingerprint question is still to come): not shown until it is let go", async () => {
    renderHint(true);
    await act(() => showLiveProgress(CONTENT, "#C8604F"));
    expect(screen.queryByTestId("notify-hint")).toBeNull();
    act(() => setBioSettled(true));
    expect(await screen.findByTestId("notify-hint")).toBeTruthy();
  });

  it("「以后再说」: closed, marked seen, never owed again", async () => {
    renderHint();
    await act(() => showLiveProgress(CONTENT, "#C8604F"));
    fireEvent.press(await screen.findByTestId("notify-hint-later"));
    expect(persistentStore.get(LIVE_HINT_SEEN_KEY)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("notify-hint")).toBeNull());
    await act(() => showLiveProgress(CONTENT, "#C8604F"));
    expect(screen.queryByTestId("notify-hint")).toBeNull();
  });

  it("「前往系统设置」: closed, marked seen, and the app's notification settings opened", async () => {
    const intent = jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined);
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    renderHint();
    await act(() => showLiveProgress(CONTENT, "#C8604F"));
    fireEvent.press(await screen.findByTestId("notify-hint-open"));
    expect(persistentStore.get(LIVE_HINT_SEEN_KEY)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("notify-hint")).toBeNull());
    // The notification page where the app knows its package; the app's settings page otherwise.
    await waitFor(() => expect(intent.mock.calls.length + settings.mock.calls.length).toBe(1));
    if (intent.mock.calls.length) expect(intent.mock.calls[0][0]).toBe("android.settings.APP_NOTIFICATION_SETTINGS");
    intent.mockRestore();
    settings.mockRestore();
  });

  it("Android 13+: the system dialog as before, and no sheet even after a refusal", async () => {
    setApi(34);
    Object.assign(system, { status: "undetermined", canAskAgain: undefined });
    renderHint();
    await act(() => showLiveProgress(CONTENT, "#C8604F"));
    expect(system.requests).toBe(1);
    expect(screen.queryByTestId("notify-hint")).toBeNull();
  });

  it("granted: no sheet", async () => {
    system.status = "granted";
    renderHint();
    await act(() => showLiveProgress(CONTENT, "#C8604F"));
    expect(screen.queryByTestId("notify-hint")).toBeNull();
  });
});
