/**
 * 导出我的资料 (Design 第二十八批 S3), through the real navigator and core's real soul client; only the network, the
 * face check, the cache directory and the share sheet are doubles (jest.setup.js).
 *
 * Every "can" has its "cannot" beside it: the request needs proof of who is asking, a request in preparation hides the
 * request button, a ready file hides it too, and the zip never stays on the phone.
 */
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, platform } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import * as Sharing from "expo-sharing";
import * as SecureStore from "expo-secure-store";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BIO_KEY, EXPORT_PROMPT } from "../deviceLogin";
import { formatBytes, safeFileName } from "../dataExport";
import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { SessionProvider } from "../session";
import { PROFILE, life, resetLoginMemory, stubApi, type Reply } from "./stubApi";

const secure = SecureStore as unknown as { __store: Map<string, string>; __guarded: Map<string, string>; __auth: { error: unknown; prompts: string[] } };
const system = jest.requireMock("expo-file-system") as { __files: Map<string, string>; __downloads: { url: string; options?: { headers?: Record<string, string> }; name: string }[]; __download: { fail: boolean } };
const share = Sharing.shareAsync as jest.Mock;
const SETTINGS = { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" };
const CRED = "device-credential-of-this-phone";

/** An ISO instant that reads back as this local time, so the assertions do not depend on the machine's zone. */
const at = (m: number, d: number, h: number, min: number) => new Date(2026, m - 1, d, h, min).toISOString();

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "e1",
  status: "QUEUED",
  requested_at: at(10, 12, 9, 30),
  finished_at: null,
  expires_at: null,
  file_name: "",
  byte_size: null,
  download_url: null,
  ...overrides,
});
const READY = row({
  status: "READY",
  finished_at: at(10, 12, 9, 41),
  expires_at: at(10, 19, 9, 41),
  file_name: "soulledger-QU33Q9FW5F-20261012.zip",
  byte_size: Math.round(12.4 * 1024 * 1024),
  download_url: "/api/v1/me/export/file/?t=signed-1",
});
const state = (exportRow: unknown): Reply => ({ status: 200, data: { export: exportRow } });

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
  secure.__store.set(REFRESH_TOKEN_KEY, "R");
  return stubApi({
    "/me/": { status: 200, data: PROFILE },
    "/me/life/": { status: 200, data: life(1) },
    "GET /me/notification-settings/": { status: 200, data: SETTINGS },
    "GET /me/mfa/": { status: 200, data: { enabled: false } },
    "GET /me/sessions/": { status: 200, data: [] },
    "GET /me/export/": state(null),
    ...extra,
  });
}

async function openSettings() {
  renderApp();
  await screen.findByTestId("profile-card");
  fireEvent.press(screen.getByTestId("header-account"));
  await screen.findByTestId("settings");
}

async function openPage() {
  await openSettings();
  fireEvent.press(await screen.findByTestId("open-export"));
  await screen.findByTestId("data-export");
}

const typePassword = (value: string) => fireEvent.changeText(screen.getByTestId("export-password"), value);

beforeEach(async () => {
  installMobilePlatform();
  resetLoginMemory();
  secure.__store.clear();
  system.__files.clear();
  system.__downloads.length = 0;
  system.__download.fail = false;
  share.mockClear();
  share.mockImplementation(async () => undefined);
  await AsyncStorage.clear();
});

describe("settings", () => {
  it("has 我的资料 as its own section under 账号安全 with exactly one row, and 帮助与反馈 as the last section: 帮助, then 关于", async () => {
    signedIn();
    await openSettings();
    await screen.findByTestId("push-toggles");
    await waitFor(() => expect(screen.getByTestId("open-mfa-state")).toBeTruthy());
    const tree = JSON.stringify(screen.toJSON());
    const order = ["group-security", "open-sign-ins", "group-data", "open-export", "group-help", "open-help", "open-about"].map((id) => tree.indexOf(`"testID":"${id}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(within(screen.getByTestId("group-data")).getByText("我的资料")).toBeTruthy();
    expect(within(screen.getByTestId("open-export")).getByText("导出我的资料")).toBeTruthy();
    expect(within(screen.getByTestId("group-help")).getByText("帮助与反馈")).toBeTruthy();
    expect(within(screen.getByTestId("open-help")).getByText("帮助")).toBeTruthy();
    // one row each: the feedback form has no row of its own, and the export is not among the security rows
    expect(screen.queryByTestId("open-feedback")).toBeNull();
    expect(screen.queryByTestId("open-write")).toBeNull();
    expect(tree.match(/"testID":"open-export"/g)).toHaveLength(1);
    expect(tree.match(/"testID":"open-help"/g)).toHaveLength(1);
  });
});

describe("before any request", () => {
  it("says what the file holds and what it does not, and asks for the password; nothing is in preparation", async () => {
    signedIn();
    await openPage();
    await screen.findByTestId("export-request");
    expect(screen.getByText("把本殿记下的、关于你的资料打包成一个文件。")).toBeTruthy();
    const included = ["基本资料与编号", "功过记录", "审判结果", "书信与朋友圈(含图片)", "最近 90 天的登录记录"];
    included.forEach((line, i) => expect(screen.getAllByTestId(/^included-/)[i]).toHaveTextContent(line));
    expect(screen.getAllByTestId(/^included-/)).toHaveLength(5);
    expect(screen.getAllByTestId(/^excluded-/).map((n) => n.props.children)).toEqual(["官员之间的评议", "别人发给你之外的书信"]);
    expect(screen.getByText("一般几分钟，资料多时最长一天。好了会通知你。文件 7 天内可以取。")).toBeTruthy();
    expect(within(screen.getByTestId("export-request")).getByText("输入密码并申请")).toBeTruthy();
    expect(screen.queryByTestId("export-queued")).toBeNull();
    expect(screen.queryByTestId("export-ready")).toBeNull();
  });

  it("asks the server only after the password, and a wrong one keeps the sheet and makes nothing", async () => {
    const calls = signedIn({ "POST /me/export/": { status: 400, data: { detail: "密码不对。", code: "wrong_password", remaining_attempts: 3 } } });
    await openPage();
    fireEvent.press(await screen.findByTestId("export-request"));
    await screen.findByTestId("export-sheet");
    expect(calls.some((c) => c.method === "POST" && c.url === "/me/export/")).toBe(false);
    // no password, no request
    expect(screen.getByTestId("export-next").props.accessibilityState.disabled).toBe(true);
    typePassword("not-it");
    fireEvent.press(screen.getByTestId("export-next"));
    await screen.findByTestId("step-wrong");
    expect(calls.filter((c) => c.method === "POST" && c.url === "/me/export/").map((c) => c.body)).toEqual([{ password: "not-it" }]);
    expect(screen.queryByTestId("export-queued")).toBeNull();
    expect(screen.getByTestId("export-sheet")).toBeTruthy();
  });

  it("the right password queues it: the sheet goes, 「◐ 正在准备」 with the request time shows, the request button is gone", async () => {
    const calls = signedIn({
      "POST /me/export/": { status: 201, data: row() },
      "GET /me/export/": [state(null), state(row())],
    });
    await openPage();
    fireEvent.press(await screen.findByTestId("export-request"));
    await screen.findByTestId("export-sheet");
    typePassword("the-password");
    fireEvent.press(screen.getByTestId("export-next"));
    const queued = await screen.findByTestId("export-queued");
    expect(calls.find((c) => c.method === "POST" && c.url === "/me/export/")?.body).toEqual({ password: "the-password" });
    expect(within(queued).getByText("◐ 正在准备")).toBeTruthy();
    expect(within(queued).getByText("申请于 2026-10-12 09:30。可以离开这页，好了会通知你。")).toBeTruthy();
    expect(screen.queryByTestId("export-request")).toBeNull();
    expect(screen.queryByTestId("export-ready")).toBeNull();
  });

  it("a request already in preparation (409) closes the sheet and shows that one, not an error", async () => {
    signedIn({
      "POST /me/export/": { status: 409, data: { detail: "已经有一份资料在准备了。", code: "export_in_progress" } },
      "GET /me/export/": [state(null), state(row())],
    });
    await openPage();
    fireEvent.press(await screen.findByTestId("export-request"));
    await screen.findByTestId("export-sheet");
    typePassword("the-password");
    fireEvent.press(screen.getByTestId("export-next"));
    await screen.findByTestId("export-queued");
    expect(screen.queryByTestId("step-other")).toBeNull();
  });
});

describe("face instead of the password", () => {
  const faceOn = () => {
    persistentStore.set(BIO_KEY, "face");
    secure.__guarded.set("soulledger_device_login", CRED);
  };

  it("with 面容登录 on, the face is asked first and its credential is the proof -- no password sheet", async () => {
    faceOn();
    const calls = signedIn({
      "POST /me/export/": { status: 201, data: row() },
      "GET /me/export/": [state(null), state(row())],
    });
    await openPage();
    fireEvent.press(await screen.findByTestId("export-request"));
    await screen.findByTestId("export-queued");
    expect(calls.find((c) => c.method === "POST" && c.url === "/me/export/")?.body).toEqual({ credential: CRED });
    expect(secure.__auth.prompts).toEqual([EXPORT_PROMPT]);
    expect(screen.queryByTestId("export-sheet")).toBeNull();
  });

  it("a face that is not recognised falls back to the password sheet and sends nothing", async () => {
    faceOn();
    secure.__auth.error = Object.assign(new Error("user cancel"), { code: "ERR_AUTHENTICATION_CANCELED" });
    const calls = signedIn();
    await openPage();
    fireEvent.press(await screen.findByTestId("export-request"));
    await screen.findByTestId("export-sheet");
    expect(calls.some((c) => c.method === "POST" && c.url === "/me/export/")).toBe(false);
  });
});

describe("ready", () => {
  it("shows the file name, size and last day, and 「保存或发送…」; the request button and the intro are gone", async () => {
    signedIn({ "GET /me/export/": state(READY) });
    await openPage();
    const ready = await screen.findByTestId("export-ready");
    expect(within(ready).getByText("✓ 已准备好")).toBeTruthy();
    expect(screen.getByTestId("export-file-name")).toHaveTextContent("soulledger-QU33Q9FW5F-20261012.zip");
    expect(within(ready).getByText(/12\.4 MB/)).toBeTruthy();
    expect(within(ready).getByText(/可取到 2026-10-19 09:41/)).toBeTruthy();
    expect(within(screen.getByTestId("export-share")).getByText("保存或发送…")).toBeTruthy();
    expect(screen.getByText("「保存或发送…」打开系统分享面板。过期后要重新申请。一次只能有一份在准备。")).toBeTruthy();
    expect(screen.queryByTestId("export-request")).toBeNull();
    expect(screen.queryByTestId("included-profile")).toBeNull();
    expect(screen.queryByTestId("export-queued")).toBeNull();
  });

  it("「保存或发送…」 asks for a fresh link, downloads with the soul's token, opens the system share sheet and leaves no file", async () => {
    const calls = signedIn({ "GET /me/export/": [state(READY), state({ ...READY, download_url: "/api/v1/me/export/file/?t=signed-2" })] });
    await openPage();
    platform().session.set(ACCESS_TOKEN_KEY, "A-token");
    fireEvent.press(await screen.findByTestId("export-share"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    // the second GET is the fresh link; the zip came from THAT one
    expect(calls.filter((c) => c.method === "GET" && c.url === "/me/export/")).toHaveLength(2);
    expect(system.__downloads).toHaveLength(1);
    expect(system.__downloads[0].url).toMatch(/\/api\/v1\/me\/export\/file\/\?t=signed-2$/);
    expect(system.__downloads[0].options?.headers).toEqual({ Authorization: "Bearer A-token" });
    expect(system.__downloads[0].name).toBe("soulledger-QU33Q9FW5F-20261012.zip");
    expect(share.mock.calls[0][1]).toMatchObject({ mimeType: "application/zip" });
    // the file existed while the sheet was up and is gone now; nothing of ours is left in the cache
    await waitFor(() => expect([...system.__files.keys()]).toEqual([]));
  });

  it("a download that fails says so, opens no sheet and leaves no file", async () => {
    system.__download.fail = true;
    signedIn({ "GET /me/export/": state(READY) });
    await openPage();
    fireEvent.press(await screen.findByTestId("export-share"));
    expect((await screen.findByTestId("toast")).props.children).toBe("文件没有取下来。检查网络后再试。");
    expect(share).not.toHaveBeenCalled();
    expect([...system.__files.keys()]).toEqual([]);
  });

  it("a sheet that cannot open says so and still deletes the zip", async () => {
    share.mockRejectedValueOnce(new Error("no sheet"));
    signedIn({ "GET /me/export/": state(READY) });
    await openPage();
    fireEvent.press(await screen.findByTestId("export-share"));
    expect((await screen.findByTestId("toast")).props.children).toBe("没有打开分享面板。再试一次。");
    expect([...system.__files.keys()]).toEqual([]);
  });

  it("if the server has let it expire in between, nothing is downloaded and the page shows what the server says now", async () => {
    signedIn({ "GET /me/export/": [state(READY), state({ ...READY, status: "EXPIRED", download_url: null })] });
    await openPage();
    fireEvent.press(await screen.findByTestId("export-share"));
    await screen.findByTestId("export-expired");
    expect(system.__downloads).toEqual([]);
    expect(share).not.toHaveBeenCalled();
  });
});

describe("expired and failed", () => {
  it("expired: says so and offers a new request (and no download)", async () => {
    signedIn({ "GET /me/export/": state({ ...READY, status: "EXPIRED", download_url: null }) });
    await openPage();
    await screen.findByTestId("export-expired");
    expect(screen.getByText("这份资料已过期。需要的话重新申请。")).toBeTruthy();
    expect(within(screen.getByTestId("export-request")).getByText("重新申请")).toBeTruthy();
    expect(screen.queryByTestId("export-share")).toBeNull();
  });

  it("failed: says so and offers a new request", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    signedIn({ "GET /me/export/": state(row({ status: "FAILED" })) });
    await openPage();
    await screen.findByTestId("export-failed");
    expect(screen.getByText("这次没有做成。可以重新申请。")).toBeTruthy();
    // An alert with the labelled ⚠, spoken once when the state arrives (role=alert alone is silent on iOS).
    expect(screen.UNSAFE_getAllByProps({ accessibilityRole: "alert" }).length).toBeGreaterThan(0);
    expect(screen.UNSAFE_getAllByProps({ accessibilityLabel: "错误" }).length).toBeGreaterThan(0);
    expect(announce.mock.calls.filter(([s]) => s === "这次没有做成。可以重新申请。")).toHaveLength(1);
    expect(screen.getByTestId("export-request")).toBeTruthy();
    expect(screen.queryByTestId("export-queued")).toBeNull();
  });
});

describe("the page follows the server", () => {
  it("while in preparation it asks again by itself and turns into 「已准备好」 when the server says ready", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      const calls = signedIn({ "GET /me/export/": [state(row()), state(READY)] });
      await openPage();
      await screen.findByTestId("export-queued");
      const before = calls.filter((c) => c.url === "/me/export/").length;
      await act(async () => {
        jest.advanceTimersByTime(21_000);
      });
      await screen.findByTestId("export-ready");
      expect(calls.filter((c) => c.url === "/me/export/").length).toBeGreaterThan(before);
      expect(screen.queryByTestId("export-queued")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("rules", () => {
  it("sizes read the way the design writes them", () => {
    expect(formatBytes(Math.round(12.4 * 1024 * 1024))).toBe("12.4 MB");
    expect(formatBytes(830 * 1024)).toBe("830 KB");
    expect(formatBytes(null)).toBe("");
  });

  it("a file name from the server is made safe, and a name that is not ours is replaced", () => {
    expect(safeFileName("soulledger-QU33Q9FW5F-20261012.zip")).toBe("soulledger-QU33Q9FW5F-20261012.zip");
    expect(safeFileName("soulledger-../../x.zip")).toBe("soulledger-.._.._x.zip");
    expect(safeFileName("evil.zip")).toBe("soulledger-export.zip");
  });
});
