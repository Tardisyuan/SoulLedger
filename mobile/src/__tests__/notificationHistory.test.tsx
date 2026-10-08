/**
 * 通知记录(设置页 → 通知记录):列表最新在前、未送达角标、「更多」翻页、空、出错重试,
 * 点一条带目标的去它指向的地方 —— 与锁屏点通知同一条 `landOn`。
 * 走真实导航器与 core 的真实 soul 客户端;接口由 stubApi 应答。
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform } from "../platform";
import { SessionProvider } from "../session";
import { PROFILE, application, life, stubApi, type Reply } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const SETTINGS = { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" };
const APP_ID = "3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6";

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "judgment_result",
    title: `标题 ${id}`,
    body: `正文 ${id}`,
    status: "DELIVERED",
    data: { screen: "Life", kind: "judgment_result" },
    created_at: "2026-10-08T09:30:00Z",
    ...overrides,
  };
}

function page(results: unknown[], next: string | null = null) {
  return { status: 200, data: { count: results.length, next, previous: null, results } };
}

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
    ...extra,
  });
}

async function openHistory() {
  await screen.findByTestId("profile-card");
  fireEvent.press(screen.getByTestId("header-account"));
  fireEvent.press(await screen.findByTestId("open-history"));
  await screen.findByTestId("notification-history");
  expect(navigationRef.getCurrentRoute()?.name).toBe("NotificationHistory");
}

beforeEach(async () => {
  installMobilePlatform();
  secure.clear();
  await AsyncStorage.clear();
});

it("lists what was sent, newest first as the server gives it, flags the undelivered, and pages with 「更多」", async () => {
  const calls = signedIn({
    "GET /me/notifications/": [
      page([item("a"), item("b", { status: "FAILED" })], "http://x/me/notifications/?page=2"),
      page([item("c")]),
    ],
  });
  renderApp();
  await openHistory();

  const rows = await screen.findAllByTestId(/^notification-[a-z]$/);
  expect(rows.map((r) => r.props.testID)).toEqual(["notification-a", "notification-b"]);
  expect(within(rows[0]).getByText("标题 a")).toBeTruthy();
  expect(within(rows[0]).getByText("正文 a")).toBeTruthy();
  expect(screen.queryByTestId("not-delivered-a")).toBeNull();
  expect(screen.getByTestId("not-delivered-b")).toBeTruthy();
  expect(screen.queryByTestId("history-empty")).toBeNull();

  fireEvent.press(screen.getByTestId("history-more"));
  await screen.findByTestId("notification-c");
  expect(screen.queryByTestId("history-more")).toBeNull(); // the last page has no next
  expect(calls.filter((c) => c.url === "/me/notifications/").map((c) => c.params)).toEqual([{ page: 1 }, { page: 2 }]);
  await act(async () => {});
});

it("says so when there is nothing yet", async () => {
  signedIn({ "GET /me/notifications/": page([]) });
  renderApp();
  await openHistory();
  await screen.findByTestId("history-empty");
  expect(screen.queryAllByTestId(/^notification-[a-z]$/)).toEqual([]);
  expect(screen.queryByTestId("history-more")).toBeNull();
  await act(async () => {});
});

it("a failed load shows the error with a retry that loads again", async () => {
  signedIn({ "GET /me/notifications/": [{ status: 500 }, page([item("a")])] });
  renderApp();
  await openHistory();
  const error = await screen.findByTestId("history-error");
  expect(error).toBeTruthy();
  expect(screen.queryByTestId("history-empty")).toBeNull();
  fireEvent.press(screen.getByText("重试"));
  await screen.findByTestId("notification-a");
  expect(screen.queryByTestId("history-error")).toBeNull();
  await act(async () => {});
});

it("tapping a row with a target goes where the push would have gone; one without a target is not pressable", async () => {
  signedIn({
    "GET /me/notifications/": page([
      item("app", { data: { screen: "ApplicationDetail", application_id: APP_ID, kind: "rebirth_approved" } }),
      item("none", { data: {} }),
    ]),
    [`/me/rebirth-applications/${APP_ID}/`]: { status: 200, data: application({ id: APP_ID }) },
  });
  renderApp();
  await openHistory();
  const none = await screen.findByTestId("notification-none");
  expect(none.props.accessibilityRole).toBeUndefined();
  expect(none.props.onPress).toBeUndefined();

  fireEvent.press(screen.getByTestId("notification-app"));
  await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe("ApplicationDetail"));
  expect(navigationRef.getCurrentRoute()?.params).toEqual({ id: APP_ID, landed: true });
  await act(async () => {});
});
