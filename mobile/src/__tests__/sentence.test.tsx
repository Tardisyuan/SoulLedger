/**
 * 「我的受刑」(受刑 handoff 1b–1d): the life page's section, the full list in
 * the six plan states, the rebirth page's refusal block, and a push landing.
 * The plan is what `/me/sentence-plan/` answers — the nine-to-five merge is the
 * server's (backend/tests/test_soul_sentence_plan.py), so fixtures here are
 * already merged.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import type { ReactNode } from "react";
import { AccessibilityInfo, ScrollView, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NODE } from "../emblems";
import { I18nProvider } from "../i18n";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform } from "../platform";
import { landingOf } from "../push";
import { ApplicationsScreen } from "../screens/applications";
import { SentenceScreen, SentenceSection, useSentencePlan, type SentenceLanding } from "../screens/sentence";
import { SessionProvider } from "../session";
import { PROFILE, life, pressTab, stubApi } from "./stubApi";

const mockNavigate = jest.fn();
/** The whole-app tests need the real navigation; the screen tests record navigate(). */
const mockUseReal = { current: false };
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useNavigation: () => (mockUseReal.current ? actual.useNavigation() : { navigate: mockNavigate, goBack: jest.fn() }),
  };
});

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const system = (Notifications as unknown as { __state: { responseListeners: Set<(r: unknown) => void> } }).__state;

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const REALM = (code: string, zh: string) => ({ realm_code: code, name_local: code, name_zh: zh, name_en: code });

type Station = Record<string, unknown>;
const station = (n: number, status: string, over: Station = {}): Station => ({
  id: ID(n),
  n,
  status,
  is_home: true,
  civilization: "CHINESE",
  realm: REALM(`R${n}`, ["枉死城", "寒冰狱", "铁树狱"][n - 1] ?? `界${n}`),
  sentence_years: [3, 12, 8][n - 1] ?? 5,
  is_eternal: false,
  started_on: status === "pending" || status === "pardoned" ? null : "2026-09-14",
  ends_on: status === "pending" || status === "pardoned" ? null : "2038-09-14",
  ...over,
});
const plan = (state: string, stations: Station[], rebirth_open = true) => ({ state, rebirth_open, stations });

const AWAY = { is_home: false, civilization: "EGYPTIAN" };
const PLANS = {
  serving: plan("serving", [station(1, "done"), station(2, "active", AWAY), station(3, "pending")]),
  between: plan("between", [station(1, "done"), station(2, "pending", AWAY), station(3, "pending")]),
  waiting: plan("waiting", [station(1, "done"), station(2, "waiting", AWAY), station(3, "pending")]),
  eternal: plan("eternal", [station(1, "done"), station(2, "eternal", { is_eternal: true, sentence_years: null, ends_on: null })]),
  pardoned: plan("pardoned", [station(1, "done"), station(2, "done"), station(3, "pardoned")]),
  completed: plan("completed", [station(1, "done"), station(2, "done", AWAY), station(3, "done")]),
};

function wrap(children: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <NavigationContainer>{children}</NavigationContainer>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

type Host = { type: unknown; props: Record<string, unknown> };
/** Nodes under `testID` that match — host nodes only, unless `composite` (the svg elements as written). */
const hosts = (testID: string, match: (n: Host) => boolean, composite = false) =>
  (screen.getByTestId(testID) as unknown as { findAll: (p: (n: Host) => boolean) => Host[] }).findAll(
    (n) => (composite || typeof n.type === "string") && match(n)
  );
/** The section as the life page mounts it: the page owns the request. */
function Section({ landing }: { landing?: SentenceLanding }) {
  return <SentenceSection remote={useSentencePlan({ landing, reloadKey: 0 })} landing={landing} />;
}

const paths = (testID: string) => hosts(testID, (n) => typeof n.props.d === "string").map((n) => n.props.d as string);
const nodeIDs = () => screen.queryAllByTestId(/^station-node-/).map((n) => n.props.testID as string);

beforeEach(() => {
  installMobilePlatform();
  mockNavigate.mockReset();
  mockUseReal.current = false;
});

describe("the life page's section (1b)", () => {
  it("shows one axis point per station and details only the current one", async () => {
    stubApi({ "/me/sentence-plan/": { status: 200, data: PLANS.serving } });
    wrap(<Section />);
    await screen.findByTestId("station-2");
    expect(screen.getByTestId("sentence-progress").props.children).toBe("第 2 / 3 站");
    expect(nodeIDs()).toEqual(["station-node-1-cn", "station-node-2-eg", "station-node-3-cn"]);
    expect(screen.queryByTestId("station-1")).toBeNull();
    expect(screen.queryByTestId("station-3")).toBeNull();
    expect(screen.getByText("寒冰狱")).toBeTruthy();
    expect(screen.getByText("杜阿特 · 暂居")).toBeTruthy();
    // solid up to where the soul is, dashed after
    expect(hosts("axis-link-2", (n) => n.props.strokeDasharray !== undefined, true)).toHaveLength(0);
    expect(hosts("axis-link-2", (n) => n.props.x2 === "100%", true).length).toBeGreaterThan(0);
    expect(hosts("axis-link-3", (n) => n.props.strokeDasharray === "3 3", true).length).toBeGreaterThan(0);
    fireEvent.press(screen.getByTestId("sentence-all"));
    expect(mockNavigate).toHaveBeenCalledWith("Sentence", { landing: undefined });
  });

  it("draws each station in its own civilization's node shape, whatever the skin", async () => {
    stubApi({ "/me/sentence-plan/": { status: 200, data: PLANS.serving } });
    wrap(<Section />);
    await screen.findByTestId("station-2");
    expect(paths("sentence-axis")).toEqual([NODE.cn, NODE.eg, NODE.cn]);
  });

  it("loading, empty and error each say so; the error retries", async () => {
    stubApi({ "/me/sentence-plan/": [{ status: 500 }, { status: 200, data: plan("none", []) }] });
    wrap(<Section />);
    expect(screen.getByTestId("sentence-loading")).toBeTruthy();
    expect(screen.getByText("加载中…")).toBeTruthy();
    await screen.findByTestId("sentence-error");
    expect(screen.getByText("这一段没取到。其余部分照常显示。")).toBeTruthy();
    fireEvent.press(screen.getByTestId("sentence-retry"));
    expect(await screen.findByTestId("sentence-empty")).toBeTruthy();
    expect(screen.getByText("尚未定下受刑。审判结束后此处入簿。")).toBeTruthy();
    expect(screen.queryByTestId("sentence-all")).toBeNull();
  });

  it("an eternal plan has no axis and no 第 X / Y 站", async () => {
    stubApi({ "/me/sentence-plan/": { status: 200, data: PLANS.eternal } });
    wrap(<Section />);
    await screen.findByTestId("station-2");
    expect(screen.queryByTestId("sentence-axis")).toBeNull();
    expect(screen.queryByTestId("sentence-progress")).toBeNull();
  });
});

describe("the full list in the six plan states (1c)", () => {
  const cases: [keyof typeof PLANS, string | null][] = [
    ["serving", null],
    ["between", "下一站尚未开始"],
    ["waiting", "刑满暂留"],
    ["eternal", "刑期永久"],
    ["pardoned", "剩余刑期已赦免"],
    ["completed", "受刑已全部服完"],
  ];
  it.each(cases)("%s", async (state, banner) => {
    stubApi({ "/me/sentence-plan/": { status: 200, data: PLANS[state] } });
    wrap(<SentenceScreen />);
    await screen.findByTestId(`sentence-screen-${state}`);
    if (banner) expect(screen.getByTestId(`sentence-banner-${state}`)).toBeTruthy();
    else expect(screen.queryByTestId(/^sentence-banner-/)).toBeNull();
    if (banner) expect(screen.getAllByText(banner).length).toBeGreaterThan(0);
    // every station is listed, each in its own shape
    expect(screen.getAllByTestId(/^station-\d+$/)).toHaveLength(PLANS[state].stations.length);
    expect(!!screen.queryByTestId("sentence-apply")).toBe(state === "pardoned" || state === "completed");
    expect(!!screen.queryByText(/^第 \d \/ \d 站$/)).toBe(state !== "eternal");
  });

  it("a pardoned station is struck through and kept; the waiting one says why", async () => {
    stubApi({ "/me/sentence-plan/": { status: 200, data: PLANS.pardoned } });
    wrap(<SentenceScreen />);
    await screen.findByTestId("station-3");
    expect(StyleSheet.flatten(screen.getByText("铁树狱").props.style)).toMatchObject({ textDecorationLine: "line-through" });
    expect(StyleSheet.flatten(screen.getByTestId("station-3").props.style)).toMatchObject({ opacity: 0.62 });
    expect(screen.getByTestId("station-3-status").props.children).toBe("已赦免");
    expect(StyleSheet.flatten(screen.getByText("寒冰狱").props.style).textDecorationLine).toBeUndefined();
  });

  it("the held station carries the reason line", async () => {
    stubApi({ "/me/sentence-plan/": { status: 200, data: PLANS.waiting } });
    wrap(<SentenceScreen />);
    expect((await screen.findByTestId("station-2-why")).props.children).toBe("这一站的刑期已满。原属地尚有审判未结，结案后才动身。");
    expect(screen.queryByTestId("station-1-why")).toBeNull();
  });

  it("a finished plan in a civilization without rebirth does not offer it", async () => {
    stubApi({ "/me/sentence-plan/": { status: 200, data: { ...PLANS.completed, rebirth_open: false } } });
    wrap(<SentenceScreen />);
    await screen.findByTestId("sentence-banner-completed");
    expect(screen.queryByTestId("sentence-apply")).toBeNull();
    expect(screen.queryByText(/申请转生/)).toBeNull();
  });

  it("marks the landed stations 「新」 and no others; opened by hand, none", async () => {
    stubApi({ "/me/sentence-plan/": { status: 200, data: PLANS.serving } });
    const view = wrap(<SentenceScreen landing={{ kind: "sentence_amended", nodeIds: [ID(3)] }} />);
    await screen.findByTestId("station-3-new");
    expect(screen.queryByTestId("station-1-new")).toBeNull();
    expect(screen.queryByTestId("station-2-new")).toBeNull();
    view.unmount();
    wrap(<SentenceScreen />);
    await screen.findByTestId("station-3");
    expect(screen.queryAllByTestId(/-new$/)).toEqual([]);
  });

  it("a pardon marks the struck stations", async () => {
    stubApi({ "/me/sentence-plan/": { status: 200, data: PLANS.pardoned } });
    wrap(<SentenceScreen landing={{ kind: "sentence_pardoned", nodeIds: [] }} />);
    await screen.findByTestId("station-3-new");
    expect(screen.queryAllByTestId(/-new$/).map((n) => n.props.testID)).toEqual(["station-3-new"]);
  });
});

describe("the rebirth page's refusal (1d)", () => {
  it("says how many stations, where the soul is and until when — and links to the plan", async () => {
    stubApi({
      "/me/rebirth-applications/": { status: 200, data: { can_apply: false, reason: "sentence_in_progress", cooldown_until: null, results: [] } },
      "/me/sentence-plan/": { status: 200, data: PLANS.serving },
    });
    wrap(<ApplicationsScreen />);
    await screen.findByTestId("sentence-blocked");
    expect(await screen.findByText("全部 3 站完成之后才能申请转生。")).toBeTruthy();
    expect(screen.getByText("第 2 / 3 站")).toBeTruthy();
    expect(screen.getByText("寒冰狱 · 杜阿特")).toBeTruthy();
    expect(screen.getByText("2026-09-14 — 2038-09-14")).toBeTruthy();
    // The block replaces the one-line reason; it does not repeat it.
    expect(screen.queryByTestId("eligibility-reason")).toBeNull();
    fireEvent.press(screen.getByTestId("sentence-blocked-link"));
    expect(mockNavigate).toHaveBeenCalledWith("Sentence", {});
  });

  it("another refusal keeps its one-line reason and no block", async () => {
    stubApi({ "/me/rebirth-applications/": { status: 200, data: { can_apply: false, reason: "cooldown", cooldown_until: null, results: [] } } });
    wrap(<ApplicationsScreen />);
    await screen.findByTestId("eligibility-reason");
    expect(screen.queryByTestId("sentence-blocked")).toBeNull();
  });
});

describe("a sentence push (1d)", () => {
  it("landingOf tells the four kinds apart and keeps only well-formed station ids", () => {
    expect(landingOf({ screen: "Life", kind: "sentence_amended", node_ids: [ID(3), "../x", 4] })).toEqual({
      screen: "Sentence",
      landing: { kind: "sentence_amended", nodeIds: [ID(3)] },
    });
    expect(landingOf({ screen: "Life", kind: "sentence_completed" })).toEqual({
      screen: "Sentence",
      landing: { kind: "sentence_completed", nodeIds: [] },
    });
    expect(landingOf({ screen: "Life", kind: "disposition_executed" })).toEqual({ screen: "Life" });
  });

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
  let taps = 0;
  const tap = (data: unknown) =>
    act(() => {
      for (const listener of system.responseListeners) listener({ notification: { request: { identifier: `sentence-${++taps}`, content: { data } } } });
    });

  beforeEach(async () => {
    mockUseReal.current = true;
    secure.clear();
    secure.set(REFRESH_TOKEN_KEY, "R");
    await AsyncStorage.clear();
  });

  it("completion lands on the life page's section, highlighted, and the highlight is gone once the page is left", async () => {
    stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "/me/past-lives/": { status: 200, data: [] },
      "/me/sentence-plan/": { status: 200, data: PLANS.completed },
      "/me/rebirth-applications/": { status: 200, data: { can_apply: true, reason: null, cooldown_until: null, results: [] } },
      "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    expect(screen.queryByTestId("sentence-landing-tag")).toBeNull();
    tap({ screen: "Life", kind: "sentence_completed" });
    await screen.findByTestId("sentence-landing-tag");
    expect(StyleSheet.flatten(screen.getByTestId("sentence-landing-rule").props.style)).toMatchObject({ width: 3 });
    expect(await screen.findByTestId("station-3-new")).toBeTruthy();
    expect(screen.getByTestId("sentence-apply")).toBeTruthy();
    // Leave (to the applications tab) and come back by the tab bar — which keeps a tab's params,
    // so only the page's own forgetting can clear it: seen once, gone, nothing stored.
    await pressTab("tab-Applications");
    await screen.findByTestId("eligibility");
    await pressTab("tab-Life");
    await waitFor(() => expect(screen.queryByTestId("sentence-landing-tag")).toBeNull());
    expect(screen.queryByTestId("station-3-new")).toBeNull();
  });

  it("the other kinds open the full list with the named station marked", async () => {
    stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "/me/sentence-plan/": { status: 200, data: PLANS.waiting },
      "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    tap({ screen: "Life", kind: "sentence_waiting", node_ids: [ID(2)] });
    await screen.findByTestId("sentence-screen-waiting");
    expect(navigationRef.getCurrentRoute()?.name).toBe("Sentence");
    expect(await screen.findByTestId("station-2-new")).toBeTruthy();
    expect(screen.queryByTestId("station-3-new")).toBeNull();
  });

  it("a reduction-only amendment (no node_ids) opens the full list with no 「新」 at all", async () => {
    stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "/me/sentence-plan/": { status: 200, data: PLANS.serving },
      "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    tap({ screen: "Life", kind: "sentence_amended", node_ids: [] });
    await screen.findByTestId("sentence-screen-serving");
    expect(navigationRef.getCurrentRoute()).toMatchObject({ name: "Sentence", params: { landing: { kind: "sentence_amended", nodeIds: [] } } });
    expect(screen.getAllByTestId(/^station-\d+$/)).toHaveLength(3);
    expect(screen.queryAllByTestId(/-new$/)).toEqual([]);
  });

  it.each([
    [false, true],
    [true, false],
  ])("completion scrolls the section into view (reduce-motion %s → animated %s), once", async (reduced, animated) => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
    const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
    stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "/me/past-lives/": { status: 200, data: [] },
      "/me/sentence-plan/": { status: 200, data: PLANS.completed },
      "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    const section = await screen.findByTestId("section-sentence");
    // The block holding the life sections (FadeIn) sits 400 down the page; the section 120 into it.
    let block = section.parent;
    while (block && !(block.props.onLayout && block.props.testID !== "section-sentence")) block = block.parent;
    fireEvent(block!, "layout", { nativeEvent: { layout: { x: 0, y: 400, width: 390, height: 900 } } });
    fireEvent(section, "layout", { nativeEvent: { layout: { x: 0, y: 120, width: 390, height: 200 } } });
    expect(scrollTo).not.toHaveBeenCalled(); // opened by hand: no scroll
    tap({ screen: "Life", kind: "sentence_completed" });
    await screen.findByTestId("sentence-landing-tag");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 520, animated }));
    // A later layout pass (the highlight re-lays the section) does not scroll again.
    fireEvent(screen.getByTestId("section-sentence"), "layout", { nativeEvent: { layout: { x: 0, y: 130, width: 390, height: 220 } } });
    await act(async () => {});
    expect(scrollTo).toHaveBeenCalledTimes(1);
    scrollTo.mockRestore();
  });
});
