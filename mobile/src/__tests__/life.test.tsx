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
import Svg, { Path, Stop } from "react-native-svg";

import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { LIFE_OPEN_PREFIX } from "../screens/life";
import { SessionProvider } from "../session";
import { ON_PLAQUE, motion, v3, v3Band } from "../theme";
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
    // The name is the band's title: v3's title serif, Noto Serif SC 600, at 20 (13 compact).
    expect(flat(screen.getByTestId("soul-name"))).toMatchObject({ fontFamily: "NotoSerifSC_600", fontSize: 20 });
    expect(flat(screen.getByTestId("plaque-seal")).width).toBe(64);
    expect(flat(screen.getByTestId("identity")).height).toBe(116);
    // v3's 64pt seal still fits the full band (it clips: overflow hidden): padding, meta line, gap, seal.
    const band = flat(screen.getByTestId("identity")) as Record<string, number>;
    const need = band.paddingTop + Number(flat(screen.getByTestId("identity-meta")).lineHeight) + band.gap + Number(flat(screen.getByTestId("plaque-seal")).height) + band.paddingBottom;
    expect(need).toBeLessThanOrEqual(band.height);
    // The civilization's colour (darkened 10%, as v3 mixes it) is the band's; the page under it is neutral.
    expect(flat(screen.getByTestId("plaque")).backgroundColor).toBe(v3Band(v3.civ.cn.light));
    expect(flat(screen.getByTestId("life")).backgroundColor).toBe(v3.light.canvas);
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
});

describe("the copy-the-soul-code target", () => {
  /** The target's own box: the code's line plus the padding around it (no `hitSlop`, which Android drops outside a parent). */
  const target = () => {
    const box = flat(screen.getByTestId("copy-soul-code")) as Record<string, number>;
    const line = Number(flat(screen.getByText(PROFILE.soul_code)).lineHeight);
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

  it("the band carries 中国's grid at 15% white, fading out by 72% of the width", async () => {
    await open();
    await settle();
    expect(svg("band-pattern").props.opacity).toBe(0.15);
    const stops = screen.UNSAFE_getAllByType(Stop).map((s) => [s.props.offset, s.props.stopOpacity, s.props.stopColor]);
    expect(stops).toEqual([
      [0, 1, ON_PLAQUE],
      [0.72, 0, ON_PLAQUE],
    ]);
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
    expect(paths.map((p) => p.props.stroke)).toEqual(paths.map(() => v3.civ.cn.light));
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
