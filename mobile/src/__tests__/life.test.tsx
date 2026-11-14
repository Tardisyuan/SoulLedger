/**
 * v3 (round 7) 本世: the identity band that compacts on scroll, the numbered ledger rows that
 * grow open, and reduce motion. At 1× text — jest's default window reports fontScale 2, which
 * is the large-text layout (the band never compacts there; the last test pins that).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import { act, fireEvent, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { AccessibilityInfo, ScrollView, StyleSheet } from "react-native";
import Svg, { Path, Stop } from "react-native-svg";

import { RootNavigator } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { LIFE_OPEN_PREFIX } from "../screens/life";
import { SessionProvider } from "../session";
import { ON_PLAQUE, motion, themeFor, v4 } from "../theme";
import { renderSoul } from "./harness";
import { PROFILE, life, stubApi, resetLoginMemory } from "./stubApi";

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const ORDER = ["records", "judgments", "dispositions", "applications", "sentence", "past_lives"];

function renderApp() {
  return renderSoul(
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}

async function open(data: unknown = life(1)) {
  stubApi({
    "/me/": { status: 200, data: PROFILE },
    "/me/life/": { status: 200, data },
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
  resetLoginMemory();
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
    // The name is the page's big title: the title serif, Noto Serif SC 600, at v4's 30 (13 compact).
    expect(flat(screen.getByTestId("soul-name"))).toMatchObject({ fontFamily: "NotoSerifSC_600", fontSize: 30, lineHeight: 38 });
    expect(flat(screen.getByTestId("plaque-seal")).width).toBe(64);
    expect(flat(screen.getByTestId("identity")).height).toBe(116);
    // v3's 64pt seal still fits the full band (it clips: overflow hidden): padding, meta line, gap, seal.
    const band = flat(screen.getByTestId("identity")) as Record<string, number>;
    const need = band.paddingTop + Number(flat(screen.getByTestId("identity-meta")).lineHeight) + band.gap + Number(flat(screen.getByTestId("plaque-seal")).height) + band.paddingBottom;
    expect(need).toBeLessThanOrEqual(band.height);
    // v4: no band — the header is the page's own ground; the civilization is its light (band-glow, below).
    expect(flat(screen.getByTestId("plaque")).backgroundColor).toBe(v4.light.main);
    expect(flat(screen.getByTestId("plaque")).backgroundColor).not.toBe(v4.civ.cn.sL);
    expect(flat(screen.getByTestId("life")).backgroundColor).toBe(v4.light.main);
    scrollTo(60);
    expect(screen.getByTestId("identity-meta")).toBeTruthy();
    scrollTo(100);
    expect(screen.queryByTestId("identity-meta")).toBeNull();
    expect(flat(screen.getByTestId("plaque-seal")).width).toBe(30);
    // Still the name, the code to copy and the way to settings, in the one row.
    expect(screen.getByTestId("soul-name").props.children).toBe(PROFILE.name);
    expect(flat(screen.getByTestId("soul-name"))).toMatchObject({ fontFamily: "NotoSerifSC_600", fontSize: 13 });
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
    expect(flat(screen.getByTestId("plaque-seal")).width).toBe(64);
  });

  it("at the largest text the code's target has no negative margin to push it past the clipped band, and the stacked tabs stay compact", async () => {
    Object.assign(mockWindow, { fontScale: 2.35 });
    await open();
    const code = flat(screen.getByTestId("copy-soul-code"));
    expect(code).toMatchObject({ minHeight: 44 });
    expect(code.marginVertical).toBeUndefined();
    expect(code.marginBottom).toBeUndefined();
    expect(flat(screen.getByTestId("tab-Life"))).toMatchObject({ minHeight: 48, flexDirection: "row" });
    expect(screen.getByTestId("tab-Life-label").props.maxFontSizeMultiplier).toBe(1.5);
  });

  it("at normal size the tab label keeps the app's text-size cap", async () => {
    await open();
    expect(screen.getByTestId("tab-Life-label").props.maxFontSizeMultiplier).toBe(2.35);
    await act(async () => {
      await new Promise((r) => setTimeout(r, motion.bandCompact + 200));
    });
  });
});

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true), getStringAsync: jest.fn(async () => "") }));

describe("the copy-the-soul-code target", () => {
  it("an ordinary copy keeps its own message, not the clears-in-60-s one", async () => {
    await open();
    fireEvent.press(screen.getByTestId("copy-soul-code"));
    expect((await screen.findByTestId("toast")).props.children).toBe("灵魂编号已复制");
    await act(async () => {
      await new Promise((r) => setTimeout(r, motion.bandCompact + 200));
    });
  });

  /** The target's own box: the code's line plus the padding around it (no `hitSlop`, which Android drops outside a parent). */
  const target = () => {
    const box = flat(screen.getByTestId("copy-soul-code")) as Record<string, number>;
    const line = Number(flat(screen.getByText("QU3 3Q9F W5F")).lineHeight);
    return { box, line, height: (box.paddingTop ?? box.paddingVertical) + line + (box.paddingBottom ?? box.paddingVertical) };
  };

  it("is at least 44 high, full and compact, and moves nothing (the margins take the padding back)", async () => {
    await open();
    for (const y of [0, 100]) {
      scrollTo(y);
      await act(async () => {
        await new Promise((r) => setTimeout(r, motion.bandCompact + 200));
      });
      const { box, height } = target();
      expect(height).toBeGreaterThanOrEqual(44);
      expect(screen.getByTestId("copy-soul-code").props.hitSlop).toBeUndefined();
      expect([box.marginTop ?? box.marginVertical, box.marginBottom ?? box.marginVertical]).toEqual([
        -(box.paddingTop ?? box.paddingVertical),
        -(box.paddingBottom ?? box.paddingVertical),
      ]);
    }
  });

  it("compact, the whole 44 is inside the 48pt band, which clips (overflow hidden) whatever reaches past it", async () => {
    await open();
    scrollTo(100);
    await act(async () => {
      await new Promise((r) => setTimeout(r, motion.bandCompact + 200));
    });
    const band = flat(screen.getByTestId("identity")) as Record<string, number>;
    expect([band.height, band.overflow]).toEqual([48, "hidden"]);
    const { box, line } = target();
    const name = Number(flat(screen.getByTestId("soul-name")).lineHeight);
    const gap = Number(flat(screen.getByTestId("band-text")).gap);
    // The row is the text column (taller than the 30pt seal), centred in the band.
    const column = name + gap + line;
    expect(column).toBeGreaterThan(Number(flat(screen.getByTestId("plaque-seal")).height));
    const codeTop = (band.height - column) / 2 + name + gap;
    expect(codeTop - box.paddingTop).toBeGreaterThanOrEqual(0);
    expect(codeTop + line + box.paddingBottom).toBeLessThanOrEqual(band.height);
  });
});

describe("v3 civilization marks on 本世", () => {
  /** The drawing's own props (the host view does not carry `opacity` through). */
  const svg = (testID: string) => screen.UNSAFE_getAllByType(Svg).find((el) => el.props.testID === testID)!;
  const settle = () => act(async () => new Promise((r) => setTimeout(r, motion.bandCompact + 200)));

  it("第四十六批: the header carries the paper texture in ink at 5% (light), solid over the top 40%, under v4's header light", async () => {
    await open();
    await settle();
    const ink = themeFor("CHINESE", "light").ink;
    const stops = (id: string) => svg(id).findAllByType(Stop).map((s) => [s.props.offset, s.props.stopOpacity, s.props.stopColor]);
    expect(stops("band-texture")).toEqual([
      [0, 0.05, ink],
      [0.4, 0.05, ink],
      [1, 0, ink],
    ]);
    // 地府's texture is the 稿纸 verticals, 24 apart.
    expect(svg("band-texture").findByType(Path).props.d).toMatch(/^M0\.5 0V\d+M24\.5 0V/);
    // .glowtop: the glow at v4's light-scheme 0.24, gone by 70% (jest reports light).
    expect(stops("band-glow")).toEqual([
      [0, 0.24, v4.civ.cn.glow],
      [0.7, 0, v4.civ.cn.glow],
    ]);
    // Never the civilization's colour, never the band's white: the civilization-coloured pattern is gone.
    expect(stops("band-texture").map((s) => s[2])).not.toContain(v4.civ.cn.glow);
    expect(stops("band-texture").map((s) => s[2])).not.toContain(ON_PLAQUE);
    expect(screen.UNSAFE_getAllByType(Svg).filter((el) => el.props.testID === "band-pattern")).toEqual([]);
  });

  it("第四十六批: the head mark is the hall's name, vertical, ink at 30%, hidden from screen readers, and only where it clears the text by 24", async () => {
    await open();
    await settle();
    // Ornament: not in the accessibility tree at all.
    expect(screen.queryByTestId("head-mark-cn")).toBeNull();
    const mark = () => screen.getByTestId("head-mark-cn", { includeHiddenElements: true });
    expect(mark().props.importantForAccessibility).toBe("no-hide-descendants");
    const glyphs = mark()
      .findAll((n) => String(n.type) === "Text")
      .map((n) => n.props.children);
    expect(glyphs).toEqual(["第", "五", "殿"]);
    const style = () => StyleSheet.flatten(mark().props.style) as Record<string, unknown>;
    // Right of the text, left of the account icon: 16 + 44 + 16.
    expect(style().right).toBe(76);
    // Laid out but not shown until measured.
    expect(style().opacity).toBe(0);
    await act(async () => {
      fireEvent(screen.getByTestId("identity-meta"), "textLayout", { nativeEvent: { lines: [{ width: 120 }] } });
      fireEvent(screen.getByTestId("band-text"), "layout", { nativeEvent: { layout: { x: 76, y: 0, width: 200, height: 58 } } });
      fireEvent(screen.getByTestId("name-row"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 90, height: 38 } } });
      mark().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 20, height: 69 } } });
    });
    // The name ends at 16 + 76 + 90 = 182; the mark starts at 390 − 76 − 20 = 294: clear by more than 24.
    expect(style().opacity).toBe(0.3);
    // A name that reaches within 24 of the mark: the mark is not drawn at all (第四十六批第三节).
    await act(async () => {
      fireEvent(screen.getByTestId("name-row"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 180, height: 38 } } });
    });
    expect(style().opacity).toBe(0);
  });

  it("「你现在在哪」 has the stage motif behind it, in the civilization's colour under 10%", async () => {
    await open();
    await settle();
    const motif = svg("stage-motif");
    expect(motif.props.opacity).toBeLessThan(0.1);
    expect(motif.props.opacity).toBeGreaterThan(0);
    // First child: drawn under the label, the state and the road.
    const first = screen.getByTestId("life-now").children[0];
    expect(typeof first === "string" ? first : first.props.testID).toBe("stage-motif");
    const paths = motif.findAllByType(Path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.map((p) => p.props.stroke)).toEqual(paths.map(() => v4.civ.cn.tL));
  });

  it("the current state is v3's display: glyph and word both 56, the word in Noto Serif SC 600", async () => {
    await open();
    await settle();
    expect(flat(screen.getByTestId("soul-state-glyph")).fontSize).toBe(56);
    expect(flat(screen.getByTestId("soul-state-word"))).toMatchObject({ fontSize: 56, fontFamily: "NotoSerifSC_600" });
  });

  it("a passed stage's ✓ is set in the status-glyph face (IBM Plex Mono has none: the OS drew a √)", async () => {
    await open();
    await settle();
    const ticks = screen.queryAllByText("✓");
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) expect(flat(tick).fontFamily).toBe("SoulLedgerGlyphs");
  });
});

describe("an Egyptian verdict reads as the scale (docs/02 §5)", () => {
  const judgment = (id: string, verdict: string, weighing_result: string | null) => ({
    id, court: "两真之殿", judge: null, judgment_method: "HEART_WEIGHING", verdict, weighing_result,
    is_final: true, created_at: "2026-10-27T00:00:00Z", concluded_at: "2026-10-27T00:00:00Z",
  });

  it("a wavering scale is a second weighing, not 待定; a weighed verdict carries the scale's words", async () => {
    await open(life(1, { judgments: [judgment("j1", "PURGATORY", "WAVERING"), judgment("j2", "FAILED", "HEAVIER")] }));
    fireEvent.press(screen.getByTestId("section-judgments-toggle"));
    expect(screen.getByText("天平摇摆 · 再称")).toBeTruthy();
    expect(screen.queryByText("待定")).toBeNull();
    expect(screen.getByTestId("weighing-j2")).toBeTruthy();
    expect(screen.getByText("重于羽")).toBeTruthy();
    expect(screen.queryByTestId("weighing-j1")).toBeNull();
    fireEvent(screen.getByTestId("section-judgments-body").parent!, "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 120 } },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, motion.sectionGrow + 200));
    });
  });
});

describe("the ledger rows", () => {
  it("01–06, ＋ turned 45° when open, the body on the canvas behind a 3pt ink rule, growing in", async () => {
    await open();
    expect(ORDER.map((k) => screen.getByTestId(`section-${k}-index`).props.children)).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(screen.getByTestId("ledger-head")).toBeTruthy();
    expect(flat(screen.getByTestId("section-records-plus")).transform).toEqual([{ rotate: "45deg" }]);
    expect(flat(screen.getByTestId("section-judgments-plus")).transform).toBeUndefined();
    expect(flat(screen.getByTestId("section-records-body"))).toMatchObject({ borderLeftWidth: 3, borderLeftColor: v4.light.ink, backgroundColor: v4.light.main });
    // Rows are 60pt, never under the 44pt target.
    expect(flat(screen.getByTestId("section-records-toggle")).minHeight).toBe(60);
    // Arrived open: it just is. Opened by hand: it grows from 0 with its opacity, then lets go.
    expect(screen.queryByTestId("grow")).toBeNull();
    fireEvent.press(screen.getByTestId("section-judgments-toggle"));
    expect(flat(screen.getByTestId("grow"))).toMatchObject({ height: 0, opacity: 0, overflow: "hidden" });
    const growing = screen.getByTestId("section-judgments-body");
    fireEvent(growing.parent!, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 120 } } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, motion.sectionGrow + 200));
    });
    expect(screen.queryByTestId("grow")).toBeNull();
    // Letting go keeps the body — the same element, not a remount of it (and of whatever it holds).
    expect(screen.getByTestId("section-judgments-body") === growing).toBe(true);
  });
});

describe("a record's basis", () => {
  const record = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, record_type: "DEMERIT", category: "SPEECH", description: "妄语", weight: 2, event_date: null,
    is_milestone: false, recorded_at: "2026-09-10T00:00:00Z", statute_snapshot: null, life_stage: "", ...overrides,
  });

  it("shows the statute code with its title and the life stage, and says nothing for a record without either", async () => {
    // FadeIn (ui.tsx) animates opacity over 120 ms. On real timers a sleep to wait it out was load-dependent
    // (one tick was enough when idle, not on the pre-push run); on fake timers the fade is run to its end below.
    jest.useFakeTimers();
    await open(life(1, {
      records: [
        record("r1", { statute_snapshot: { code: "CN-GGG-F-01", title: { zh: "不妄语", en: "No false speech", egy: "" } }, life_stage: "OLD_AGE" }),
        record("r2"),
      ],
    }));
    expect(screen.getByTestId("record-statute-r1")).toHaveTextContent("依据 CN-GGG-F-01 不妄语");
    expect(screen.getByTestId("record-stage-r1")).toHaveTextContent("老年");
    expect(screen.queryByTestId("record-statute-r2")).toBeNull();
    expect(screen.queryByTestId("record-stage-r2")).toBeNull();
    // The soul never sees where the record came from.
    expect(screen.queryByText(/证人|WITNESS/)).toBeNull();
    await act(() => jest.advanceTimersByTimeAsync(500));
    jest.useRealTimers();
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

describe("地府十三站与出身部洲 (docs/06, 07; Design 第五十七批 S-2)", () => {
  async function openAs(profile: Record<string, unknown>) {
    stubApi({
      "/me/": { status: 200, data: { ...PROFILE, ...profile } },
      "/me/life/": { status: 200, data: life(1) },
      "/me/past-lives/": { status: 200, data: [] },
      "/me/sentence-plan/": { status: 200, data: { state: "none", rebirth_open: true, stations: [] } },
    });
    renderApp();
    await screen.findByTestId("section-records-body");
    // The 赴冥 card and the station row animate in; let them land before the test ends (act warnings otherwise).
    await act(async () => new Promise((r) => setTimeout(r, motion.bandCompact + 200)));
  }

  it("on the road: v4's 「你现在在哪」 — the station, what it is, and the road drawn down from it; the continent under the name", async () => {
    await openAs({ diyu_station: "WANGXIANG_TERRACE", birth_continent: "NANZHAN", current_state: "DISPOSED" });
    expect(screen.getByTestId("life-here-place")).toHaveTextContent("望乡台");
    expect(screen.getByTestId("life-here-line")).toHaveTextContent("现在在望乡台：回望人间、最后一眼看家乡的地方。");
    expect(screen.getByTestId("life-here-line")).not.toHaveTextContent("WANGXIANG_TERRACE");
    // Walked (土地庙、黄泉路), here, three ahead, then the rest folded: 「后面还有 n 处」.
    expect(screen.getByTestId("route-TUDI_TEMPLE")).toBeTruthy();
    expect(screen.getByTestId("route-WANGXIANG_TERRACE")).toHaveTextContent(/你现在在这里/);
    expect(screen.getByTestId("route-ahead")).toHaveTextContent("后面还有 8 处");
    // The thirteen-glyph card is the road now; it is not drawn twice.
    expect(screen.queryByTestId("life-stations")).toBeNull();
    expect(screen.getByTestId("soul-continent")).toHaveTextContent(/南瞻部洲/);
    expect(screen.getByTestId("life-continent")).toHaveTextContent(/南瞻部洲/);
  });

  it("off the road (alive, or past the thirteen stations) there is no card; an unrecorded continent keeps its row only", async () => {
    await openAs({ diyu_station: "", birth_continent: "" });
    expect(screen.queryByTestId("life-stations")).toBeNull();
    expect(screen.queryByTestId("soul-continent")).toBeNull();
    expect(screen.getByTestId("life-continent")).toBeTruthy();
  });

  it("another civilization has neither", async () => {
    await openAs({ civilization: "EUROPEAN", diyu_station: "WANGXIANG_TERRACE", birth_continent: "NANZHAN" });
    expect(screen.queryByTestId("life-stations")).toBeNull();
    expect(screen.queryByTestId("soul-continent")).toBeNull();
    // v4 第十批第 4 条: Europe does not go round, so its life has no number; the account's cycle 1 is a life elsewhere.
    expect(screen.getByTestId("identity-meta").props.children).toMatch(/此生 · 此前另有 1 世/);
    expect(screen.getByTestId("identity-meta").props.children).not.toMatch(/第 2 世/);
  });
});

describe("the five-stage road follows the home civilization (review 2026-11-01)", () => {
  async function openAs(profile: { civilization: string; current_state: string }) {
    stubApi({
      "/me/": {
        status: 200,
        data: { ...PROFILE, home_civilization: profile.civilization, welcomed_civilizations: [profile.civilization], diyu_station: "", ...profile },
      },
      "/me/life/": { status: 200, data: life(1) },
      "/me/past-lives/": { status: 200, data: [] },
      "/me/sentence-plan/": { status: 200, data: { state: "none", rebirth_open: false, stations: [] } },
    });
    renderApp();
    await screen.findByTestId("section-records-body");
    await act(async () => new Promise((r) => setTimeout(r, motion.bandCompact + 200)));
  }

  it.each(["EGYPTIAN", "EUROPEAN"])("%s has no rebirth: no 「轮回中」 step, and the road counts four", async (civilization) => {
    await openAs({ civilization, current_state: "DISPOSED" });
    expect(screen.getByTestId("path-DISPOSED-here")).toBeTruthy();
    expect(screen.getByTestId("path-SENTENCE-ahead")).toBeTruthy();
    expect(screen.queryByTestId(/^path-REINCARNATING-/)).toBeNull();
    expect(screen.queryByText("轮回中")).toBeNull();
    expect(screen.getByTestId("life-stage").props.children).toBe("本世阶段 03 / 04");
  });

  it.each(["CHINESE", "GREEK"])("%s keeps the fifth step", async (civilization) => {
    await openAs({ civilization, current_state: "DISPOSED" });
    expect(screen.getByTestId("path-REINCARNATING-ahead")).toBeTruthy();
    expect(screen.getByTestId("life-stage").props.children).toBe("本世阶段 03 / 05");
  });
});
