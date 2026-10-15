/**
 * 登录设备与记录 (Design 第二十八批 S1): the fourth row of 账号安全 and its sub-page, through the real navigator and
 * core's real soul client; only the network is a double.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform } from "../platform";
import { SessionProvider } from "../session";
import { PROFILE, life, resetLoginMemory, stubApi, type Reply } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const SETTINGS = { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" };

/** An ISO instant that reads back as this local time, so the assertions do not depend on the machine's zone. */
const at = (m: number, d: number, h: number, min: number) => new Date(2026, m - 1, d, h, min).toISOString();

const PHONE = { id: "s-this", label: "iPhone", method: "face", last_seen_at: at(10, 12, 8, 2), current: true, trusted_until: null };
const ANDROID = { id: "s-android", label: "Android 手机", method: "password", last_seen_at: at(10, 9, 21, 3), current: false, trusted_until: null };
const IPAD = { id: "s-ipad", label: "iPad", method: "password", last_seen_at: at(10, 1, 7, 45), current: false, trusted_until: null };

const RECORDS = [
  { at: at(10, 12, 8, 2), ok: true, method: "face", device: "iPhone", count: 1, reason: "" },
  { at: at(10, 9, 21, 3), ok: true, method: "password", device: "Android 手机", count: 1, reason: "" },
  { at: at(10, 9, 20, 58), ok: false, method: "password", device: "Android 手机", count: 3, reason: "invalid_credentials" },
  { at: at(10, 1, 7, 45), ok: true, method: "recovery", device: "iPhone", count: 1, reason: "" },
];

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

function signedIn(extra: Record<string, Reply | Reply[]> = {}) {
  secure.set(REFRESH_TOKEN_KEY, "R");
  return stubApi({
    "/me/": { status: 200, data: PROFILE },
    "/me/life/": { status: 200, data: life(1) },
    "GET /me/notification-settings/": { status: 200, data: SETTINGS },
    "GET /me/mfa/": { status: 200, data: { enabled: false } },
    // the server puts this phone first; the page must not depend on it
    "GET /me/sessions/": { status: 200, data: [ANDROID, PHONE, IPAD] },
    "GET /me/sign-ins/": { status: 200, data: RECORDS },
    ...extra,
  });
}

async function openPage() {
  renderApp();
  await screen.findByTestId("profile-card");
  fireEvent.press(screen.getByTestId("header-account"));
  await screen.findByTestId("settings");
  fireEvent.press(await screen.findByTestId("open-sign-ins"));
  await screen.findByTestId("sign-ins");
}

beforeEach(async () => {
  installMobilePlatform();
  resetLoginMemory();
  secure.clear();
  await AsyncStorage.clear();
});

describe("settings › 账号安全", () => {
  it("has 登录设备与记录 as the fourth row, after the other three, with the device count", async () => {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings");
    await waitFor(() => expect(screen.getByTestId("open-sign-ins-state").props.children).toBe("3"));
    // document order of the four rows, read off the rendered tree
    const tree = JSON.stringify(screen.toJSON());
    const at = ["open-change-password", "open-mfa", "bio-row", "open-sign-ins"].map((id) => tree.indexOf(`"testID":"${id}"`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(within(screen.getByTestId("open-sign-ins")).getByText("登录设备与记录")).toBeTruthy();
  });
});

describe("设备", () => {
  it("lists this phone first with the 「这台」 tag and 「正在使用」, the others by last activity with 「上次 …」 and 「退出」", async () => {
    signedIn();
    await openPage();
    await screen.findByTestId("device-s-this");
    const ids = screen.getAllByTestId(/^device-s-[a-z]+$/).map((n) => n.props.testID);
    expect(ids).toEqual(["device-s-this", "device-s-android", "device-s-ipad"]);
    const phone = within(screen.getByTestId("device-s-this"));
    expect(phone.getByText("这部手机")).toBeTruthy();
    expect(phone.getByText("这台")).toBeTruthy();
    expect(phone.getByText("iPhone · 正在使用")).toBeTruthy();
    // absence: this phone has no way out here, and the others carry no tag
    expect(screen.queryByTestId("device-signout-s-this")).toBeNull();
    expect(screen.getAllByTestId("device-this")).toHaveLength(1);
    const android = within(screen.getByTestId("device-s-android"));
    expect(android.getByText("Android 手机")).toBeTruthy();
    expect(android.getByText("上次 2026-10-09 21:03")).toBeTruthy();
    expect(android.getByText("退出")).toBeTruthy();
    expect(within(screen.getByTestId("device-s-ipad")).getByText("上次 2026-10-01 07:45")).toBeTruthy();
  });

  it("「退出」 asks the server, without a password, and the row goes only when it says yes; the others stay", async () => {
    const calls = signedIn({ "POST /me/sessions/s-android/revoke/": { status: 204 } });
    await openPage();
    await screen.findByTestId("device-s-android");
    fireEvent.press(screen.getByTestId("device-signout-s-android"));
    await waitFor(() => expect(screen.queryByTestId("device-s-android")).toBeNull());
    const revoke = calls.filter((c) => c.method === "POST" && c.url.includes("/revoke/"));
    expect(revoke.map((c) => c.url)).toEqual(["/me/sessions/s-android/revoke/"]);
    expect(revoke[0].body).toBeUndefined();
    expect(screen.getByTestId("device-s-this")).toBeTruthy();
    expect(screen.getByTestId("device-s-ipad")).toBeTruthy();
  });

  it("「退出其他全部」 asks first, then signs every other device out in one call; this phone stays", async () => {
    const calls = signedIn({ "POST /me/sessions/revoke-others/": { status: 200, data: { revoked: 2 } } });
    await openPage();
    fireEvent.press(await screen.findByTestId("sign-out-others"));
    // nothing is sent before the confirmation
    expect(calls.filter((c) => c.url.includes("revoke-others"))).toHaveLength(0);
    expect(within(screen.getByTestId("sign-out-others-sheet")).getByText("退出其他 2 台设备？")).toBeTruthy();
    fireEvent.press(screen.getByTestId("sign-out-others-cancel"));
    expect(calls.filter((c) => c.url.includes("revoke-others"))).toHaveLength(0);
    fireEvent.press(screen.getByTestId("sign-out-others"));
    fireEvent.press(screen.getByTestId("sign-out-others-confirm"));
    await waitFor(() => expect(calls.filter((c) => c.url === "/me/sessions/revoke-others/")).toHaveLength(1));
  });

  it("no 「退出其他全部」 when this phone is the only device", async () => {
    signedIn({ "GET /me/sessions/": { status: 200, data: [PHONE] } });
    await openPage();
    await screen.findByTestId("device-s-this");
    expect(screen.queryByTestId("sign-out-others")).toBeNull();
  });

  it("a refused 「退出」 keeps the row", async () => {
    signedIn({ "POST /me/sessions/s-android/revoke/": { status: 500 } });
    await openPage();
    fireEvent.press(await screen.findByTestId("device-signout-s-android"));
    await screen.findByText("退出失败，请重试");
    expect(screen.getByTestId("device-s-android")).toBeTruthy();
  });

  it("a list that cannot load says so with a retry, and the records still show", async () => {
    const calls = signedIn({ "GET /me/sessions/": { status: 500 } });
    await openPage();
    await screen.findByTestId("devices-error");
    expect(screen.queryByTestId("device-s-this")).toBeNull();
    expect(screen.getAllByTestId("sign-in-record")).toHaveLength(4);
    expect(screen.queryByTestId("records-error")).toBeNull();
    expect(calls.filter((c) => c.url === "/me/sessions/").length).toBeGreaterThan(0);
  });
});

describe("最近登录 · 只保留 90 天", () => {
  it("writes each row as stamp + method + device, and merges the failures into one bold danger row with the count", async () => {
    signedIn();
    await openPage();
    await screen.findAllByTestId("sign-in-record");
    expect(screen.getByText("最近登录 · 只保留 90 天")).toBeTruthy();
    const rows = screen.getAllByTestId("sign-in-record");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("2026-10-12 08:02")).toBeTruthy();
    // the face row is this phone's: the device label equals this session's label
    expect(within(rows[0]).getByText("✓ 面容 · 这部手机")).toBeTruthy();
    expect(within(rows[1]).getByText("✓ 密码 · Android 手机")).toBeTruthy();
    expect(within(rows[3]).getByText("✓ 恢复码 · 这部手机")).toBeTruthy();
    const failure = within(rows[2]).getByText("! 失败 3 次 · 密码不对");
    expect(failure).toBeTruthy();
    expect(screen.getAllByText(/^! /)).toHaveLength(1); // one row, not three
    expect(screen.queryByText(/失败 1 次/)).toBeNull();
    expect(within(rows[2]).queryByText(/✓/)).toBeNull();
  });

  it("says so when there are none", async () => {
    signedIn({ "GET /me/sign-ins/": { status: 200, data: [] } });
    await openPage();
    await screen.findByTestId("records-empty");
    expect(screen.queryByTestId("sign-in-record")).toBeNull();
  });
});

describe("有不认识的设备或记录？", () => {
  it("「修改密码」 opens the change-password screen", async () => {
    signedIn();
    await openPage();
    expect(screen.getByText("有不认识的设备或记录？")).toBeTruthy();
    fireEvent.press(screen.getByTestId("sign-ins-change-password"));
    await screen.findByTestId("old-password");
    expect(navigationRef.getCurrentRoute()?.name).toBe("AccountPassword");
  });
});
