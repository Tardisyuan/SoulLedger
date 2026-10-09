/**
 * 「申请缩短冷却」 on the applications page: offered only under the cooldown refusal
 * and only while the server says `can_shorten_cooldown`; the request's status
 * (pending / approved with the new end / rejected with the note) is read off the list.
 */
import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { landOn, landingOf } from "../push";
import { ApplicationsScreen } from "../screens/applications";
import { stubApi } from "./stubApi";

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

function wrap(children: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <NavigationContainer>{children}</NavigationContainer>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => installMobilePlatform());

const cooling = (over: Record<string, unknown> = {}) => ({
  can_apply: false,
  reason: "cooldown",
  cooldown_until: "2026-10-17T00:00:00Z",
  results: [],
  can_shorten_cooldown: false,
  cooldown_shortening: null,
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  application: "a1",
  cycle: 0,
  reason: "家中有事",
  desired_remaining_days: null,
  status: "PENDING",
  approved_days: null,
  decision_note: "",
  decided_at: null,
  created_at: "2026-10-08T00:00:00Z",
  ...over,
});

it("offers the entry under the cooldown refusal, submits the reason, and reloads the list", async () => {
  const calls = stubApi({
    "GET /me/rebirth-applications/": [
      { status: 200, data: cooling({ can_shorten_cooldown: true }) },
      { status: 200, data: cooling({ cooldown_shortening: row() }) },
    ],
    "POST /me/rebirth-applications/cooldown-shortening/": { status: 201, data: row() },
  });
  wrap(<ApplicationsScreen />);
  fireEvent.press(await screen.findByTestId("request-cooldown-shortening"));
  // An empty reason is refused locally — nothing sent.
  fireEvent.press(screen.getByTestId("submit-cooldown-shortening"));
  expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  fireEvent.changeText(screen.getByTestId("cooldown-shortening-reason"), "家中有事");
  fireEvent.press(screen.getByTestId("submit-cooldown-shortening"));
  expect(await screen.findByText("缩短冷却申请待决定")).toBeTruthy();
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({ reason: "家中有事" });
  expect(screen.queryByTestId("request-cooldown-shortening")).toBeNull();
});

it("is not offered when the refusal is not the cooldown, nor when the server says the chance is used", async () => {
  stubApi({ "/me/rebirth-applications/": { status: 200, data: cooling({ reason: "application_open", can_shorten_cooldown: true }) } });
  wrap(<ApplicationsScreen />);
  await screen.findByTestId("apply");
  expect(screen.queryByTestId("cooldown-shortening")).toBeNull();
});

it("shows an approval with the list's (shortened) end date, and a rejection with its note", async () => {
  stubApi({
    "/me/rebirth-applications/": {
      status: 200,
      data: cooling({ cooldown_until: "2026-10-11T00:00:00Z", cooldown_shortening: row({ status: "APPROVED", approved_days: 3 }) }),
    },
  });
  wrap(<ApplicationsScreen />);
  expect(await screen.findByText(/^缩短冷却申请已批准，冷却期至 /)).toBeTruthy();
  expect(screen.queryByTestId("request-cooldown-shortening")).toBeNull();

  screen.unmount();
  stubApi({
    "/me/rebirth-applications/": {
      status: 200,
      data: cooling({ cooldown_shortening: row({ status: "REJECTED", decision_note: "理由不足" }) }),
    },
  });
  wrap(<ApplicationsScreen />);
  expect(await screen.findByText("缩短冷却申请被驳回")).toBeTruthy();
  expect(screen.getByText(/理由不足/)).toBeTruthy();
  expect(screen.queryByTestId("request-cooldown-shortening")).toBeNull();
});

it("a push for the decision lands on the applications tab", () => {
  const landing = landingOf({ screen: "Applications", kind: "cooldown_shortening_approved" });
  expect(landing).toEqual({ screen: "Applications" });
  // And it really goes there: `landOn` is the one routing table for pushes and the history list.
  const navigate = jest.fn();
  landOn(navigate as never, landing!);
  expect(navigate).toHaveBeenCalledWith("Tabs", { screen: "Applications", params: { landed: true } });
});

it("after an approval the cooling-off line carries 「↑ 已提前」 beside the new date; before one it does not", async () => {
  stubApi({
    "/me/rebirth-applications/": {
      status: 200,
      data: cooling({ cooldown_until: "2026-10-11T00:00:00Z", cooldown_shortening: row({ status: "APPROVED", approved_days: 3 }) }),
    },
  });
  wrap(<ApplicationsScreen />);
  expect(await screen.findByTestId("cooldown-brought-forward")).toBeTruthy();
  expect(screen.getByText("↑ 已提前")).toBeTruthy();
  screen.unmount();

  for (const shortening of [null, row(), row({ status: "REJECTED", decision_note: "x" })]) {
    stubApi({ "/me/rebirth-applications/": { status: 200, data: cooling({ cooldown_shortening: shortening }) } });
    const view = wrap(<ApplicationsScreen />);
    await screen.findByTestId("cooldown-until");
    expect(screen.queryByTestId("cooldown-brought-forward")).toBeNull();
    view.unmount();
  }
});

describe("the push-arrival wash on the shortening block", () => {
  const approved = () =>
    stubApi({ "/me/rebirth-applications/": { status: 200, data: cooling({ cooldown_shortening: row({ status: "APPROVED", approved_days: 3 }) }) } });

  it("is drawn only when the page was landed on from a push", async () => {
    approved();
    wrap(<ApplicationsScreen landed />);
    await screen.findByTestId("cooldown-block");
    expect(screen.getByTestId("cooldown-landing")).toBeTruthy();
    screen.unmount();

    approved();
    wrap(<ApplicationsScreen />);
    await screen.findByTestId("cooldown-block");
    expect(screen.queryByTestId("cooldown-landing")).toBeNull();
  });

  it("is not drawn at all under reduce motion", async () => {
    const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    approved();
    wrap(<ApplicationsScreen landed />);
    await screen.findByTestId("cooldown-block");
    await screen.findByTestId("cooldown-shortening");
    // Reduce motion is answered after the first render; by then the wash is gone.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("cooldown-landing")).toBeNull();
    spy.mockRestore();
  });
});

describe("the optional 「希望缩短到几天」 field", () => {
  // The reduce-motion test above `mockRestore`s a jest-mocked RN function back to returning undefined.
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  });
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000 - 3_600_000).toISOString(); // n days left, rounded up
  const open = async () => {
    const calls = stubApi({
      "GET /me/rebirth-applications/": { status: 200, data: cooling({ cooldown_until: inDays(8), can_shorten_cooldown: true }) },
      "POST /me/rebirth-applications/cooldown-shortening/": { status: 201, data: row({ desired_remaining_days: 2 }) },
    });
    wrap(<ApplicationsScreen />);
    fireEvent.press(await screen.findByTestId("request-cooldown-shortening"));
    fireEvent.changeText(screen.getByTestId("cooldown-shortening-reason"), "家中有事");
    return calls;
  };

  it("shows the days left as its hint and sends the wish with the reason", async () => {
    const calls = await open();
    expect(screen.getByText("现在还剩 8 天。填 0 表示希望立即结束；不填则由官员决定。")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("cooldown-shortening-desired"), "2");
    fireEvent.press(screen.getByTestId("submit-cooldown-shortening"));
    expect(await screen.findByTestId("cooldown-shortening")).toBeTruthy();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ reason: "家中有事", desired_remaining_days: 2 });
  });

  it("sends 0 as a real wish, and refuses a number that is not below the days left", async () => {
    const calls = await open();
    fireEvent.changeText(screen.getByTestId("cooldown-shortening-desired"), "8");
    fireEvent.press(screen.getByTestId("submit-cooldown-shortening"));
    expect(await screen.findByText("天数须是 0 到 7 的整数")).toBeTruthy();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    fireEvent.changeText(screen.getByTestId("cooldown-shortening-desired"), "0");
    fireEvent.press(screen.getByTestId("submit-cooldown-shortening"));
    await screen.findByTestId("cooldown-shortening");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ reason: "家中有事", desired_remaining_days: 0 });
  });
});
