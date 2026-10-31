/**
 * Design 第六十二批:本世页的进度卡 —— 勾魂牒、已超度、冥河渡口、地狱前庭、四十二条否定告白。
 * 每种卡既断言出现,也断言字段为 null(或状态不适用)时缺席;顺序固定;推送「已超度」只滚不洗。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { AccessibilityInfo, ScrollView, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { landOn, landingOf } from "../push";
import { LIFE_OPEN_PREFIX } from "../screens/life";
import { ferryWait } from "../screens/lifeProgress";
import { SessionProvider } from "../session";
import { motion } from "../theme";
import { PROFILE, life, resetLoginMemory, stubApi } from "./stubApi";

const mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const J = "22222222-2222-4222-8222-222222222222";
const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const shifted = (years: number, days = 0) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  d.setDate(d.getDate() + days);
  return iso(d);
};
const zhDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return `${y}年 · ${m}月${d}日`;
};

function wangsiRow(over: Record<string, unknown> = {}) {
  return {
    judgment_id: J,
    case_number: "CN-2026-0011",
    held_until: null,
    held: false,
    wrongful_death_cause: "",
    grievance_level: "MAJOR",
    grievance_status: "DELIVERED",
    grievance_plea: "冤",
    grievance_note: "",
    grievance_decided_at: "2026-10-28T12:00:00Z",
    can_file: false,
    refusal_code: "not_in_wangsi",
    ...over,
  };
}
const judgment = { id: J, court: "第五殿", judge: null, verdict: null, is_final: false };

async function openAs(profile: Record<string, unknown>, extra: Record<string, unknown> = {}, lifeData: unknown = life(1)) {
  stubApi({
    "/me/": { status: 200, data: { ...PROFILE, welcomed_civilizations: ["CHINESE", "GREEK", "EUROPEAN", "EGYPTIAN"], ...profile } },
    "/me/life/": { status: 200, data: lifeData },
    "/me/past-lives/": { status: 200, data: [] },
    "/me/sentence-plan/": { status: 200, data: { state: "none", rebirth_open: true, stations: [] } },
    ...(extra as Record<string, never>),
  });
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
  await screen.findByTestId("section-records-body");
  await act(async () => new Promise((r) => setTimeout(r, motion.bandCompact + 200)));
}

/** Host nodes carrying one of `ids`, in document order. */
function order(ids: string[]): string[] {
  return screen.UNSAFE_root.findAll((n) => typeof n.type === "string" && ids.includes(n.props.testID as string)).map((n) => n.props.testID as string);
}

const CARDS = ["life-capture", "life-delivered", "life-stations", "life-ferry", "life-vestibule", "life-confession"];

beforeEach(async () => {
  installMobilePlatform();
  resetLoginMemory();
  Object.assign(mockWindow, { width: 393 });
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  secure.clear();
  secure.set(REFRESH_TOKEN_KEY, "R");
  await AsyncStorage.clear();
  // The folded / opened rows are remembered per soul; a test that opens 审判 must not leave it open for the next.
  persistentStore.remove(`${LIFE_OPEN_PREFIX}${PROFILE.soul_code}`);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("ferryWait (第 4 节:整年往下取整,不满一年写天数,当天可渡)", () => {
  const today = new Date(2026, 9, 29);
  it("whole calendar years, rounded down", () => {
    expect(ferryWait("2045-06-01", today)).toMatchObject({ years: 18 });
    expect(ferryWait("2045-10-29", today)).toMatchObject({ years: 19 });
    expect(ferryWait("2045-10-28", today)).toMatchObject({ years: 18 });
    expect(ferryWait("2125-10-30", today)).toMatchObject({ years: 99 });
  });
  it("under a year: days, never months; the day itself and after: nothing left", () => {
    expect(ferryWait("2027-02-26", today)).toEqual(expect.objectContaining({ years: 0, days: 120 }));
    expect(ferryWait("2026-10-30", today)).toEqual(expect.objectContaining({ years: 0, days: 1 }));
    expect(ferryWait("2026-10-29", today)).toEqual(expect.objectContaining({ years: 0, days: 0, waited: 1 }));
    expect(ferryWait("1990-01-01", today)).toEqual(expect.objectContaining({ years: 0, days: 0, waited: 1 }));
  });
  it("the hundred-year line: the share already waited", () => {
    expect(ferryWait("2126-10-29", today).waited).toBeCloseTo(0, 2);
    expect(ferryWait("2076-10-29", today).waited).toBeCloseTo(0.5, 2);
  });
});

describe("an ordinary soul", () => {
  it("every progress field null: none of the five cards", async () => {
    await openAs({ capture_warrant: null, greek_ferry: null, european_vestibule: null, negative_confession: null, wangsi_delivered_at: null });
    expect(order(CARDS)).toEqual([]);
  });
});

describe("勾魂牒", () => {
  it("ISSUED: 拘到 is the step under way; the status and the day it was issued", async () => {
    await openAs({ capture_warrant: { status: "ISSUED", issued_at: "2026-10-27T12:00:00Z" } });
    const steps = within(screen.getByTestId("life-capture-steps"));
    expect(steps.getByText("■ 发牒")).toBeTruthy();
    expect(steps.getByText("→ ▪ 拘到")).toBeTruthy();
    expect(steps.getByText("→ □ 交城隍")).toBeTruthy();
    expect(screen.getByTestId("life-capture-status")).toHaveTextContent("阳寿已到，鬼差已经出发。");
    expect(screen.getByTestId("life-capture-date")).toHaveTextContent("发牒 · 2026年 · 10月27日");
    expect(screen.getByTestId("life-capture")).not.toHaveTextContent("ISSUED");
  });

  it("CAPTURED: two steps past, 交城隍 under way", async () => {
    await openAs({ capture_warrant: { status: "CAPTURED", issued_at: "2026-10-27T12:00:00Z" } });
    const steps = within(screen.getByTestId("life-capture-steps"));
    expect(steps.getByText("→ ■ 拘到")).toBeTruthy();
    expect(steps.getByText("→ ▪ 交城隍")).toBeTruthy();
    expect(screen.getByTestId("life-capture-status")).toHaveTextContent("鬼差已经拘到你，正送往城隍。");
  });

  it("HANDED_OVER, still with the City God: no step row (第六十四批), the sentence and the issued day", async () => {
    await openAs({ capture_warrant: { status: "HANDED_OVER", issued_at: "2026-10-27T12:00:00Z" } });
    expect(screen.queryByTestId("life-capture-steps")).toBeNull();
    expect(screen.getByTestId("life-capture-status")).toHaveTextContent("鬼差已把你交给城隍。");
    expect(screen.getByTestId("life-capture-date")).toHaveTextContent("发牒 · 2026年 · 10月27日");
    expect(screen.getByTestId("life-capture")).not.toHaveTextContent("HANDED_OVER");
    expect(screen.queryByTestId("life-capture-line")).toBeNull();
  });

  it("HANDED_OVER, on the road (a station card): the card folds into one data row", async () => {
    await openAs({ capture_warrant: { status: "HANDED_OVER", issued_at: "2026-10-27T12:00:00Z" }, diyu_station: "TUDI_TEMPLE" });
    expect(screen.getByTestId("life-stations")).toBeTruthy();
    expect(screen.queryByTestId("life-capture")).toBeNull();
    expect(screen.getByTestId("life-capture-line")).toHaveTextContent("勾魂牒 · 交城隍 · 2026年 · 10月27日");
  });

  it("HANDED_OVER, a wangsi case on the page: folded too", async () => {
    await openAs(
      { capture_warrant: { status: "HANDED_OVER", issued_at: "2026-10-27T12:00:00Z" } },
      { "/me/wangsi/": { status: 200, data: [wangsiRow({ grievance_status: "UPHELD" })] } },
    );
    expect(await screen.findByTestId("life-capture-line")).toBeTruthy();
    expect(screen.queryByTestId("life-capture")).toBeNull();
  });

  it("an open warrant keeps its card even with a station card on the page", async () => {
    await openAs({ capture_warrant: { status: "CAPTURED", issued_at: "2026-10-27T12:00:00Z" }, diyu_station: "TUDI_TEMPLE" });
    expect(screen.getByTestId("life-capture-steps")).toBeTruthy();
    expect(screen.queryByTestId("life-capture-line")).toBeNull();
  });

  it("a status it does not know draws nothing (no raw member on the page)", async () => {
    await openAs({ capture_warrant: { status: "CANCELLED", issued_at: "2026-10-27T12:00:00Z" } });
    expect(screen.queryByTestId("life-capture")).toBeNull();
  });
});

describe("冥河渡口", () => {
  const greek = (ferry: unknown) => ({ civilization: "GREEK", home_civilization: "GREEK", greek_ferry: ferry, diyu_station: "" });

  it("UNBURIED, years ahead: 「还要等 N 年」, a line with no number, the exact day below", async () => {
    const on = shifted(18, 5);
    await openAs(greek({ ferry_passage: "UNBURIED", crossed: false, crosses_on: on }));
    expect(screen.getByTestId("life-ferry-body")).toHaveTextContent("你还没有得到安葬，卡戎不渡。在岸边满一百年，就可以渡河。");
    expect(screen.getByTestId("life-ferry-wait")).toHaveTextContent("还要等 18 年");
    expect(screen.getByTestId("life-ferry-date")).toHaveTextContent(`可渡之日 · ${zhDay(on)}`);
    // The line is drawn and spoken, never printed: no digits on it.
    const line = screen.getByTestId("life-ferry-line");
    // Waited + still to wait = a hundred (each rounded down on its own gave 18 + 81 on the phone, 2026-10-30).
    expect(line.props.accessibilityLabel).toBe("已在岸边等了 82 年，共 100 年");
    expect(within(line).queryByText(/\d/)).toBeNull();
  });

  it("under a year: days; on the day: 「已满百年，可以渡河」", async () => {
    await openAs(greek({ ferry_passage: "UNBURIED", crossed: false, crosses_on: shifted(0, 120) }));
    expect(screen.getByTestId("life-ferry-wait")).toHaveTextContent("还要等 120 天");
    expect(screen.getByTestId("life-ferry-wait")).not.toHaveTextContent(/月/);
  });

  it("the day itself", async () => {
    await openAs(greek({ ferry_passage: "UNBURIED", crossed: false, crosses_on: shifted(0) }));
    expect(screen.getByTestId("life-ferry-wait")).toHaveTextContent("已满百年，可以渡河");
  });

  it("NO_FARE: no day, so no line and no number — only how to cross", async () => {
    await openAs(greek({ ferry_passage: "NO_FARE", crossed: false, crosses_on: null }));
    expect(screen.getByTestId("life-ferry-body")).toHaveTextContent("你没有渡资，卡戎不渡。");
    expect(screen.getByTestId("life-ferry-date")).toHaveTextContent("没有可渡之日：记录改为「已付渡资」后才能渡河。");
    expect(screen.queryByTestId("life-ferry-line")).toBeNull();
    expect(screen.queryByTestId("life-ferry-wait")).toBeNull();
  });

  it("crossed: the card is gone", async () => {
    await openAs(greek({ ferry_passage: "UNBURIED", crossed: true, crosses_on: "1900-01-01" }));
    expect(screen.queryByTestId("life-ferry")).toBeNull();
  });
});

describe("地狱前庭", () => {
  it("a sentence and the day it entered — no steps, line, countdown or number in the corner", async () => {
    await openAs({ civilization: "EUROPEAN", home_civilization: "EUROPEAN", european_vestibule: { entered_at: "2026-04-08T12:00:00Z" } });
    expect(screen.getByTestId("life-vestibule-body")).toHaveTextContent("你留在地狱前庭，不进九圈。这里是归处，没有下一站。");
    expect(screen.getByTestId("life-vestibule-date")).toHaveTextContent("进入 · 2026年 · 4月8日");
    expect(screen.queryByTestId("life-vestibule-count")).toBeNull();
    expect(within(screen.getByTestId("life-vestibule")).queryByText(/[■▪□]/)).toBeNull();
  });
});

describe("四十二条否定告白", () => {
  const egypt = (tally: unknown) => ({ civilization: "EGYPTIAN", home_civilization: "EGYPTIAN", negative_confession: tally, diyu_station: "" });

  it("42 cells — true, then false, then unrecorded — one label for the strip, a count row and the sentence", async () => {
    await openAs(egypt({ truthful: 26, untruthful: 3, unheard: 13, total: 42 }));
    const strip = screen.getByTestId("life-confession-strip");
    const kinds = within(strip).getAllByTestId(/^confession-cell-/).map((c) => c.props.testID);
    expect(kinds).toHaveLength(42);
    expect(kinds).toEqual([...Array(26).fill("confession-cell-truthful"), ...Array(3).fill("confession-cell-untruthful"), ...Array(13).fill("confession-cell-unheard")]);
    expect(strip.props.accessibilityLabel).toBe("如实 26，不实 3，未记 13，共 42 条");
    expect(screen.getByTestId("life-confession-count")).toHaveTextContent("29 / 42");
    expect(screen.getByTestId("life-confession-truthful")).toHaveTextContent("如实 26");
    expect(screen.getByTestId("life-confession-untruthful")).toHaveTextContent("不实 3");
    expect(screen.getByTestId("life-confession-unheard")).toHaveTextContent("未记 13");
    expect(screen.getByTestId("life-confession-truthful").props.numberOfLines).toBe(1);
    expect(screen.getByTestId("life-confession-status")).toHaveTextContent("已记 29 / 42 条，其余还没有记。");
    // 不实 is a stripe, never red.
    expect(JSON.stringify(screen.getByTestId("life-confession").props.style)).not.toMatch(/#[cC]|red/);
  });

  it("all recorded; under 360pt the count row keeps only the swatches and the numbers", async () => {
    Object.assign(mockWindow, { width: 340 });
    await openAs(egypt({ truthful: 40, untruthful: 2, unheard: 0, total: 42 }));
    expect(screen.getByTestId("life-confession-status")).toHaveTextContent("42 条都已记下。");
    expect(screen.getByTestId("life-confession-truthful")).toHaveTextContent(/^40$/);
    expect(screen.getByTestId("life-confession-untruthful")).not.toHaveTextContent("不实");
  });

  it("sits right above the judgments row, below the records", async () => {
    await openAs(egypt({ truthful: 1, untruthful: 1, unheard: 40, total: 42 }));
    expect(order(["section-records", "life-confession", "section-judgments"])).toEqual(["section-records", "life-confession", "section-judgments"]);
  });

  it("null: no card", async () => {
    await openAs(egypt(null));
    expect(screen.queryByTestId("life-confession")).toBeNull();
  });
});

describe("已超度", () => {
  it("one status row with the day, when the 枉死城 line does not say it", async () => {
    await openAs({ wangsi_delivered_at: "2026-10-28T12:00:00Z" }, { "/me/wangsi/": { status: 200, data: [] } });
    expect(screen.getByTestId("life-delivered")).toHaveTextContent(/已超度/);
    expect(screen.getByTestId("life-delivered-date")).toHaveTextContent("2026年 · 10月28日");
    expect(screen.getByTestId("life-delivered").props.accessibilityLabel).toBe("已超度 · 2026年 · 10月28日 · 申诉属实 · 已超度，往莲花台");
  });

  it("the 枉死城 line of this life's case already says it: the day joins that line, and no second row", async () => {
    await openAs(
      { wangsi_delivered_at: "2026-10-28T12:00:00Z" },
      { "/me/wangsi/": { status: 200, data: [wangsiRow()] } },
      life(1, { judgments: [judgment] })
    );
    fireEvent.press(screen.getByTestId("section-judgments-toggle"));
    expect(screen.queryByTestId("life-delivered")).toBeNull();
    expect(screen.getByTestId(`wangsi-status-${J}`).props.children).toBe("申诉属实 · 已超度，往莲花台 · 2026年 · 10月28日");
  });

  it("an undelivered 枉死城 line carries no date; no delivery, no row", async () => {
    await openAs(
      { wangsi_delivered_at: null },
      { "/me/wangsi/": { status: 200, data: [wangsiRow({ grievance_status: "UPHELD" })] } },
      life(1, { judgments: [judgment] })
    );
    fireEvent.press(screen.getByTestId("section-judgments-toggle"));
    expect(screen.queryByTestId("life-delivered")).toBeNull();
    expect(screen.getByTestId(`wangsi-status-${J}`).props.children).toBe("申诉属实 · 已提前释放");
  });
});

describe("the fixed order (第 5 节)", () => {
  it("勾魂牒 → 已超度 → 十三站 → 冥河 → 前庭, under the five stages; 四十二条 later, above the judgments", async () => {
    await openAs({
      capture_warrant: { status: "ISSUED", issued_at: "2026-10-27T12:00:00Z" },
      wangsi_delivered_at: "2026-10-28T12:00:00Z",
      diyu_station: "WANGXIANG_TERRACE",
      greek_ferry: { ferry_passage: "NO_FARE", crossed: false, crosses_on: null },
      european_vestibule: { entered_at: "2026-04-08T12:00:00Z" },
      negative_confession: { truthful: 1, untruthful: 0, unheard: 41, total: 42 },
    });
    expect(order(["life-now", ...CARDS, "section-judgments"])).toEqual(["life-now", ...CARDS, "section-judgments"]);
  });
});

describe("推送落点", () => {
  it("「超度」 lands on 已超度; the other three wangsi kinds still land on the judgment", () => {
    expect(landingOf({ screen: "Life", judgment_id: J, kind: "wangsi_delivered" })).toEqual({ screen: "Life", focus: { delivered: true } });
    for (const kind of ["wangsi_upheld", "wangsi_upheld_late", "wangsi_rejected"])
      expect(landingOf({ screen: "Life", judgment_id: J, kind })).toEqual({ screen: "Life", focus: { judgment: J } });
  });

  // Fake timers from the landing on: "scrolled once, no wash" after a real-time sleep said nothing under load — the
  // sleep could end before a scheduled scroll or wash ran. The 50 ms below are on the fake clock: every timer the
  // landing set that is due by then has run. (Booting the app stays on real timers; under fake ones it never settles.)
  async function land(reduced: boolean, lifeData: unknown, wangsi: unknown[]) {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
    const inner = {};
    jest.spyOn(ScrollView.prototype, "getInnerViewRef" as never).mockReturnValue(inner as never);
    const scroll = jest.spyOn(ScrollView.prototype, "scrollTo" as never);
    const measured: unknown[] = [];
    jest.spyOn(View.prototype as never, "measureLayout" as never).mockImplementation(function (this: { props: { testID?: string } }, rel: unknown, ok: (x: number, y: number) => void) {
      measured.push([this.props.testID, rel]);
      ok(0, 640);
    } as never);
    await openAs({ wangsi_delivered_at: "2026-10-28T12:00:00Z" }, { "/me/wangsi/": { status: 200, data: wangsi } }, lifeData);
    jest.useFakeTimers();
    await act(async () => landOn(navigationRef.navigate as never, landingOf({ screen: "Life", judgment_id: J, kind: "wangsi_delivered" })!));
    await act(() => jest.advanceTimersByTimeAsync(50));
    return { scroll, measured, inner };
  }

  it("scrolls to the 已超度 row once, smoothly; no wash anywhere", async () => {
    const { scroll, measured, inner } = await land(false, life(1, { judgments: [judgment] }), []);
    expect(measured).toEqual([["life-delivered", inner]]);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ y: 624, animated: true });
    expect(screen.queryByTestId("landing-wash")).toBeNull();
  });

  it("merged into the 枉死城 line: scrolls there instead (the judgments row opens); reduce motion: no smooth scroll", async () => {
    const { scroll, measured } = await land(true, life(1, { judgments: [judgment] }), [wangsiRow()]);
    expect(screen.queryByTestId("life-delivered")).toBeNull();
    expect(measured.map((m) => (m as unknown[])[0])).toEqual([`wangsi-line-${J}`]);
    expect(scroll).toHaveBeenCalledWith({ y: 624, animated: false });
    expect(screen.queryByTestId("landing-wash")).toBeNull();
  });
});
