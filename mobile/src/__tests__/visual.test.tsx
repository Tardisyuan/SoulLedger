/**
 * The presentation rules as rendered: the unknown-value badge, the reason under
 * a disabled control, the initial-password expiry warning, a past life with no
 * action in it, the civilization skin, and the long-label layout.
 */
import BottomSheet from "@gorhom/bottom-sheet";
import { NavigationContainer } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { GestureHandlerRootView, State, type PanGesture } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { useSharedValue } from "react-native-reanimated";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, DeviceEventEmitter, Easing, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LogoutProvider, useAskLogout } from "../feedback";
import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { FONT_ASSETS, quoteFamily, titleFamily } from "../fonts";
import { APPLICATION_BADGES, SOUL_STATE_BADGES } from "../rules";
import { ExpiryBox } from "../screens/auth";
import { LifeSections } from "../screens/life";
import { motion, radius, themeFor } from "../theme";
import {
  Button,
  DataRow,
  EnumBadge,
  Input,
  PULL_REFRESH_PT,
  Screen,
  Quote,
  RadioMark,
  Section,
  SectionLabel,
  SwitchMark,
  TYPE,
  ThemeContext,
  Txt,
  shade,
  useReducedMotionDurations,
} from "../ui";
import { application, life } from "./stubApi";

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

function wrap(children: ReactNode, civilization: string | null = "CHINESE") {
  return render(tree(children, civilization));
}

function tree(children: ReactNode, civilization: string | null = "CHINESE") {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ThemeContext.Provider value={themeFor(civilization, "dark")}>
          <NavigationContainer>{children}</NavigationContainer>
        </ThemeContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => installMobilePlatform());

describe("the unrecognized-value badge", () => {
  it("shows the label AND the raw member, in mono, inside a dotted border", () => {
    wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value="PENDING_SYNC" />);
    const badge = screen.getByTestId("b");
    expect(within(badge).getByText("?")).toBeTruthy();
    expect(within(badge).getByText("未识别取值")).toBeTruthy();
    const raw = within(badge).getByText("PENDING_SYNC");
    expect(flat(raw).fontFamily).toBe("IBMPlexMono_400Regular");
    expect(flat(badge).borderStyle).toBe("dotted");
  });

  it("a known member shows its label only — no raw value beside it, no dotted border", () => {
    wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value="REJECTED" />);
    const badge = screen.getByTestId("b");
    expect(within(badge).getByText("已驳回")).toBeTruthy();
    expect(within(badge).queryByText("REJECTED")).toBeNull();
    expect(within(badge).queryByText("未识别取值")).toBeNull();
    expect(flat(badge).borderStyle).toBe("solid");
  });

  it("a known pill never wraps (iOS put its glyph over its label); only the raw member may", () => {
    const { unmount } = wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value="APPEALING" />);
    expect(flat(screen.getByTestId("b")).flexWrap).toBeUndefined();
    unmount();
    wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value="PENDING_SYNC" />);
    expect(flat(screen.getByTestId("b")).flexWrap).toBe("wrap");
  });
});

describe("soul-state badges", () => {
  it.each([
    ["ALIVE", "在世", "○", "solid"],
    ["LOST", "丢失", "◌", "dashed"],
    ["SETTLED", "已结算", "≡", "solid"],
  ])("%s is named (%s) with its own glyph %s — not the unknown badge", (state, label, glyph, border) => {
    wrap(<EnumBadge testID="b" namespace={["soul_app", "soul_states"].join(".")} table={SOUL_STATE_BADGES} value={state} />);
    const badge = screen.getByTestId("b");
    expect(within(badge).getByText(label)).toBeTruthy();
    expect(within(badge).getByText(glyph)).toBeTruthy();
    // Design E 组: the glyph is set in the one bundled glyph face, the label is not.
    expect(flat(within(badge).getByText(glyph)).fontFamily).toBe("SoulLedgerGlyphs");
    expect(flat(within(badge).getByText(label)).fontFamily).not.toBe("SoulLedgerGlyphs");
    expect(within(badge).queryByText("未识别取值")).toBeNull();
    expect(within(badge).queryByText(state)).toBeNull();
    expect(flat(badge).borderStyle).toBe(border);
  });

  it("a state the app does not know still gets the unknown badge with its raw value", () => {
    wrap(<EnumBadge testID="b" namespace={["soul_app", "soul_states"].join(".")} table={SOUL_STATE_BADGES} value="ASCENDED" />);
    const badge = screen.getByTestId("b");
    expect(within(badge).getByText("未识别取值")).toBeTruthy();
    expect(within(badge).getByText("ASCENDED")).toBeTruthy();
  });
});

describe("the Han serif", () => {
  it("quoted Chinese uses the bundled Noto Serif SC; Latin-only quotes keep Source Serif 4", () => {
    expect(quoteFamily("功过相权，尚有一过未清")).toBe("NotoSerifSC_400");
    expect(quoteFamily("Merit and demerit have been weighed")).toBe("SourceSerif4_400Regular");
    expect(FONT_ASSETS).toHaveProperty("NotoSerifSC_400");
    // Regular for quotes, SemiBold for v3's titles and display text (back 2026-10-03; it had no caller 2026-09-18).
    expect(Object.keys(FONT_ASSETS).filter((name) => name.startsWith("NotoSerifSC"))).toEqual(["NotoSerifSC_400", "NotoSerifSC_600"]);
  });

  it("titles and display text are Noto Serif SC 600 (v3 第一批); body and labels stay the interface face", () => {
    expect([TYPE.title.fontFamily, TYPE.display.fontFamily]).toEqual(["NotoSerifSC_600", "NotoSerifSC_600"]);
    expect([TYPE.body.fontFamily, TYPE.label.fontFamily, TYPE.section.fontFamily]).not.toContain("NotoSerifSC_600");
    wrap(<Txt variant="title">灵魂簿</Txt>);
    expect(flat(screen.getByText("灵魂簿")).fontFamily).toBe("NotoSerifSC_600");
  });

  it("bundles exactly the two Han serif weights, each within the 1.5 MB budget (scripts/subset-serif-sc.sh)", () => {
    const fs = jest.requireActual<typeof import("fs")>("fs");
    const path = jest.requireActual<typeof import("path")>("path");
    const dir = path.join(__dirname, "..", "..", "assets", "fonts");
    // Beside them only the 5 KB status-glyph face (Design E 组), which is not a serif. v2's seal face
    // 霞鹜篆书 went with v2's seal (2026-10-03). The 600 subset is v3's titles and display text.
    expect(fs.readdirSync(dir).filter((f: string) => f.endsWith(".ttf"))).toEqual([
      "NotoSerifSC-Subset-400.ttf",
      "NotoSerifSC-Subset-600.ttf",
      "SoulLedgerGlyphs.ttf",
    ]);
    for (const w of ["400", "600"]) expect(fs.statSync(path.join(dir, `NotoSerifSC-Subset-${w}.ttf`)).size <= 1_500_000).toBe(true);
    // what App.tsx hands to useFonts must resolve — a require of a deleted file fails the import above
    expect(FONT_ASSETS.NotoSerifSC_400).toBeTruthy();
    expect(FONT_ASSETS.NotoSerifSC_600).toBeTruthy();
  });

  it("renders a rejection reason in it", () => {
    wrap(<Quote testID="q" text="人道可期，然非此时。" tone="rejection" />);
    expect(flat(screen.getByTestId("q")).fontFamily).toBe("NotoSerifSC_400");
  });
});

describe("a disabled control says why", () => {
  it("the reason is shown while disabled, and pressing does nothing", () => {
    const onPress = jest.fn();
    wrap(<Button testID="go" title="提交" onPress={onPress} disabled reason="已有一份进行中的转生申请" reasonTestID="why" />);
    expect(screen.getByTestId("why").props.children).toBe("已有一份进行中的转生申请");
    fireEvent.press(screen.getByTestId("go"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("an enabled control shows no reason", () => {
    wrap(<Button testID="go" title="提交" onPress={jest.fn()} reason="已有一份进行中的转生申请" reasonTestID="why" />);
    expect(screen.queryByTestId("why")).toBeNull();
  });
});

describe("initial password expiry", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  const inHours = (h: number) => new Date(now + h * 3_600_000).toISOString();
  const theme = themeFor(null, "dark");

  it("under 6 hours: the warn (橙) colours, not neg, AND the consequence, not only a colour change", () => {
    wrap(<ExpiryBox expiresAt={inHours(3.5)} now={now} />, null);
    const box = screen.getByTestId("expiry-box");
    expect(flat(box)).toMatchObject({ borderColor: theme.warn, backgroundColor: theme.warnBg });
    expect(screen.getByText("剩余 3 小时 · 过期后须由官员重置")).toBeTruthy();
  });

  it("with time to spare: neutral box, hours left, no consequence line", () => {
    wrap(<ExpiryBox expiresAt={inHours(39.2)} now={now} />, null);
    const box = screen.getByTestId("expiry-box");
    expect(flat(box)).toMatchObject({ borderColor: theme.inkSubtle, backgroundColor: theme.s1 });
    expect(screen.getByText("剩余 39 小时")).toBeTruthy();
    expect(screen.queryByText(/官员重置/)).toBeNull();
  });
});

describe("a past life has no action in it", () => {
  it("sealed: no disclosure, no link into an application — even with a handler passed and can_appeal set", () => {
    const onOpen = jest.fn();
    wrap(
      <LifeSections
        sealed
        onOpenApplication={onOpen}
        onToggle={jest.fn()}
        lex="cn"
        life={life(0, { rebirth_applications: [application({ cycle: 0, status: "REJECTED", can_appeal: true })] }) as never}
      />
    );
    expect(screen.getByText("已驳回")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("the current life does link into its application (so the sealed case above is not vacuous)", () => {
    wrap(
      <LifeSections
        onOpenApplication={jest.fn()}
        lex="cn"
        life={life(1, { rebirth_applications: [application({ id: "a9" })] }) as never}
      />
    );
    expect(screen.getByTestId("life-open-a9")).toBeTruthy();
  });
});

describe("status badges are domain enums, not status colours (补足 C15)", () => {
  it("every civilization draws the same badge: ink words, an ink3 frame — never its plaque", () => {
    const looks = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"].map((civ) => {
      const { unmount } = wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value="REJECTED" />, civ);
      const box = flat(screen.getByTestId("b"));
      const glyph = flat(within(screen.getByTestId("b")).getByText("✕"));
      unmount();
      const t = themeFor(civ, "dark");
      expect([box.borderColor, glyph.color]).toEqual([t.inkSubtle, t.ink]);
      expect([t.neg, t.negStrong, t.plaque, t.pos, t.warn]).not.toContain(glyph.color);
      return box.borderColor;
    });
    expect(new Set(looks).size).toBe(1);
  });

  it("the ones still waiting on someone (待审 / 申诉中) sit on s2; a decided one on nothing", () => {
    const t = themeFor("CHINESE", "dark");
    for (const [value, ground] of [["UNDER_REVIEW", t.s2], ["APPEALING", t.s2], ["APPROVED", "transparent"], ["REJECTED", "transparent"]]) {
      const { unmount } = wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value={value} />);
      expect([value, flat(screen.getByTestId("b")).backgroundColor]).toEqual([value, ground]);
      unmount();
    }
    wrap(<EnumBadge testID="b" namespace={["soul_app", "soul_states"].join(".")} table={SOUL_STATE_BADGES} value="JUDGING" />);
    expect(flat(screen.getByTestId("b")).backgroundColor).toBe(t.s2);
  });
});

describe("long labels", () => {
  it("a label over 18 characters puts the value on its own line; a short one stays beside it", () => {
    wrap(
      <>
        <DataRow testID="short" label="Cross-civilization">
          No
        </DataRow>
        <DataRow testID="long" label="Cross-civilisation transfer" mono>
          2026-09-09 16:40
        </DataRow>
      </>
    );
    expect(flat(screen.getByTestId("short")).flexDirection).toBe("row");
    expect(flat(screen.getByTestId("long")).flexDirection).toBe("column");
    // A mono value is never shortened.
    expect(screen.getByText("2026-09-09 16:40").props.numberOfLines).toBeUndefined();
  });
});

/** v2「朱印」base components (补足 A1 states, A2 rules). */
describe("v3 section labels (.product-label)", () => {
  const cn = themeFor("CHINESE", "dark");
  // v3 第一批: 11, upper case, the interface face — not mono (the round-7 prototype's was mono).
  const label = { fontFamily: "Archivo_500Medium", fontSize: 11, textTransform: "uppercase", color: cn.inkMuted };

  it("SectionLabel: 11, upper case, the interface face (not mono), muted — not ink, not the civilization's colour", () => {
    wrap(<SectionLabel>Language</SectionLabel>);
    expect(flat(screen.getByText("Language"))).toMatchObject(label);
    expect(String(flat(screen.getByText("Language")).fontFamily)).not.toMatch(/Mono/);
    expect(flat(screen.getByText("Language")).color).not.toBe(cn.plaque);
  });

  it("a section header outside the ledger is one; a ledger row keeps its 15 / 600 title", () => {
    wrap(
      <>
        <Section testID="plain" title="Open source" open={false} onToggle={jest.fn()}>
          <Text>body</Text>
        </Section>
        <Section testID="ledger" index={1} title="功过" open={false} onToggle={jest.fn()}>
          <Text>body</Text>
        </Section>
      </>
    );
    expect(flat(screen.getByText("Open source"))).toMatchObject(label);
    expect(flat(screen.getByText("功过"))).toMatchObject({ fontSize: 15, fontFamily: "Archivo_600SemiBold", color: cn.ink });
  });
});

describe("v2 base components", () => {
  const cn = themeFor("CHINESE", "dark");
  const hosts = (id: string) => screen.getByTestId(id).findAll((n) => typeof n.type === "string");
  const hasPath = (id: string) => screen.getByTestId(id).findAll((n) => typeof n.props.d === "string").length > 0;

  it("primary is the plaque's fill under onPlaque (dark: the band); pressing darkens it 24%, never lightens it", () => {
    wrap(<Button testID="go" title="提交" onPress={jest.fn()} />);
    expect(flat(screen.getByTestId("go")).backgroundColor).toBe(cn.plaqueFill);
    expect(cn.plaqueFill).toBe(cn.band); // dark: 10% #111 mixed in, so white text clears AA on every civilization
    expect(flat(screen.getByText("提交")).color).toBe(cn.onPlaque);
    // The Pressable's own style function, asked for its pressed look (the test renderer has no touch).
    let pressable = screen.getByTestId("go").parent;
    while (pressable && typeof pressable.props.style !== "function") pressable = pressable.parent;
    const styleOf = pressable!.props.style as (s: { pressed: boolean }) => unknown;
    const pressed = StyleSheet.flatten(styleOf({ pressed: true }) as never) as Record<string, unknown>;
    expect(pressed.backgroundColor).toBe(shade(cn.plaqueFill));
    expect(shade("#B3402C")).toBe("#883121");
  });

  it("danger is solid neg.strong under white, with a ✕; secondary is an ink3 outline with no glyph", () => {
    wrap(
      <>
        <Button testID="del" kind="danger" title="删除" onPress={jest.fn()} />
        <Button testID="later" kind="secondary" title="稍后" onPress={jest.fn()} />
      </>
    );
    expect(flat(screen.getByTestId("del")).backgroundColor).toBe(cn.negStrong);
    expect(flat(screen.getByText("删除")).color).toBe("#FFFFFF");
    expect(hasPath("del")).toBe(true);
    expect(flat(screen.getByTestId("later"))).toMatchObject({ backgroundColor: "transparent", borderColor: cn.inkSubtle });
    expect(hasPath("later")).toBe(false);
  });

  it("disabled: s2 ground, ink3 text — the plaque is gone", () => {
    wrap(<Button testID="go" title="提交" onPress={jest.fn()} disabled />);
    expect(flat(screen.getByTestId("go")).backgroundColor).toBe(cn.s2);
    expect(flat(screen.getByText("提交")).color).toBe(cn.inkSubtle);
  });

  it("an input in error takes a 2px neg border; a disabled one is s2 with ink3 text", () => {
    wrap(
      <>
        <Input testID="bad" label="判词" value="" error="判词不能为空" />
        <Input testID="off" label="编号" value="c41e0a97" editable={false} />
      </>
    );
    // The field's box: the nearest ancestor that draws a border.
    const box = (id: string) => {
      let node = screen.getByTestId(id).parent;
      while (node && flat(node).borderColor === undefined) node = node.parent;
      return node ? flat(node) : {};
    };
    expect(box("bad")).toMatchObject({ borderColor: cn.neg, borderWidth: 2 });
    expect(box("off")).toMatchObject({ backgroundColor: cn.s2, borderColor: cn.hair });
    expect(flat(screen.getByTestId("off")).color).toBe(cn.inkSubtle);
  });

  it("a checked radio is a solid-ink dot in a circle; a switch on is solid ink — never the plaque", () => {
    wrap(
      <>
        <View testID="r">
          <RadioMark on />
        </View>
        <View testID="s">
          <SwitchMark on />
        </View>
      </>
    );
    const [ring, dot] = hosts("r").slice(1).map(flat);
    expect(ring).toMatchObject({ borderColor: cn.ink, borderRadius: 999 });
    expect(dot).toMatchObject({ backgroundColor: cn.ink, borderRadius: 999 });
    const track = flat(hosts("s")[1]);
    expect(track).toMatchObject({ backgroundColor: cn.ink, borderColor: cn.ink });
    expect([ring.borderColor, dot.backgroundColor, track.backgroundColor]).not.toContain(cn.plaque);
  });
});

describe("useReducedMotionDurations", () => {
  function Probe() {
    return <Text testID="d">{JSON.stringify(useReducedMotionDurations())}</Text>;
  }
  const read = () => JSON.parse(screen.getByTestId("d").props.children as string) as Record<string, number>;

  it("is `motion` unchanged while reduce motion is off", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    wrap(<Probe />);
    await act(async () => {});
    expect(read()).toEqual(motion);
  });

  it("under reduce motion: every transition 0; the holds (waits, not movement) unchanged", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    wrap(<Probe />);
    await act(async () => {});
    const d = read();
    expect(Object.entries(d).filter(([k, v]) => !k.endsWith("Hold") && v !== 0)).toEqual([]);
    expect([d.toastHold, d.welcomeHold]).toEqual([motion.toastHold, motion.welcomeHold]);
  });
});

describe("v3 timings and corners", () => {
  it("a toast stays 4s (v3 B2 Toast 停留 4s); a sheet opens over 240 and closes over 180", () => {
    expect([motion.toastHold, motion.sheetIn, motion.sheetOut]).toEqual([4000, 240, 180]);
  });

  it("inputs 4, dialogs and sheets 8, the rest square (v3 第一批 形状与层次)", async () => {
    expect(radius).toEqual({ none: 0, control: 4, dialog: 8, pill: 999 });
    wrap(<Input label="Name" testID="name" value="" onChangeText={jest.fn()} />);
    const box = screen.getByTestId("name").parent?.parent;
    expect(flat(box as never).borderRadius).toBe(4);
    screen.unmount();
    wrap(
      <LogoutProvider onConfirm={jest.fn()}>
        <AskLogout />
      </LogoutProvider>
    );
    await act(async () => {});
    fireEvent.press(screen.getByTestId("ask"));
    expect(flat(screen.getByTestId("confirm-sheet"))).toMatchObject({ borderTopLeftRadius: 8, borderTopRightRadius: 8 });
    expect(flat(screen.getByTestId("confirm-sheet")).borderBottomLeftRadius).toBeUndefined();
  });
});

function AskLogout() {
  const ask = useAskLogout();
  return <Button testID="ask" title="ask" onPress={ask} />;
}

describe("titleFamily (v3 titles in Noto Serif SC 600, a Han + ASCII subset)", () => {
  it("Han, ASCII and the subset's punctuation take the serif; a rare Han character alone falls back, so it still does", () => {
    expect(["张三", "Anubis", "第 2 世 · 书信", "「灵魂簿」", "王翾"].map(titleFamily)).toEqual(Array(5).fill("NotoSerifSC_600"));
  });
  it("a letter outside the subset keeps the whole title in the interface face, not serif and sans glyph by glyph", () => {
    expect(["Jérôme", "Søren", "Σωκράτης", "Ḥr-m-ḥꜣb", "Đặng"].map(titleFamily)).toEqual(Array(5).fill("Archivo_600SemiBold"));
  });
});

const realImmediate = setImmediate;

describe("pull to refresh (v3 B2: the content follows the finger, at most 56; no spinner)", () => {
  // The pull is a gesture-handler Pan (user decision 2026-10-03, the v3 B4 exception); jest drives
  // it through the library's own test utils, or — for a pull still under the finger — its events.
  const pan = () => getByGestureTestId("pull");
  const emit = (name: string, ev: Record<string, unknown>) =>
    act(() => void DeviceEventEmitter.emit(name, { handlerTag: pan().handlerTag, numberOfPointers: 1, x: 0, y: 0, absoluteX: 0, absoluteY: 0, translationX: 0, velocityX: 0, velocityY: 0, ...ev }));
  /** Down and held, `dy` below where the finger landed. */
  const hold = (dy: number) => {
    emit("onGestureHandlerStateChange", { state: State.BEGAN, oldState: State.UNDETERMINED, translationY: 0 });
    emit("onGestureHandlerStateChange", { state: State.ACTIVE, oldState: State.BEGAN, translationY: dy });
    emit("onGestureHandlerEvent", { state: State.ACTIVE, translationY: dy });
  };
  /** A whole pull: down `dy`, released. */
  const pull = (dy: number) =>
    act(() =>
      fireGestureHandler<PanGesture>(pan(), [
        { state: State.BEGAN, translationY: 0 },
        { state: State.ACTIVE, translationY: 0 },
        { translationY: dy },
        { state: State.END, translationY: dy },
      ])
    );
  // The detector applies a changed gesture (enabled, reduce motion) on the next setImmediate —
  // gesture-handler bound the real one at import, before the fake timers.
  const applied = () => act(() => new Promise<void>((resolve) => realImmediate(() => resolve())));
  const shift = () => (flat(screen.getByTestId("pull-content")).transform as { translateY: number }[])[0].translateY;
  const indicator = () => screen.queryByTestId("pull-indicator", { includeHiddenElements: true });
  const opacity = () => flat(indicator()!).opacity;
  const scroller = () => screen.UNSAFE_getByType(ScrollView);
  const settle = () => act(() => void jest.advanceTimersByTime(motion.pullMinHold + motion.pullRelease + 50));
  const deferred = () => {
    let done = () => {};
    const promise = new Promise<void>((resolve) => (done = resolve));
    return { promise, done: () => act(async () => done()) };
  };
  const setOS = (os: string) => Object.defineProperty(Platform, "OS", { value: os, configurable: true });
  const os = Platform.OS;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    setOS(os);
  });

  const mount = async (onRefresh: () => unknown = jest.fn()) => {
    wrap(<Screen onRefresh={onRefresh}>{null}</Screen>);
    await act(async () => {});
    await applied();
  };

  it("a scrolling Screen pads itself by the keyboard on both platforms, so a low field is not hidden", async () => {
    for (const os of ["ios", "android"] as const) {
      setOS(os);
      const { UNSAFE_getByType, unmount } = wrap(<Screen>{null}</Screen>);
      await act(async () => {});
      const kav = UNSAFE_getByType(KeyboardAvoidingView);
      expect(kav.props.behavior).toBe("padding");
      expect(kav.findByType(ScrollView)).toBeTruthy();
      unmount();
    }
  });

  it("the content follows the finger and stops at 56; the ↻ fades in with it", async () => {
    await mount();
    expect(shift()).toBe(0);
    expect(opacity()).toBe(0);
    hold(30);
    expect(shift()).toBe(30);
    expect(opacity()).toBeCloseTo(30 / PULL_REFRESH_PT);
    hold(100);
    expect(shift()).toBe(PULL_REFRESH_PT);
    expect(opacity()).toBe(1);
  });

  it("released at 55: no reload, and back to 0 over 200ms on the entry curve", async () => {
    const onRefresh = jest.fn();
    await mount(onRefresh);
    const timing = jest.spyOn(Animated, "timing");
    pull(PULL_REFRESH_PT - 1);
    expect(onRefresh).not.toHaveBeenCalled();
    const config = timing.mock.calls.at(-1)![1] as { toValue: number; duration: number; easing: (x: number) => number };
    expect(config).toMatchObject({ toValue: 0, duration: 200 });
    expect(config.easing(0.3)).toBeCloseTo(Easing.bezier(0.2, 0.8, 0.2, 1)(0.3));
    expect(config.easing(0.3)).not.toBeCloseTo(0.3);
    settle();
    expect(shift()).toBe(0);
  });

  it("released at 56: one reload; the content waits at 56 with the ↻ until it is done, then goes back", async () => {
    const reload = deferred();
    const onRefresh = jest.fn(() => reload.promise);
    await mount(onRefresh);
    pull(PULL_REFRESH_PT);
    await applied();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    settle();
    expect(shift()).toBe(PULL_REFRESH_PT);
    expect(opacity()).toBe(1);
    // A second pull while it runs does nothing.
    pull(PULL_REFRESH_PT + 40);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await reload.done();
    await applied();
    settle();
    expect(shift()).toBe(0);
    expect(opacity()).toBe(0);
    pull(PULL_REFRESH_PT);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    await act(async () => {}); // that second reload's (already settled) promise
  });

  it("a reload that answers at once still holds the ↻ at 56 for motion.pullMinHold, then goes back", async () => {
    const onRefresh = jest.fn(() => Promise.resolve());
    await mount(onRefresh);
    pull(PULL_REFRESH_PT);
    await applied();
    await act(async () => {}); // the promise has settled
    act(() => void jest.advanceTimersByTime(motion.pullMinHold - 100));
    expect(shift()).toBe(PULL_REFRESH_PT);
    expect(opacity()).toBe(1);
    act(() => void jest.advanceTimersByTime(100));
    settle(); // the 200ms return starts once the hold ends
    expect(shift()).toBe(0);
  });

  it("an onRefresh that returns nothing is held for as long as `refreshing` says", async () => {
    const onRefresh = jest.fn();
    // Like useRemote's reload: `refreshing` goes true in the same update as the pull.
    function Busy() {
      const [busy, setBusy] = useState(false);
      const refresh = () => {
        setBusy(true);
        onRefresh();
      };
      return (
        <Screen refreshing={busy} onRefresh={refresh}>
          <Button testID="done" title="done" onPress={() => setBusy(false)} />
        </Screen>
      );
    }
    wrap(<Busy />);
    await act(async () => {});
    await applied();
    pull(PULL_REFRESH_PT);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await applied();
    settle();
    expect(shift()).toBe(PULL_REFRESH_PT);
    pull(PULL_REFRESH_PT);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("done"));
    settle();
    expect(shift()).toBe(0);
  });

  it("scrolled down, the pull is off and the drag is the list's; back at the top, it is on again", async () => {
    const onRefresh = jest.fn();
    await mount(onRefresh);
    expect(scroller().props).toMatchObject({ bounces: false, overScrollMode: "never", scrollEventThrottle: 16 });
    act(() => fireEvent.scroll(scroller(), { nativeEvent: { contentOffset: { x: 0, y: 120 } } }));
    await applied();
    expect(pan().config.enabled).toBe(false);
    pull(PULL_REFRESH_PT + 20);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(shift()).toBe(0);
    act(() => fireEvent.scroll(scroller(), { nativeEvent: { contentOffset: { x: 0, y: 0 } } }));
    await applied();
    expect(pan().config.enabled).toBe(true);
    pull(PULL_REFRESH_PT);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("the caller's onScroll and the pull's both hear the scroller", async () => {
    const onScroll = jest.fn();
    wrap(
      <Screen onRefresh={jest.fn()} onScroll={onScroll}>
        {null}
      </Screen>
    );
    await act(async () => {});
    act(() => fireEvent.scroll(scroller(), { nativeEvent: { contentOffset: { x: 0, y: 80 } } }));
    await applied();
    expect(onScroll).toHaveBeenCalledWith(80);
    expect(pan().config.enabled).toBe(false);
  });

  it("reduce motion: the content does not follow; at 56 it stands at 56 with the ↻, short of it nothing; no animation", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const reload = deferred();
    const onRefresh = jest.fn(() => reload.promise);
    await mount(onRefresh);
    const timing = jest.spyOn(Animated, "timing");
    hold(30);
    expect(shift()).toBe(0);
    expect(opacity()).toBe(0);
    hold(PULL_REFRESH_PT - 1);
    expect(shift()).toBe(0);
    hold(PULL_REFRESH_PT + 30);
    expect(shift()).toBe(PULL_REFRESH_PT);
    expect(opacity()).toBe(1);
    emit("onGestureHandlerStateChange", { state: State.END, oldState: State.ACTIVE, translationY: PULL_REFRESH_PT + 30 });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(shift()).toBe(PULL_REFRESH_PT);
    await reload.done();
    await applied();
    act(() => void jest.advanceTimersByTime(motion.pullMinHold)); // the hold is a state, not motion: it stays
    expect(shift()).toBe(0); // then at once, not over 200
    pull(PULL_REFRESH_PT - 1);
    expect(shift()).toBe(0);
    expect(timing).not.toHaveBeenCalled();
  });

  it("with a screen reader on: the system RefreshControl, and the pull gesture is off", async () => {
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
    const reload = deferred();
    const onRefresh = jest.fn(() => reload.promise);
    await mount(onRefresh);
    expect(pan().config.enabled).toBe(false);
    expect(indicator()).toBeNull();
    pull(PULL_REFRESH_PT + 20);
    expect(onRefresh).not.toHaveBeenCalled();
    const control = () => screen.UNSAFE_getByType(RefreshControl);
    expect(control().props.refreshing).toBe(false);
    act(() => control().props.onRefresh());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(control().props.refreshing).toBe(true);
    await reload.done();
    act(() => void jest.advanceTimersByTime(motion.pullMinHold));
    expect(control().props.refreshing).toBe(false);
    expect(shift()).toBe(0);
  });

  it("Android takes the same path: the pull, no RefreshControl", async () => {
    setOS("android");
    const onRefresh = jest.fn();
    await mount(onRefresh);
    expect(screen.UNSAFE_queryAllByType(RefreshControl)).toEqual([]);
    expect(scroller().props.overScrollMode).toBe("never");
    hold(30);
    expect(shift()).toBe(30);
    emit("onGestureHandlerStateChange", { state: State.END, oldState: State.ACTIVE, translationY: 30 });
    settle();
    pull(PULL_REFRESH_PT);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("a screen without onRefresh has neither the pull nor a RefreshControl", async () => {
    wrap(<Screen>{null}</Screen>);
    await act(async () => {});
    expect(indicator()).toBeNull();
    expect(screen.queryByTestId("pull-content")).toBeNull();
    expect(screen.UNSAFE_queryAllByType(RefreshControl)).toEqual([]);
    expect(scroller().props.bounces).toBeUndefined();
  });
});

describe("the v2 motion libraries load under jest (published mocks; the bottom sheet is jest.setup's own double)", () => {
  it("reanimated, gesture handler, bottom sheet and haptics import; the gesture root renders", () => {
    expect(typeof useSharedValue).toBe("function");
    expect(BottomSheet).toBeTruthy();
    expect(typeof Haptics.impactAsync).toBe("function");
    render(
      <GestureHandlerRootView testID="root">
        <Text>x</Text>
      </GestureHandlerRootView>
    );
    expect(screen.getByText("x")).toBeTruthy();
  });
});
