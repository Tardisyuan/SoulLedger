/**
 * v3 (round 7) 本世: the identity band that compacts on scroll, the numbered ledger rows that
 * grow open, and reduce motion. At 1× text — jest's default window reports fontScale 2, which
 * is the large-text layout (the band never compacts there; the last test pins that).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { AccessibilityInfo, ScrollView, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { LIFE_OPEN_PREFIX } from "../screens/life";
import { SessionProvider } from "../session";
import { motion, v3, v3Band } from "../theme";
import { PROFILE, life, stubApi } from "./stubApi";

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const ORDER = ["records", "judgments", "dispositions", "applications", "sentence", "past_lives"];

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

async function open() {
  stubApi({
    "/me/": { status: 200, data: PROFILE },
    "/me/life/": { status: 200, data: life(1) },
    "/me/past-lives/": { status: 200, data: [] },
    "/me/sentence-plan/": { status: 200, data: { state: "none", rebirth_open: true, stations: [] } },
  });
  renderApp();
  await screen.findByTestId("section-records-body");
  await act(async () => {});
}

const scrollTo = (y: number) =>
  fireEvent.scroll(screen.UNSAFE_getByType(ScrollView), {
    nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 390, height: 3000 }, layoutMeasurement: { width: 390, height: 700 } },
  });

beforeEach(async () => {
  installMobilePlatform();
  Object.assign(mockWindow, { fontScale: 1 });
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  secure.clear();
  secure.set(REFRESH_TOKEN_KEY, "R");
  await AsyncStorage.clear();
  persistentStore.remove(`${LIFE_OPEN_PREFIX}${PROFILE.soul_code}`);
});
afterEach(() => jest.restoreAllMocks());

describe("the identity band", () => {
  it("full at the top; one compact row past 68pt; open again only back near the top", async () => {
    await open();
    expect(screen.getByTestId("identity-meta").props.children).toBe("中国 · 第 2 世 · 第五殿");
    expect(flat(screen.getByTestId("plaque-seal")).width).toBe(52);
    expect(flat(screen.getByTestId("identity")).height).toBe(116);
    // The civilization's colour (darkened 10%, as v3 mixes it) is the band's; the page under it is neutral.
    expect(flat(screen.getByTestId("plaque")).backgroundColor).toBe(v3Band(v3.civ.cn.light));
    expect(flat(screen.getByTestId("life")).backgroundColor).toBe(v3.light.canvas);
    scrollTo(60);
    expect(screen.getByTestId("identity-meta")).toBeTruthy();
    scrollTo(100);
    expect(screen.queryByTestId("identity-meta")).toBeNull();
    expect(flat(screen.getByTestId("plaque-seal")).width).toBe(28);
    // Still the name, the code to copy and the way to settings, in the one row.
    expect(screen.getByTestId("soul-name").props.children).toBe(PROFILE.name);
    expect(screen.getByTestId("copy-soul-code")).toBeTruthy();
    expect(screen.getByTestId("header-account")).toBeTruthy();
    // The height moves rather than jumps: right after the switch it is still on its way to 48.
    expect(flat(screen.getByTestId("identity")).height).not.toBe(48);
    await act(async () => {
      await new Promise((r) => setTimeout(r, motion.bandCompact + 200));
    });
    expect(flat(screen.getByTestId("identity")).height).toBe(48);
    scrollTo(40); // between the two thresholds: stays compact (no flicker on one line)
    expect(screen.queryByTestId("identity-meta")).toBeNull();
    scrollTo(10);
    expect(screen.getByTestId("identity-meta")).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, motion.bandCompact + 200));
    });
    expect(flat(screen.getByTestId("identity")).height).toBe(116);
  });

  it("at large text (≥ 1.7×) it never compacts and takes the height its words need", async () => {
    Object.assign(mockWindow, { fontScale: 2 });
    await open();
    expect(flat(screen.getByTestId("identity")).height).toBeUndefined();
    scrollTo(300);
    expect(screen.getByTestId("identity-meta")).toBeTruthy();
    expect(flat(screen.getByTestId("plaque-seal")).width).toBe(52);
  });
});

describe("the ledger rows", () => {
  it("01–06, ＋ turned 45° when open, the body on the canvas behind a 3pt ink rule, growing in", async () => {
    await open();
    expect(ORDER.map((k) => screen.getByTestId(`section-${k}-index`).props.children)).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(screen.getByTestId("ledger-head")).toBeTruthy();
    expect(flat(screen.getByTestId("section-records-plus")).transform).toEqual([{ rotate: "45deg" }]);
    expect(flat(screen.getByTestId("section-judgments-plus")).transform).toBeUndefined();
    expect(flat(screen.getByTestId("section-records-body"))).toMatchObject({ borderLeftWidth: 3, borderLeftColor: v3.light.ink, backgroundColor: v3.light.canvas });
    // Rows are 60pt, never under the 44pt target.
    expect(flat(screen.getByTestId("section-records-toggle")).minHeight).toBe(60);
    // Arrived open: it just is. Opened by hand: it grows from 0 with its opacity, then lets go.
    expect(screen.queryByTestId("grow")).toBeNull();
    fireEvent.press(screen.getByTestId("section-judgments-toggle"));
    expect(flat(screen.getByTestId("grow"))).toMatchObject({ height: 0, opacity: 0, overflow: "hidden" });
    fireEvent(screen.getByTestId("section-judgments-body").parent!, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 120 } } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, motion.sectionGrow + 200));
    });
    expect(screen.queryByTestId("grow")).toBeNull();
    expect(screen.getByTestId("section-judgments-body")).toBeTruthy();
  });
});

describe("reduce motion", () => {
  it("the band compacts at once and a row opens at once — nothing grows", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await open();
    fireEvent.press(screen.getByTestId("section-judgments-toggle"));
    expect(screen.queryByTestId("grow")).toBeNull();
    expect(screen.getByTestId("section-judgments-body")).toBeTruthy();
    scrollTo(100);
    expect(flat(screen.getByTestId("identity")).height).toBe(48);
  });
});
