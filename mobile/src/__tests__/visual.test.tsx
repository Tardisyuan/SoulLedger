/**
 * The presentation rules as rendered: the unknown-value badge, the reason under
 * a disabled control, the initial-password expiry warning, a past life with no
 * action in it, the civilization skin, and the long-label layout.
 */
import BottomSheet from "@gorhom/bottom-sheet";
import { NavigationContainer } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { FONT_ASSETS, quoteFamily } from "../fonts";
import { APPLICATION_BADGES, SOUL_STATE_BADGES } from "../rules";
import { ExpiryBox } from "../screens/auth";
import { LifeSections } from "../screens/life";
import { motion, themeFor } from "../theme";
import {
  Button,
  DataRow,
  EnumBadge,
  Input,
  Quote,
  RadioMark,
  SwitchMark,
  ThemeContext,
  shade,
  useReducedMotionDurations,
} from "../ui";
import { application, life } from "./stubApi";

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

function wrap(children: ReactNode, civilization: string | null = "CHINESE") {
  return render(
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
    ["LOST", "丢失", "⊘", "dashed"],
    ["SETTLED", "已结算", "≡", "solid"],
  ])("%s is named (%s) with its own glyph %s — not the unknown badge", (state, label, glyph, border) => {
    wrap(<EnumBadge testID="b" namespace={["soul_app", "soul_states"].join(".")} table={SOUL_STATE_BADGES} value={state} />);
    const badge = screen.getByTestId("b");
    expect(within(badge).getByText(label)).toBeTruthy();
    expect(within(badge).getByText(glyph)).toBeTruthy();
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
    // Regular only (2026-09-18): the SemiBold subset had no caller and is gone.
    expect(Object.keys(FONT_ASSETS).filter((name) => name.startsWith("NotoSerifSC"))).toEqual(["NotoSerifSC_400"]);
  });

  it("bundles exactly the one Han serif file, within the 1.5 MB budget (scripts/subset-serif-sc.sh)", () => {
    const fs = jest.requireActual<typeof import("fs")>("fs");
    const path = jest.requireActual<typeof import("path")>("path");
    const dir = path.join(__dirname, "..", "..", "assets", "fonts");
    // Beside it only the v2 seal face 霞鹜篆书 (scripts/import-v2-art.mjs), which is not a serif for quotes.
    expect(fs.readdirSync(dir).filter((f: string) => f.endsWith(".ttf"))).toEqual(["LXGWSeal-Regular.ttf", "NotoSerifSC-Subset-400.ttf"]);
    expect(fs.statSync(path.join(dir, "NotoSerifSC-Subset-400.ttf")).size <= 1_500_000).toBe(true);
    // what App.tsx hands to useFonts must resolve — a require of a deleted file fails the import above
    expect(FONT_ASSETS.NotoSerifSC_400).toBeTruthy();
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

describe("civilization skin", () => {
  it("the same component takes each civilization's accent", () => {
    const marks = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"].map((civ) => {
      const { unmount } = wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value="UNDER_REVIEW" />, civ);
      const color = flat(screen.getByTestId("b")).borderColor;
      unmount();
      return color;
    });
    expect(marks).toEqual(["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"].map((c) => themeFor(c, "dark").accent));
    expect(new Set(marks).size).toBe(4);
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
describe("v2 base components", () => {
  const cn = themeFor("CHINESE", "dark");
  const hosts = (id: string) => screen.getByTestId(id).findAll((n) => typeof n.type === "string");
  const hasPath = (id: string) => screen.getByTestId(id).findAll((n) => typeof n.props.d === "string").length > 0;

  it("primary is the plaque under onPlaque; pressing darkens it 24%, never lightens it", () => {
    wrap(<Button testID="go" title="提交" onPress={jest.fn()} />);
    expect(flat(screen.getByTestId("go")).backgroundColor).toBe(cn.plaque);
    expect(flat(screen.getByText("提交")).color).toBe(cn.onPlaque);
    // The Pressable's own style function, asked for its pressed look (the test renderer has no touch).
    let pressable = screen.getByTestId("go").parent;
    while (pressable && typeof pressable.props.style !== "function") pressable = pressable.parent;
    const styleOf = pressable!.props.style as (s: { pressed: boolean }) => unknown;
    const pressed = StyleSheet.flatten(styleOf({ pressed: true }) as never) as Record<string, unknown>;
    expect(pressed.backgroundColor).toBe(shade(cn.plaque));
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
