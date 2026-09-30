/**
 * v2「朱印」第三阶段 · App 第一批:本世页样板,以及铺开到其余屏幕的共用部件 ——
 * 底部抽屉的下拉阈值、可折叠节、状态徽章、间距刻度。
 */
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import type { ReactNode } from "react";
import { AccessibilityInfo, StyleSheet, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Sheet, SHEET_CLOSE_DRAG_PT, SHEET_CLOSE_SPEED_PT_PER_MS, sheetReleaseCloses, useSheetGestures } from "../feedback";
import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { defaultLifeSection, lifePathIndex, lifeSectionsOpen, signedBalance, termServed } from "../rules";
import { LIFE_OPEN_PREFIX } from "../screens/life";
import { SessionProvider } from "../session";
import { GUTTER_PT, space, themeFor } from "../theme";
import { SectionError, Skeleton, ThemeContext, sectionTransitions } from "../ui";
import { PROFILE, life, stubApi } from "./stubApi";

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;


function wrap(children: ReactNode, civilization: string | null = "CHINESE") {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ThemeContext.Provider value={themeFor(civilization, "light")}>
          <NavigationContainer>{children}</NavigationContainer>
        </ThemeContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  installMobilePlatform();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

describe("the bottom sheet's release (交互与动效 第 2 轮 原型 06)", () => {
  it("closes past 90pt down, or faster than 0.6pt/ms; otherwise springs back", () => {
    expect([SHEET_CLOSE_DRAG_PT, SHEET_CLOSE_SPEED_PT_PER_MS]).toEqual([90, 0.6]);
    // Distance alone (velocity is Gesture Handler's pt per second).
    expect(sheetReleaseCloses(91, 0)).toBe(true);
    expect(sheetReleaseCloses(90, 0)).toBe(false);
    expect(sheetReleaseCloses(40, 0)).toBe(false);
    // Speed alone: 0.61pt/ms = 610pt/s.
    expect(sheetReleaseCloses(10, 610)).toBe(true);
    expect(sheetReleaseCloses(10, 600)).toBe(false);
    // A fling upward never closes, however hard.
    expect(sheetReleaseCloses(-30, -2000)).toBe(false);
  });

  it("the sheet hands the library that release, not its snap-point projection", async () => {
    wrap(
      <Sheet open onClose={jest.fn()} edge="#000" closeLabel="关闭">
        <Text>内容</Text>
      </Sheet>
    );
    await act(async () => {});
    expect(screen.UNSAFE_getByType(BottomSheetModal).props.gestureEventsHandlersHook).toBe(useSheetGestures);
    expect(screen.getByText("内容")).toBeTruthy();
  });
});

describe("the life page's rules (补足 B11)", () => {
  it("one section opens by default: 受刑 while under sentence, else 功过记录 — and before the plan is known, 功过记录", () => {
    for (const state of ["serving", "between", "waiting", "eternal"]) expect(defaultLifeSection(state)).toBe("sentence");
    for (const state of ["none", "completed", "pardoned", undefined, null]) expect(defaultLifeSection(state)).toBe("records");
    const open = lifeSectionsOpen({}, "serving");
    expect(Object.entries(open).filter(([, v]) => v).map(([k]) => k)).toEqual(["sentence"]);
  });

  it("a section the soul opened or closed by hand wins over the default", () => {
    expect(lifeSectionsOpen({ sentence: false, judgments: true }, "serving")).toMatchObject({ sentence: false, judgments: true, records: false });
    expect(lifeSectionsOpen({ records: false }, "none").records).toBe(false);
  });

  it("the path: one stage per state, the sentence only once disposed with a plan; nothing for LOST / SETTLED / unknown", () => {
    expect(["ALIVE", "JUDGING"].map((s) => lifePathIndex(s, undefined))).toEqual([0, 1]);
    expect(lifePathIndex("DISPOSED", "none")).toBe(2);
    expect(lifePathIndex("DISPOSED", undefined)).toBe(2);
    expect(lifePathIndex("DISPOSED", "serving")).toBe(3);
    expect(lifePathIndex("REINCARNATING", "completed")).toBe(4);
    expect([lifePathIndex("LOST", "serving"), lifePathIndex("SETTLED", undefined), lifePathIndex("ASCENDED", undefined)]).toEqual([null, null, null]);
  });

  it("the balance: signed, with a real minus", () => {
    expect([signedBalance(410, 112), signedBalance(3, 15), signedBalance(7, 7)]).toEqual(["+298", "\u221212", "0"]);
  });

  it("the served share of a term, clamped; nothing without both dates", () => {
    const at = (d: string) => Date.parse(d);
    expect(termServed("2026-01-01", "2027-01-01", at("2026-07-02T12:00:00Z"))).toBeCloseTo(0.5, 2);
    expect(termServed("2026-01-01", "2027-01-01", at("2030-01-01"))).toBe(1);
    expect(termServed("2026-01-01", "2027-01-01", at("2020-01-01"))).toBe(0);
    expect([termServed(null, "2027-01-01", 0), termServed("2026-01-01", null, 0), termServed("2027-01-01", "2026-01-01", 0)]).toEqual([null, null, null]);
  });

  it("a section's body moves only with time to move in: reduce motion gives it none", () => {
    expect(sectionTransitions(0, 0)).toEqual({ entering: undefined, exiting: undefined });
    const moving = sectionTransitions(200, 120);
    expect(moving.entering).toBeDefined();
    expect(moving.exiting).toBeDefined();
  });
});

describe("the life page, as the app mounts it (补足 B11)", () => {
  const station = (n: number, status: string) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    n,
    status,
    is_home: true,
    civilization: "CHINESE",
    realm: { realm_code: `R${n}`, name_local: `R${n}`, name_zh: ["枉死城", "寒冰狱"][n - 1], name_en: `R${n}` },
    sentence_years: 3,
    is_eternal: false,
    started_on: "2026-01-01",
    ends_on: "2029-01-01",
  });
  const SERVING = { state: "serving", rebirth_open: true, stations: [station(1, "done"), station(2, "active")] };
  const NONE = { state: "none", rebirth_open: true, stations: [] };

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
  const expanded = (key: string) => screen.getByTestId(`section-${key}-toggle`).props.accessibilityState.expanded as boolean;
  const ORDER = ["records", "judgments", "dispositions", "applications", "sentence", "past_lives"];

  beforeEach(async () => {
    secure.clear();
    secure.set(REFRESH_TOKEN_KEY, "R");
    await AsyncStorage.clear();
    persistentStore.remove(`${LIFE_OPEN_PREFIX}${PROFILE.soul_code}`);
  });

  const routes = (plan: unknown, profile: Record<string, unknown> = {}) =>
    stubApi({
      "/me/": { status: 200, data: { ...PROFILE, ...profile } },
      "/me/life/": { status: 200, data: life(1) },
      "/me/past-lives/": { status: 200, data: [] },
      "/me/sentence-plan/": { status: 200, data: plan },
    });

  it("under sentence: 受刑 open and only it; the six in B11's order; the served share in warn", async () => {
    routes(SERVING, { current_state: "DISPOSED" });
    renderApp();
    await screen.findByTestId("sentence-served");
    const ids = screen.getAllByTestId(/^section-[a-z_]+-toggle$/).map((n) => (n.props.testID as string).slice(8, -7));
    expect(ids).toEqual(ORDER);
    expect(ORDER.filter(expanded)).toEqual(["sentence"]);
    const bar = flat(screen.getByTestId("sentence-served-bar"));
    expect([themeFor("CHINESE", "light").warn, themeFor("CHINESE", "dark").warn]).toContain(bar.backgroundColor);
    expect(bar.width).toMatch(/^\d+%$/);
    // The path stands at the sentence: three passed, one here, one ahead.
    expect(screen.getAllByTestId(/^path-.*-done$/)).toHaveLength(3);
    expect(screen.getByTestId("path-SENTENCE-here")).toBeTruthy();
    expect(screen.getByTestId("path-REINCARNATING-ahead")).toBeTruthy();
    // Walked segments are plain ink bars, never SVG (a percentage-width SVG line sat a pixel
    // low at the end of the walked run on some screens); the one ahead stays a dashed SVG line.
    for (const i of [0, 1, 2]) {
      const seg = screen.getByTestId(`path-seg-${i}`);
      expect([themeFor("CHINESE", "light").ink, themeFor("CHINESE", "dark").ink]).toContain(flat(seg).backgroundColor);
      expect(seg.props.children).toBeUndefined();
    }
    expect(screen.getByTestId("path-seg-3").props.children).toBeTruthy();
  });

  it("not under sentence: 功过记录 open and only it; the balance in ink, never a status colour", async () => {
    routes(NONE, { merit_score: 3, demerit_score: 15 });
    renderApp();
    await screen.findByTestId("section-records-body");
    await act(async () => {});
    expect(ORDER.filter(expanded)).toEqual(["records"]);
    const value = screen.getByTestId("balance-value");
    expect(value.props.children).toBe("\u221212");
    const scheme = flat(value).color === themeFor("CHINESE", "light").ink ? "light" : "dark";
    const t = themeFor("CHINESE", scheme);
    expect(flat(value).color).toBe(t.ink);
    expect([t.neg, t.pos, t.warn, t.plaque]).not.toContain(flat(value).color);
    expect(within(screen.getByTestId("score-merit")).getByText("3")).toBeTruthy();
    expect(within(screen.getByTestId("score-demerit")).getByText("15")).toBeTruthy();
  });

  it("what the soul opened or closed is remembered, across a remount", async () => {
    routes(NONE);
    const first = renderApp();
    await screen.findByTestId("section-records-body");
    await act(async () => {});
    fireEvent.press(screen.getByTestId("section-records-toggle"));
    fireEvent.press(screen.getByTestId("section-judgments-toggle"));
    expect([expanded("records"), expanded("judgments")]).toEqual([false, true]);
    first.unmount();
    routes(NONE);
    renderApp();
    await screen.findByTestId("section-judgments-body");
    await act(async () => {});
    expect(ORDER.filter(expanded)).toEqual(["judgments"]);
  });
});

describe("a part that failed, and one still loading (补足 C15)", () => {
  it("failed: ✕ and the words in 冷玫红 — the system failing is what neg is for — with a retry", () => {
    const retry = jest.fn();
    wrap(<SectionError testID="err" onRetry={retry} />);
    const t = themeFor("CHINESE", "light");
    expect(flat(screen.getByTestId("err")).color).toBe(t.neg);
    expect(flat(screen.getByText("✕")).color).toBe(t.neg);
    fireEvent.press(screen.getByText("重试"));
    expect(retry).toHaveBeenCalled();
  });

  it("loading: static s2 bars, no hairline grey and nothing animated", () => {
    wrap(<Skeleton testID="sk" lines={3} />);
    const bars = (screen.getByTestId("sk") as unknown as { children: { props: { style?: unknown } }[] }).children;
    expect(bars.map((b) => flat(b).backgroundColor)).toEqual(Array(3).fill(themeFor("CHINESE", "light").s2));
  });
});

/**
 * 补足 A2: every padding, margin and gap written as a number in the App is a step of the
 * scale (2 4 8 12 16 24 32 48), 0, or the screen gutter 20. Read from the source, so a
 * new odd value fails here, not by eye. Not covered: computed values (`gutter - 3`,
 * `14 + space[2]` — a border or an icon to line up with, named where it is written) and
 * negative ones (the focus ring's -4 reaches out past its own box).
 */
describe("spacing sits on the v2 scale (补足 A2)", () => {
  it("no literal padding / margin / gap off the scale anywhere under src/", () => {
    const fs = jest.requireActual<typeof import("fs")>("fs");
    const path = jest.requireActual<typeof import("path")>("path");
    const root = path.join(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__") walk(full);
        } else if (/\.tsx?$/.test(e.name)) files.push(full);
      }
    };
    walk(root);
    const allowed = new Set<number>([0, ...space, GUTTER_PT]);
    const off = files.flatMap((f) =>
      [...fs.readFileSync(f, "utf8").matchAll(/\b((?:padding|margin)(?:Horizontal|Vertical|Top|Bottom|Left|Right)?|gap|rowGap|columnGap): (\d+(?:\.\d+)?)\b(?!\s*[-+*/])/g)]
        .filter((m) => !allowed.has(Number(m[2])))
        .map((m) => `${path.relative(root, f)} ${m[1]}: ${m[2]}`)
    );
    expect(files.length).toBeGreaterThan(20);
    expect(off).toEqual([]);
  });
});
