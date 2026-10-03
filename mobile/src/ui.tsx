/**
 * The soul app's primitives, per the design handoff "灵魂簿 App", restyled for
 * v2「朱印」(补足 A1 component states, A2 rules, A3 type):
 *
 *   radius 0 except v3's three (`radius` in theme.ts): an input 4, a dialog or sheet 8, and
 *   the pill / circle (the lamp, a drawer handle, a radio, an avatar); the focus ring follows
 *   its element;
 *   depth is 1px hairlines between two surfaces, never a shadow or elevation;
 *   pressed is a darker ground (A1: fills darken 24% toward black, ghosts take
 *   `hair`), never an Android ripple, whose colour cannot be held to contrast;
 *   checked controls are solid ink, never the plaque (匾色 is for five places only);
 *   the only motion is opacity — a 120ms fade, the loader breathing, the welcome —
 *   and reduce-motion stills all of it (`useReducedMotionDurations`).
 */
import type { SoulErrorMessage } from "@soulledger/core/api/soul";
import type { EnumDisplay } from "@soulledger/core/domain/enumDisplay";
import { useFocusEffect } from "@react-navigation/native";
import {
  Fragment,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { Easing as REasing, FadeOut, Keyframe } from "react-native-reanimated";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { Emblem, Hero, Icon, LedgerUnreachable } from "./emblems";
import { family, quoteFamily } from "./fonts";
import { useI18n } from "./i18n";
import { useOnline } from "./online";
import { STACK_FONT_SCALE, badgeSpec, layoutFor, stacksLabel, type BadgeSpec, type Layout } from "./rules";
import { GUTTER_PT, motion, radius, space, themeFor, type Theme } from "./theme";

// ── theme & motion ─────────────────────────────────────────────────────

export const ThemeContext = createContext<Theme>(themeFor(null, "dark"));
export const useTheme = () => useContext(ThemeContext);

/** The OS "reduce motion" setting, live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduced(value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}

type Durations = Record<keyof typeof motion, number>;
/** Holds are waits, not movement: a toast still stays up long enough to read. */
const STILL: Durations = Object.fromEntries(
  Object.entries(motion).map(([key, ms]) => [key, key.endsWith("Hold") ? ms : 0])
) as Durations;

/**
 * `motion`'s durations, for `Animated` or Reanimated alike — every transition 0
 * under the OS "reduce motion" setting (v2 动效: 减少动态效果时长置 0), holds unchanged.
 */
export function useReducedMotionDurations(): Durations {
  return useReducedMotion() ? STILL : motion;
}

/** Fades its content in over 120ms when it mounts; instantly under reduce-motion. */
export function FadeIn({
  children,
  style,
  onLayout,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const { fade } = useReducedMotionDurations();
  const [opacity] = useState(() => new Animated.Value(fade ? 0 : 1));
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: fade, useNativeDriver: true }).start();
  }, [opacity, fade]);
  return (
    <Animated.View onLayout={onLayout} style={[{ opacity }, style]}>
      {children}
    </Animated.View>
  );
}

// ── type ───────────────────────────────────────────────────────────────

/**
 * v2 补足 A3: seven sizes, 11 / 12 / 13 / 15 / 20 / 28 / 40, with their line
 * heights (16 / 18 / 20 / 24 / 28 / 36 / 48). 40 is for the plaque and the login
 * page only, so no variant here uses it yet. letterSpacing is in pt.
 * (v1 had 27 / 19 / 12.5 / 11.5 / 34 and a compact step-down for display and
 * value-lg on ≤ 340pt; A3 leaves no step between 20 and 28, and 28 is already
 * smaller than v1's compact value-lg, so the step-down is gone.)
 */
export const TYPE = {
  /** v3 第一批: titles and display text in Noto Serif SC 600 (`family.title`); body and controls stay `ui`. */
  display: { fontSize: 28, lineHeight: 36, fontFamily: family.title },
  title: { fontSize: 20, lineHeight: 28, fontFamily: family.title },
  nav: { fontSize: 15, lineHeight: 20, fontFamily: family.ui[600], letterSpacing: 0.6 },
  body: { fontSize: 13, lineHeight: 20, fontFamily: family.ui[400] },
  bodyLg: { fontSize: 15, lineHeight: 24, fontFamily: family.ui[500] },
  label: { fontSize: 12, lineHeight: 18, fontFamily: family.ui[500], letterSpacing: 1 },
  /** A ledger row's title (v3 `.life-records article b`), 15 / 600 on its row. */
  section: { fontSize: 15, lineHeight: 24, fontFamily: family.ui[600] },
  /**
   * What a block of the page is — 11, upper case, always in `muted` (`SectionLabel`). Every
   * section header and form-group label outside the ledger rows. The interface face, not mono:
   * v3 第一批「区块标签：11 号，大写，界面字体（不用等宽）」 overrides the round-7 prototype's
   * mono `.product-label`; the 0.08em tracking is the prototype's.
   */
  eyebrow: { fontSize: 11, lineHeight: 16, fontFamily: family.ui[500], letterSpacing: 0.88, textTransform: "uppercase" },
  caption: { fontSize: 12, lineHeight: 18, fontFamily: family.ui[400] },
  value: { fontSize: 13, lineHeight: 20, fontFamily: family.mono[400] },
  valueLg: { fontSize: 28, lineHeight: 36, fontFamily: family.mono[500] },
} satisfies Record<string, TextStyle>;

export type Tone = "ink" | "muted" | "subtle" | "neg" | "negInk" | "pos" | "warn";

export function toneColor(t: Theme, tone: Tone): string {
  switch (tone) {
    case "ink":
      return t.ink;
    case "muted":
      return t.inkMuted;
    case "subtle":
      return t.inkSubtle;
    default:
      return t[tone];
  }
}

export function Txt({
  variant = "body",
  tone = "ink",
  style,
  ...rest
}: TextProps & { variant?: keyof typeof TYPE; tone?: Tone }) {
  const t = useTheme();
  return <Text {...rest} style={[TYPE[variant], { color: toneColor(t, tone) }, style]} />;
}

/** v3 `.product-label`: a block's name, in `muted` — never ink, never a colour. */
export function SectionLabel({ children, ...rest }: Omit<Parameters<typeof Txt>[0], "variant" | "tone">) {
  return (
    <Txt variant="eyebrow" tone="muted" {...rest}>
      {children}
    </Txt>
  );
}

/** Screen width and system text size → the handoff's three layout thresholds. */
export function useLayout(): Layout {
  const { width, fontScale } = useWindowDimensions();
  return layoutFor(width, fontScale);
}

/**
 * 文明气质 1c: the band and the illustrations drop to their compact drawing on a
 * screen under 340pt or at ≥ 1.7× text. (Strictly under 340 — `layoutFor`'s
 * `compact` is ≤ 340; the handoff draws the two lines separately.)
 */
export function useFlavorCompact(): boolean {
  const { width, fontScale } = useWindowDimensions();
  return width < 340 || fontScale >= STACK_FONT_SCALE;
}

/**
 * A translated sentence with parts rendered differently — e.g. a date in mono
 * inside a sentence in the interface face. `{{name}}` in `text` is replaced by
 * `parts[name]`; the rest stays a string, so the sentence reads as one Text.
 */
export function Interp({ text, parts, ...props }: Parameters<typeof Txt>[0] & { text: string; parts: Record<string, ReactNode> }) {
  const pieces = text.split(/\{\{(\w+)\}\}/g).map((piece, i) => (
    <Fragment key={i}>{i % 2 ? (parts[piece] ?? `{{${piece}}}`) : piece}</Fragment>
  ));
  return <Txt {...props}>{pieces}</Txt>;
}

// ── layout ─────────────────────────────────────────────────────────────

export const GUTTER = GUTTER_PT;

/** v3 B2 App「下拉刷新」: released past 56pt, the scroller reloads. */
export const PULL_REFRESH_PT = 56;
/** A drag this far down from a list at its top is a pull; this far up, or across, it is the list's. */
const PULL_SLOP_PT = 10;
const PULL_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

/** The OS screen reader (VoiceOver / TalkBack), live — `useReducedMotion`'s twin. */
export function useScreenReaderEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => alive && setOn(value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setOn);
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return on;
}

type PullScrollProps = Pick<ScrollViewProps, "refreshControl" | "bounces" | "overScrollMode" | "scrollEventThrottle" | "onScroll">;

/**
 * Pull-to-refresh for a scroller: `Screen`'s own, or a list's that owns its scrolling (a
 * `FlatList` inside `<Screen scroll={false}>`). Spread `props` on the scroller and pass it
 * through `frame`. One path on iOS and Android.
 *
 * v3 B2: no spinner. The content follows the finger down, at most 56; a release at 56 reloads
 * and the content waits there, a static ↻ in the gap (v3: 印框旋转不使用), until the reload is
 * done — what `onRefresh` returned settles, or else `refreshing` goes false — then goes back
 * over 200ms on cubic-bezier(.2,.8,.2,1); a release short of 56 goes back the same way. While
 * it waits nothing re-triggers it. Under reduce motion the content does not follow the finger:
 * at 56 it stands at 56 with the ↻, short of it nothing, and nothing animates (v3: 仅显示静态刷新
 * 指示). With a screen reader on, the system RefreshControl instead (both platforms): a screen
 * reader's three-finger scroll reaches it, a drag gesture does not.
 *
 * v3 B4 allows only Animated + PanResponder in the App, and says nested-scroll contention needs
 * a dependency. The user's decision of 2026-10-03 is the exception: pull-to-refresh and its
 * scroll contention may use react-native-gesture-handler (already installed); the animation
 * stays RN Animated, never Reanimated. A PanResponder cannot do it on Android: the scroll view
 * takes the drag natively at touch slop, before a JS responder can claim it.
 *
 * The pull is a `Gesture.Pan` around the scroller, enabled only while the list is at its top,
 * activating 10pt down and failing 10pt up or across; the scroller is a `Gesture.Native` that
 * waits for that pan to fail. Not `manualActivation` + `onTouchesMove`: on the JS thread
 * (`runOnJS`) its state manager calls Reanimated's `setGestureState`, which only acts inside a
 * worklet (on the RN runtime it warns and does nothing) — hence the declarative offsets, with
 * `enabled` following `onScroll`'s offset. The scroller neither bounces nor overscrolls: the
 * pull is the only thing that moves the content past its top. The offset is set from JS on
 * every move anyway, so the 200ms return runs on the JS driver too (one driver for one value).
 */
export function usePullRefresh(
  refreshing: boolean | undefined,
  onRefresh: (() => unknown) | undefined
): { props: PullScrollProps; frame: (scroller: ReactElement) => ReactElement } {
  const t = useTheme();
  const reduced = useReducedMotion();
  const reader = useScreenReaderEnabled();
  const { pullRelease } = useReducedMotionDurations();
  const [y] = useState(() => new Animated.Value(0));
  const [atTop, setAtTop] = useState(true);
  // "wait": held while `refreshing`; "promise": held until what onRefresh returned settles.
  const [held, setHeld] = useState<false | "wait" | "promise">(false);
  // The hold ends when the reload is done AND `motion.pullMinHold` has passed since it began.
  // A plain mutable box, not refs: the gesture callbacks built during render touch it.
  const [clock] = useState(() => ({ since: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined }));
  const endHold = useCallback(() => {
    const wait = motion.pullMinHold - (Date.now() - clock.since);
    clearTimeout(clock.timer);
    if (wait > 0) clock.timer = setTimeout(() => setHeld(false), wait);
    else setHeld(false);
  }, [clock]);
  useEffect(() => () => clearTimeout(clock.timer), [clock]);
  useEffect(() => {
    if (held === "wait" && !refreshing) endHold();
  }, [held, refreshing, endHold]);

  const trigger = () => {
    if (!onRefresh) return;
    clock.since = Date.now();
    const result = onRefresh();
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      setHeld("promise");
      (result as PromiseLike<unknown>).then(endHold, endHold);
    } else setHeld("wait");
  };
  const back = () => {
    if (pullRelease) Animated.timing(y, { toValue: 0, duration: pullRelease, easing: PULL_EASING, useNativeDriver: false }).start();
    else y.setValue(0);
  };
  // The reload is done: back from the 56 hold (only then — nothing moves on mount).
  const wasHeld = useRef(false);
  useEffect(() => {
    if (held || !wasHeld.current) {
      wasHeld.current = !!held;
      return;
    }
    wasHeld.current = false;
    if (pullRelease) Animated.timing(y, { toValue: 0, duration: pullRelease, easing: PULL_EASING, useNativeDriver: false }).start();
    else y.setValue(0);
  }, [held, pullRelease, y]);

  // Built every render: the detector keeps the native handler (same tag) and swaps in the new
  // config and callbacks, so a re-render mid-drag does not drop the pull.
  const pan = Gesture.Pan()
    .withTestId("pull")
    .runOnJS(true)
    .enabled(!!onRefresh && atTop && !held && !reader)
    .activeOffsetY(PULL_SLOP_PT)
    .failOffsetY(-PULL_SLOP_PT)
    .failOffsetX([-PULL_SLOP_PT, PULL_SLOP_PT])
    .onUpdate((e) => {
      const d = Math.min(Math.max(e.translationY, 0), PULL_REFRESH_PT);
      y.setValue(reduced ? (d >= PULL_REFRESH_PT ? PULL_REFRESH_PT : 0) : d);
    })
    .onEnd((e, ok) => (ok && e.translationY >= PULL_REFRESH_PT ? trigger() : back()));
  const native = Gesture.Native().requireExternalGestureToFail(pan);

  if (!onRefresh) return { props: {}, frame: (scroller) => scroller };
  const opacity = y.interpolate({ inputRange: [0, PULL_REFRESH_PT], outputRange: [0, 1], extrapolate: "clamp" });
  return {
    props: reader
      ? { refreshControl: <RefreshControl refreshing={!!held} onRefresh={trigger} tintColor={t.inkSubtle} /> }
      : { bounces: false, overScrollMode: "never", scrollEventThrottle: 16, onScroll: (e) => setAtTop(e.nativeEvent.contentOffset.y <= 0) },
    frame: (scroller) => (
      <GestureDetector gesture={pan}>
        <View style={styles.fill} collapsable={false}>
          {reader ? null : (
            <Animated.View testID="pull-indicator" pointerEvents="none" style={[styles.pullIndicator, { opacity }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Text style={[styles.pullGlyph, { color: t.inkSubtle }]}>↻</Text>
            </Animated.View>
          )}
          <Animated.View testID="pull-content" style={[styles.fill, { transform: [{ translateY: y }] }]}>
            <GestureDetector gesture={native}>{scroller}</GestureDetector>
          </Animated.View>
        </View>
      </GestureDetector>
    ),
  };
}

/** Both a caller's onScroll and the pull's, on one scroller. */
function both<E>(a: ((e: E) => void) | undefined, b: ((e: E) => void) | undefined) {
  return a && b ? (e: E) => (a(e), b(e)) : (a ?? b);
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  edges = ["left", "right", "bottom"],
  testID,
  scrollRef,
  onScroll,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => unknown;
  scroll?: boolean;
  edges?: Edge[];
  testID?: string;
  /** For a screen that scrolls itself to a block (a push landing, 受刑 1d). */
  scrollRef?: Ref<ScrollView>;
  /** The scroll offset, for a header that compacts as the page moves under it (v3 life band). */
  onScroll?: (y: number) => void;
}) {
  const t = useTheme();
  const pull = usePullRefresh(refreshing, onRefresh);
  // When the system text size changes while a screen is open, iOS re-sizes the
  // glyphs but Yoga keeps the old line boxes, and text is clipped (seen on the
  // iPhone run). Remounting the content at a new scale re-measures every line.
  const { fontScale } = useWindowDimensions();
  return (
    <SafeAreaView
      key={Math.round(fontScale * 100)}
      testID={testID}
      edges={edges}
      style={[styles.fill, { backgroundColor: t.s0 }]}
    >
      {scroll ? (
        // The keyboard covers the lower half of the screen; without this a focused field low on
        // the page (登录的密码框) sits under it. Android is edge-to-edge (SDK 35+), where
        // `adjustResize` no longer shrinks the window, so both platforms pad by the keyboard.
        <KeyboardAvoidingView style={styles.fill} behavior="padding">
        {pull.frame(
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.grow}
            keyboardShouldPersistTaps="handled"
            {...pull.props}
            onScroll={both(onScroll && ((e) => onScroll(e.nativeEvent.contentOffset.y)), pull.props.onScroll)}
            scrollEventThrottle={onScroll || pull.props.onScroll ? 16 : undefined}
          >
            {children}
          </ScrollView>
        )}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.fill}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** A full-width band with the gutter and a hairline under it. */
export function Block({
  children,
  style,
  last,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  last?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const { gutter } = useLayout();
  return (
    <View
      testID={testID}
      style={[styles.block, { paddingHorizontal: gutter }, !last && { borderBottomWidth: 1, borderBottomColor: t.hair }, style]}
    >
      {children}
    </View>
  );
}

/**
 * 交互与动效 第 2 轮 4b: a section's body appears — opacity 0 → 1, 4pt down into place, over
 * `sectionIn` (base 200) — and goes over `sectionOut` (fast 120). Its height changes at
 * once, never animated (no layout jump). A zero duration (reduce motion) is no animation.
 */
export function sectionTransitions(inMs: number, outMs: number) {
  return {
    entering: inMs
      ? new Keyframe({
          0: { opacity: 0, transform: [{ translateY: -4 }] },
          100: { opacity: 1, transform: [{ translateY: 0 }], easing: REasing.bezier(0, 0, 0.2, 1) },
        }).duration(inMs)
      : undefined,
    exiting: outMs ? FadeOut.duration(outMs) : undefined,
  };
}

/**
 * A titled part of a screen. With `onToggle` its header is a disclosure — a
 * button whose accessibility state says expanded or not, and nothing else. Its body
 * moves only when the soul toggles it: a section open on arrival just is.
 * `highlighted`: the block a push landed on — s1 ground and a 3pt ink rule down its left.
 */
export function Section({
  title,
  count,
  countTestID,
  open = true,
  onToggle,
  highlighted,
  onLayout,
  children,
  testID,
  index,
}: {
  title: string;
  count?: string;
  countTestID?: string;
  /**
   * v3's ledger row (life tab, 01–06): the number before the title, a ＋ that turns 45° when
   * open, and the body on the canvas behind a 3pt ink rule, growing over `sectionGrow`.
   */
  index?: number;
  open?: boolean;
  onToggle?: () => void;
  highlighted?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
  children: ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  const { gutter } = useLayout();
  const { sectionIn, sectionOut, sectionGrow } = useReducedMotionDurations();
  const [toggled, setToggled] = useState(false);
  const pad = { paddingHorizontal: gutter };
  const ledger = index !== undefined;
  const header = ledger ? (
    <>
      <Txt testID={testID ? `${testID}-index` : undefined} variant="value" tone="subtle" style={styles.ledgerIndex}>
        {String(index).padStart(2, "0")}
      </Txt>
      <Txt variant="section" style={styles.fill}>
        {title}
      </Txt>
      {count ? (
        <Txt testID={countTestID} variant="value" tone="subtle" style={styles.count}>
          {count}
        </Txt>
      ) : null}
      {onToggle ? (
        <Txt testID={testID ? `${testID}-plus` : undefined} tone="subtle" style={[styles.ledgerPlus, open && styles.ledgerPlusOpen]}>
          ＋
        </Txt>
      ) : null}
    </>
  ) : (
    <>
      <SectionLabel>{title}</SectionLabel>
      {count ? (
        <Txt testID={countTestID} variant="value" tone="subtle" style={styles.count}>
          {count}
        </Txt>
      ) : null}
      <View style={styles.fill} />
      {onToggle ? (
        <View style={{ transform: [{ rotate: open ? "0deg" : "-90deg" }] }}>
          <Icon name="chevronDown" size={13} color={t.inkSubtle} />
        </View>
      ) : null}
    </>
  );
  const motion = toggled ? sectionTransitions(sectionIn, sectionOut) : { entering: undefined, exiting: undefined };
  return (
    <View
      testID={testID}
      onLayout={onLayout}
      style={[{ borderBottomWidth: 1, borderBottomColor: t.hair }, (highlighted || ledger) && { backgroundColor: t.s1 }]}
    >
      {highlighted ? (
        <View testID={testID ? `${testID}-rule` : undefined} pointerEvents="none" style={[styles.sectionRule, { backgroundColor: t.ink }]} />
      ) : null}
      {onToggle ? (
        <Pressable
          testID={testID ? `${testID}-toggle` : undefined}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => {
            setToggled(true);
            onToggle();
          }}
          style={({ pressed }) => [styles.sectionHeader, pad, ledger && styles.ledgerHeader, pressed && styles.pressed]}
        >
          {header}
        </Pressable>
      ) : (
        <View style={[styles.sectionHeader, pad, ledger && styles.ledgerHeader]}>{header}</View>
      )}
      {open && ledger ? (
        <Grow ms={toggled ? sectionGrow : 0}>
          <View testID={testID ? `${testID}-body` : undefined} style={[styles.ledgerBody, { backgroundColor: t.s0, borderLeftColor: t.ink }]}>
            {children}
          </View>
        </Grow>
      ) : open ? (
        <Reanimated.View testID={testID ? `${testID}-body` : undefined} entering={motion.entering} exiting={motion.exiting} style={[styles.sectionBody, pad]}>
          {children}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

/**
 * v3 分节展开: a body that grows from nothing to its own height with its opacity, over `ms`
 * (RN Animated — the height cannot go to the native driver). It measures itself first (at
 * height 0, clipped), then lets go of the height once there, so content that loads later
 * is never cut. `ms` 0 (arrived open, or reduce motion): no wrapper at all.
 */
export function Grow({ ms, children }: { ms: number; children: ReactNode }) {
  const [height] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(ms ? 0 : 1));
  const [natural, setNatural] = useState<number | null>(null);
  const [done, setDone] = useState(!ms);
  // Reduce motion is answered asynchronously: a body mounted before the answer lets go at once.
  if (!ms && !done) setDone(true);
  useEffect(() => {
    if (natural === null || done) return;
    const run = Animated.parallel([
      Animated.timing(height, { toValue: natural, duration: ms, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 1, duration: ms, useNativeDriver: false }),
    ]);
    run.start(({ finished }) => finished && setDone(true));
    return () => run.stop();
  }, [natural, done, height, opacity, ms]);
  // One tree shape before and after: letting go drops the style, not the wrappers — returning the
  // bare children here remounted them (and whatever they held) the moment the growth ended.
  return (
    <Animated.View testID={done ? undefined : "grow"} style={done ? undefined : { height, opacity, overflow: "hidden" }}>
      <View onLayout={done ? undefined : (e) => natural === null && setNatural(e.nativeEvent.layout.height)}>{children}</View>
    </Animated.View>
  );
}

/** "Has not happened" — a short rule and a sentence, never a blank. */
export function Empty({ text, testID }: { text: string; testID?: string }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <View style={{ width: 26, height: 1, backgroundColor: t.hair2 }} />
      <Txt testID={testID} variant="caption" tone="subtle" style={styles.center}>
        {text}
      </Txt>
    </View>
  );
}

/**
 * 文明气质 1e: the civilization's illustration over a WHOLE-PAGE empty state —
 * 书信, 朋友圈, 申请 (and the no-rebirth variant of 申请). One drawing per
 * civilization for all three; which page it is, the language bundle says. An
 * empty section inside a page keeps `Empty`'s dash.
 */
export function PageEmptyArt() {
  const t = useTheme();
  const compact = useFlavorCompact();
  return (
    <View style={styles.emptyArt}>
      <Hero testID={`empty-hero-${t.civ}`} civ={t.civ} stroke={t.inkSubtle} compact={compact} />
    </View>
  );
}

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height: 1, backgroundColor: t.hair }, style]} />;
}

/** The section rule with the civilization's emblem in the middle. */
export function EmblemDivider() {
  const t = useTheme();
  return (
    <View style={styles.divider} accessible={false}>
      <Hairline style={styles.fill} />
      <Emblem civ={t.civ} size={16} stroke={t.hair2} strokeWidth={2.4} />
      <Hairline style={styles.fill} />
    </View>
  );
}

// ── inputs ─────────────────────────────────────────────────────────────

/**
 * The focus ring: 2px INK, offset 2 — drawn outside the field so nothing shifts;
 * square, like the field (A2). Ink, not a civilization colour (第三类 F 组, A1): a
 * focused field must not read as a refused one.
 */
function FocusRing({ focused, children }: { focused: boolean; children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.ring, { borderColor: focused ? t.ink : "transparent" }]}>{children}</View>;
}

/** A1 "按下": a fill darkened toward black by `amount` — contrast with its light text only rises. */
export function shade(hex: string, amount = 0.24): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((n >> s) & 255) * (1 - amount)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The checked mark of a radio (a circle — A2's exception) or a switch (square),
 * per A1: checked is solid ink, unchecked an ink3 outline; disabled is s2 with a
 * hairline. The row around it is the caller's, and carries the role and state.
 */
export function RadioMark({ on, disabled }: { on: boolean; disabled?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.radio, disabled ? { borderColor: t.hair, backgroundColor: t.s2 } : { borderColor: on ? t.ink : t.inkSubtle }]}>
      {on ? <View style={[styles.radioDot, { backgroundColor: disabled ? t.inkSubtle : t.ink }]} /> : null}
    </View>
  );
}

export function SwitchMark({ on, large }: { on: boolean; large?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        large ? styles.trackLarge : styles.track,
        { borderColor: on ? t.ink : t.inkSubtle, backgroundColor: on ? t.ink : "transparent" },
        on ? styles.trackOn : null,
      ]}
    >
      <View style={[large ? styles.knobLarge : styles.knob, { backgroundColor: on ? t.s0 : t.inkSubtle }]} />
    </View>
  );
}

export function Input({
  label,
  labelAside,
  hint,
  error,
  invalid,
  mono,
  secureToggle,
  multiline,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & {
  label: string;
  /** Beside the label, at its right: a link (「忘记密码」) or a live value (a countdown). */
  labelAside?: ReactNode;
  hint?: string;
  /** Shown under the field, in the error ink; also turns the border red. */
  error?: string | null;
  invalid?: boolean;
  mono?: boolean;
  secureToggle?: { show: string; hide: string };
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const bad = invalid || !!error;
  // A1 输入: disabled = s2 ground, hairline, ink3 text, not focusable; error = 2px neg; focus = ink.
  const off = rest.editable === false;
  const box = off
    ? { backgroundColor: t.s2, borderColor: t.hair }
    : { backgroundColor: t.s1, borderColor: bad ? t.neg : focused ? t.ink : t.inkSubtle, borderWidth: bad ? 2 : 1 };
  const text = typeof rest.value === "string" ? rest.value : "";
  const fontFamily = multiline ? quoteFamily(text || (rest.placeholder ?? "")) : mono ? family.mono[500] : family.mono[400];
  // Handoff 2d: at ≥ 1.7× text the reveal leaves the field's right edge for a full-width row under it.
  const { stack } = useLayout();
  const reveal = secureToggle ? (
    <Pressable
      testID={rest.testID ? `${rest.testID}-reveal` : undefined}
      accessibilityRole="button"
      onPress={() => setRevealed((v) => !v)}
      style={stack ? [styles.revealRow, { borderColor: t.hair, backgroundColor: t.s1 }] : [styles.reveal, { borderLeftColor: t.hair }]}
    >
      <Txt variant="label" tone="muted" style={styles.noSpacing}>
        {revealed ? secureToggle.hide : secureToggle.show}
      </Txt>
    </Pressable>
  ) : null;
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Txt variant="label" tone="muted" style={styles.shrink}>
          {label}
        </Txt>
        {labelAside}
      </View>
      <FocusRing focused={focused && !off}>
        <View style={[styles.inputBox, box]}>
          <TextInput
            accessibilityLabel={label}
            placeholderTextColor={t.inkSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            multiline={multiline}
            // Caret and handles in ink, like the focus ring — not the platform accent,
            // which here reads as the seal red of an error. On Android `selectionColor`
            // would also paint the selection box solid ink over ink text, so there only
            // the caret and the handles are set.
            cursorColor={t.ink}
            selectionHandleColor={t.ink}
            selectionColor={Platform.OS === "ios" ? t.ink : undefined}
            {...rest}
            secureTextEntry={secureToggle ? rest.secureTextEntry && !revealed : rest.secureTextEntry}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            style={[
              styles.input,
              { color: off ? t.inkSubtle : t.ink, fontFamily },
              mono && styles.monoInput,
              multiline && styles.multiline,
              style,
            ]}
          />
          {secureToggle && !stack ? reveal : null}
        </View>
      </FocusRing>
      {secureToggle && stack ? reveal : null}
      {error ? <FieldError text={error} /> : hint ? <Txt variant="label" tone="subtle" style={styles.noSpacing}>{hint}</Txt> : null}
    </View>
  );
}

export function FieldError({ text, testID }: { text: string; testID?: string }) {
  const t = useTheme();
  return (
    <View style={styles.iconRow} accessibilityRole="alert">
      <View style={styles.iconNudge}>
        <Icon name="alert" size={14} color={t.neg} />
      </View>
      <Txt testID={testID} variant="caption" tone="negInk" style={styles.fill}>
        {text}
      </Txt>
    </View>
  );
}

// ── buttons ────────────────────────────────────────────────────────────

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  busy,
  reason,
  reasonTestID,
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  /** Why it is disabled. Required reading, not a tooltip: a phone has no hover. */
  reason?: ReactNode;
  reasonTestID?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const inert = disabled || busy;
  // A1 按钮: primary = the plaque (one of its five places); danger = solid neg.strong
  // under white, always with ✕; secondary = ghost, ink3 outline. Disabled and busy:
  // s2 ground, ink3 text, same opacity. Pressed: fills darken 24%, the ghost takes hair.
  const look = inert
    ? { bg: t.s2, border: t.s2, ink: t.inkSubtle, pressed: t.s2 }
    : kind === "primary"
      ? { bg: t.plaqueFill, border: t.plaqueFill, ink: t.onPlaque, pressed: shade(t.plaqueFill) }
      : kind === "danger"
        ? { bg: t.negStrong, border: t.negStrong, ink: "#FFFFFF", pressed: shade(t.negStrong) }
        : { bg: "transparent", border: t.inkSubtle, ink: t.ink, pressed: t.hair };
  return (
    <View style={[styles.buttonWrap, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!inert, busy: !!busy }}
        disabled={inert}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: pressed ? look.pressed : look.bg, borderColor: pressed && kind !== "secondary" ? look.pressed : look.border },
        ]}
      >
        {busy ? <Loader size={20} /> : kind === "danger" ? <Icon name="close" size={14} color={look.ink} strokeWidth={1.6} /> : null}
        <Text numberOfLines={2} style={[styles.buttonText, { color: look.ink }]}>
          {title}
        </Text>
      </Pressable>
      {reason && inert ? <DisabledReason testID={reasonTestID}>{reason}</DisabledReason> : null}
    </View>
  );
}

/** The sentence under a control that cannot be used right now. Body text, not an error. */
export function DisabledReason({ children, testID }: { children: ReactNode; testID?: string }) {
  const t = useTheme();
  return (
    <View style={styles.iconRow}>
      <View style={styles.iconNudge}>
        <Icon name="info" size={14} color={t.inkSubtle} strokeWidth={1.2} />
      </View>
      <Txt testID={testID} variant="caption" tone="muted" style={styles.fill}>
        {children}
      </Txt>
    </View>
  );
}

// ── notices ────────────────────────────────────────────────────────────

/**
 * A boxed message with a 3px left rule. `neg` for a refusal, `neutral` for a
 * condition that is not the user's fault (rate limit, offline) — optionally with
 * a retry on its right.
 */
export function Notice({
  tone,
  children,
  onRetry,
  testID,
}: {
  tone: "neg" | "neutral";
  children: ReactNode;
  onRetry?: () => void;
  testID?: string;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const neg = tone === "neg";
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { borderColor: neg ? t.negStrong : t.hair2, backgroundColor: neg ? t.negBg : t.s1 }]}
    >
      {neg ? (
        <View style={styles.iconNudge}>
          <Icon name="alert" size={15} color={t.neg} />
        </View>
      ) : null}
      <Txt testID={testID} variant="caption" tone={neg ? "negInk" : "muted"} style={styles.fill}>
        {children}
      </Txt>
      {onRetry ? <SmallButton title={tr("soul_app.common.retry")} onPress={onRetry} /> : null}
    </View>
  );
}

export function SmallButton({ title, onPress, testID }: { title: string; onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.small, { borderColor: t.inkSubtle }, pressed && { backgroundColor: t.hair }]}
    >
      <Txt variant="label" style={styles.noSpacing}>
        {title}
      </Txt>
    </Pressable>
  );
}

/** The whole screen could not load: say that the record still exists, offer a retry, show the code. */
export function ScreenError({ error, onRetry }: { error: SoulErrorMessage; onRetry: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [at] = useState(() => new Date());
  const code = error.params?.code ?? error.key.split(".").pop();
  const clock = [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  return (
    <View style={styles.screenError}>
      <LedgerUnreachable size={34} stroke={t.inkSubtle} />
      <Txt variant="nav" style={styles.center}>
        {tr("soul_app.errors.screen_title")}
      </Txt>
      <Txt variant="caption" tone="subtle" style={styles.center}>
        {tr("soul_app.errors.screen_body")}
      </Txt>
      <Txt testID="failure" accessibilityRole="alert" variant="caption" tone="muted" style={styles.center}>
        {tr(error.key, error.params)}
      </Txt>
      <Button kind="secondary" title={tr("soul_app.common.retry")} onPress={onRetry} style={styles.retry} />
      <Txt variant="value" tone="subtle" style={styles.errorCode}>
        {`${code} · ${clock}`}
      </Txt>
    </View>
  );
}

/**
 * One part of a screen failed; the rest renders as usual. 补足 C15: said in 冷玫红 with a
 * ✕ — an error is the system failing, the one thing neg is for — and a retry beside it.
 */
export function SectionError({ onRetry, testID }: { onRetry: () => void; testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.sectionBody}>
      <FailedLine text={t("soul_app.errors.section")} onRetry={onRetry} testID={testID} />
    </View>
  );
}

/** "✕ 没能载入 …" in neg, and a ghost retry (补足 C15 空 · 出错 · 无权限). */
export function FailedLine({ text, onRetry, testID, retryTestID }: { text: string; onRetry: () => void; testID?: string; retryTestID?: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View accessibilityRole="alert" style={styles.failed}>
      <Text style={[styles.failedText, { color: theme.neg }]}>✕</Text>
      <Text testID={testID} style={[styles.failedText, styles.fill, { color: theme.neg }]}>
        {text}
      </Text>
      <SmallButton testID={retryTestID} title={t("soul_app.common.retry")} onPress={onRetry} />
    </View>
  );
}

// ── values ─────────────────────────────────────────────────────────────

export function DataRows({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.rows, style]}>{children}</View>;
}

/**
 * Label and value. A label longer than 18 characters (EN / egy) puts the value
 * on its own line instead of squeezing both. A mono value is never shortened.
 */
export function DataRow({
  label,
  children,
  mono,
  testID,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  testID?: string;
}) {
  const { compact } = useLayout();
  // Two lines for a long label (EN / egy), and for every row on a narrow screen (handoff 2c).
  const stacked = compact || stacksLabel(label);
  const value =
    isValidElement(children) && typeof (children as ReactElement).type !== "string" ? (
      children
    ) : (
      <Txt variant={mono ? "value" : "body"} tone="muted" style={!stacked && styles.fill}>
        {children}
      </Txt>
    );
  return (
    <View testID={testID} style={stacked ? styles.rowStacked : styles.row}>
      <Txt variant="caption" tone="subtle" style={stacked ? undefined : styles.rowLabel}>
        {label}
      </Txt>
      <View style={stacked ? undefined : styles.fill}>{value}</View>
    </View>
  );
}

/** The string form of an enum, for where a component cannot go (a translation parameter). */
export function enumText(d: EnumDisplay, t: (key: string) => string): string {
  if (d.state === "missing") return t("common.value.unrecorded");
  return d.state === "unrecognized" ? `${d.label} (${d.raw})` : d.label;
}

/**
 * An enum as a value. A member the bundles cannot name is shown as the
 * "unrecognized value" badge WITH the raw member in mono — never dropped and
 * never a dotted key. A missing value says "not recorded".
 */
export function EnumValue({
  namespace,
  value,
  tone = "muted",
  variant = "body",
}: {
  namespace: string;
  value: string | null | undefined;
  tone?: Tone;
  variant?: keyof typeof TYPE;
}) {
  const { enumLabel, t } = useI18n();
  const d = enumLabel(namespace, value);
  if (d.state === "known") return <Txt variant={variant} tone={tone}>{d.label}</Txt>;
  if (d.state === "missing") return <Txt variant={variant} tone="subtle">{t("common.value.unrecorded")}</Txt>;
  return <Badge spec={badgeSpec({}, d.raw, false)} label={d.label} raw={d.raw} />;
}

export function Badge({ spec, label, raw, testID }: { spec: BadgeSpec; label: string; raw?: string | null; testID?: string }) {
  const t = useTheme();
  // 补足 C15: ink words, an ink3 frame, s2 under what is still pending — no status colour.
  const color = t.ink;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={raw ? `${label} ${raw}` : label}
      // Only the raw member may wrap onto its own line. A known pill never wraps: laid
      // out at exactly its own content width (a pill in a row), iOS measures the label a
      // hair wider and a wrapping pill puts the glyph over the label.
      style={[
        styles.badge,
        raw ? styles.badgeWraps : null,
        { borderColor: t.inkSubtle, borderStyle: spec.border, backgroundColor: spec.pending ? t.s2 : "transparent" },
      ]}
    >
      <Text testID={testID ? `${testID}-glyph` : undefined} style={[styles.badgeText, styles.badgeGlyph, { color }]}>{spec.glyph}</Text>
      <Text style={[styles.badgeText, styles.shrink, { color }]}>{label}</Text>
      {raw ? <Text style={[styles.badgeRaw, { color }]}>{raw}</Text> : null}
    </View>
  );
}

/** A status pill for an enum namespace, shaped by `table`. */
export function EnumBadge({
  namespace,
  table,
  value,
  label: lexiconLabel,
  testID,
}: {
  namespace: string;
  table: Record<string, BadgeSpec>;
  value: string | null | undefined;
  /** A civilization's own word for a KNOWN member (Egypt's 称心中); never replaces the unknown shape. */
  label?: string;
  testID?: string;
}) {
  const { enumLabel, t } = useI18n();
  const d = enumLabel(namespace, value);
  const spec = badgeSpec(table, d.raw, d.state === "known");
  const label = d.state === "known" && !spec.unknown ? (lexiconLabel ?? d.label) : d.state === "missing" ? t("common.value.unrecorded") : t("common.value.unrecognized");
  return <Badge testID={testID} spec={spec} label={label} raw={spec.unknown ? d.raw : null} />;
}

/** Han characters (the same ranges `fonts.ts` picks the Han serif by): the one content language the app can name. */
const HAN = /[㐀-鿿豈-﫿]/;

/**
 * Words someone said: a statement, an appeal, a rejection reason. The only place
 * the serif appears. Handoff 4a rule 二: switching the interface language never
 * translates these — each carries a hairline "原文" tag (naming the language when
 * it can tell), and a line saying so when the interface is in another language.
 */
export function Quote({ text, tone = "neutral", testID }: { text: string; tone?: "neutral" | "appeal" | "rejection"; testID?: string }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const { compact } = useLayout();
  const line = tone === "rejection" ? t.negStrong : tone === "appeal" ? t.ink : t.hair2;
  const han = HAN.test(text);
  return (
    <View style={[styles.quote, compact && styles.quoteCompact, { borderLeftColor: line }]}>
      <Text
        testID={testID}
        style={[styles.quoteText, { fontFamily: quoteFamily(text), color: tone === "rejection" ? t.ink : t.inkMuted }]}
      >
        {text}
      </Text>
      <View style={styles.original}>
        <View style={[styles.originalTag, { borderColor: t.hair2 }]}>
          <Txt testID="original-tag" variant="label" tone="subtle" style={styles.originalText}>
            {han ? tr("soul_app.original.tag_language", { language: tr("soul_app.original.zh") }) : tr("soul_app.original.tag")}
          </Txt>
        </View>
        {han && locale !== "zh-Hans" ? (
          <Txt testID="original-note" variant="caption" tone="subtle" style={styles.shrink}>
            {tr("soul_app.original.note")}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

// ── loading ────────────────────────────────────────────────────────────

/** 补足 C15: s2 bars in the shape of what is coming — static, no shimmer. */
export function Skeleton({ lines = 3, testID }: { lines?: number; testID?: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const widths = ["70%", "90%", "50%", "80%", "60%"] as const;
  return (
    <View testID={testID} accessible accessibilityLabel={tr("soul_app.common.loading")} style={styles.skeleton}>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={{ width: widths[i % widths.length], height: 12, backgroundColor: t.s2 }} />
      ))}
    </View>
  );
}

/**
 * 文明气质 1h: waiting is the civilization's compact illustration breathing —
 * opacity 0.35 ↔ 1 over 1.6s, ease-in-out; never a rotation or a scale. Under
 * reduce-motion it stands still at full opacity. It still says what it is: a
 * busy progress indicator named "loading".
 */
export function Loader({ size = 28, testID }: { size?: number; testID?: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    if (reduced) return;
    const half = { duration: motion.breath / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true };
    const breath = Animated.loop(
      Animated.sequence([Animated.timing(opacity, { toValue: 1, ...half }), Animated.timing(opacity, { toValue: 0.35, ...half })])
    );
    breath.start();
    return () => breath.stop();
  }, [opacity, reduced]);
  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={tr("soul_app.common.loading")}
      accessibilityState={{ busy: true }}
      style={{ opacity: reduced ? 1 : opacity }}
    >
      <Hero civ={t.civ} stroke={t.inkSubtle} compact size={size} />
    </Animated.View>
  );
}

// ── data ───────────────────────────────────────────────────────────────

/** Loading / error / data for one request, with a `reload` for pull-to-refresh and retry. */
export function useRemote<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(
    () =>
      fetcher()
        .then(
          (value) => {
            setData(value);
            setError(null);
          },
          (e: unknown) => setError(e)
        )
        .finally(() => setLoading(false)),
    [fetcher]
  );
  useEffect(() => {
    void run();
  }, [run]);
  const reload = useCallback(() => {
    setLoading(true);
    return run();
  }, [run]);
  return { data, error, loading, reload };
}

/**
 * Tab screens stay mounted, so data loaded once goes stale when the other tab
 * changes it (seen on the iPhone run: a just-submitted application missing from
 * the life tab). Reload on every focus AFTER the first — the first is the mount,
 * which `useRemote` already loads.
 */
export function useReloadOnRefocus(reload: () => unknown) {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void reload();
    }, [reload])
  );
  useReloadOnReconnect(reload);
}

/** Back online (network.tsx): whatever failed while offline loads again, focused or not. */
export function useReloadOnReconnect(reload: () => unknown) {
  const { back } = useOnline();
  const seen = useRef(back);
  useEffect(() => {
    if (back === seen.current) return; // a new `reload` alone is not a return to the network
    seen.current = back;
    void reload();
  }, [back, reload]);
}

export const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  grow: { flexGrow: 1 },
  center: { textAlign: "center" },
  pressed: { opacity: 0.8 },
  noSpacing: { letterSpacing: 0 },
  pullIndicator: { position: "absolute", top: 0, left: 0, right: 0, height: PULL_REFRESH_PT, alignItems: "center", justifyContent: "center" },
  pullGlyph: { fontFamily: family.glyph, fontSize: 20, lineHeight: 24 },
  block: { paddingHorizontal: GUTTER, paddingVertical: GUTTER },
  count: { marginLeft: space[3], fontSize: 11, lineHeight: 16 },
  sectionRule: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  // B11: a section's title row is 48 high.
  sectionHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER, paddingVertical: space[3] },
  sectionBody: { paddingHorizontal: GUTTER, paddingBottom: space[4] },
  /** v3 .life-records: a 60pt row — number, title, count, ＋. */
  ledgerHeader: { minHeight: 60 },
  ledgerIndex: { width: 30, fontSize: 11, lineHeight: 16 },
  ledgerPlus: { width: 24, textAlign: "right", fontSize: 15, lineHeight: 20 },
  ledgerPlusOpen: { transform: [{ rotate: "45deg" }] },
  ledgerBody: { marginHorizontal: space[3], marginBottom: space[3], paddingHorizontal: space[4], paddingVertical: space[3], borderLeftWidth: 3 },
  empty: { alignItems: "center", gap: space[2], paddingVertical: space[4] },
  emptyArt: { alignSelf: "center", marginBottom: space[2] },
  divider: { flexDirection: "row", alignItems: "center", gap: space[3] },
  field: { gap: space[2] },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  // The ring sits 4pt outside the field, so its corner is the field's plus 4.
  ring: { margin: -4, padding: 2, borderWidth: 2, borderRadius: radius.control + 4 },
  inputBox: { flexDirection: "row", borderWidth: 1, minHeight: 48, borderRadius: radius.control, overflow: "hidden" },
  input: { flex: 1, minHeight: 46, paddingHorizontal: space[3], fontSize: 15 },
  monoInput: { fontSize: 15, letterSpacing: 2.2 },
  multiline: { minHeight: 128, paddingVertical: space[3], fontSize: 15, lineHeight: 24, textAlignVertical: "top" },
  reveal: { width: 52, alignItems: "center", justifyContent: "center", borderLeftWidth: 1 },
  revealRow: { minHeight: 60, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: radius.control },
  iconRow: { flexDirection: "row", gap: space[2], alignItems: "flex-start" },
  iconNudge: { marginTop: 4 },
  buttonWrap: { gap: space[3] },
  // A1: App buttons are 44 high, 13 / 600 — one size for all three kinds.
  button: {
    minHeight: 44,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  buttonText: { fontFamily: family.ui[600], fontSize: 13, lineHeight: 20, letterSpacing: 0.6, textAlign: "center" },
  notice: { flexDirection: "row", alignItems: "center", gap: space[2], borderWidth: 1, borderLeftWidth: 3, paddingVertical: space[3], paddingHorizontal: space[3] },
  failed: { flexDirection: "row", alignItems: "center", gap: space[2] },
  failedText: { fontFamily: family.ui[600], fontSize: 13, lineHeight: 20 },
  small: { borderWidth: 1, paddingHorizontal: space[3], paddingVertical: space[2] },
  screenError: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], paddingHorizontal: space[6], paddingVertical: space[7] },
  retry: { alignSelf: "stretch", marginTop: space[1] },
  errorCode: { fontSize: 11, opacity: 0.8 },
  rows: { gap: space[2] },
  row: { flexDirection: "row", gap: space[4], alignItems: "flex-start" },
  rowStacked: { flexDirection: "column", gap: space[1] },
  rowLabel: { minWidth: 56, maxWidth: "45%" },
  // Square since v2 (A2: only the lamp and a drawer handle are pills).
  badge: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    columnGap: space[2],
    borderWidth: 1,
    borderRadius: radius.none,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  badgeWraps: { flexWrap: "wrap" },
  badgeText: { fontFamily: family.ui[500], fontSize: 12, lineHeight: 18, letterSpacing: 0.9 },
  // Design E 组: every status glyph from the one bundled font, never a per-glyph OS fallback.
  badgeGlyph: { fontFamily: family.glyph, letterSpacing: 0 },
  badgeRaw: { fontFamily: family.mono[400], fontSize: 11, lineHeight: 16, opacity: 0.85 },
  quote: { borderLeftWidth: 2, paddingLeft: space[4], paddingVertical: 2 },
  quoteText: { fontSize: 15, lineHeight: 28 },
  quoteCompact: { paddingLeft: space[3] },
  original: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], marginTop: space[2] },
  originalTag: { borderWidth: 1, borderStyle: "dashed", paddingHorizontal: space[1], paddingVertical: 2 },
  originalText: { fontSize: 11, lineHeight: 16, letterSpacing: 0.4 },
  skeleton: { gap: space[3], paddingVertical: space[4] },
  radio: { width: 16, height: 16, borderWidth: 1.5, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 8, height: 8, borderRadius: radius.pill },
  track: { width: 44, height: 26, borderWidth: 1.5, padding: 2, justifyContent: "center" },
  trackLarge: { width: 58, height: 34, borderWidth: 1.5, padding: 4, justifyContent: "center" },
  trackOn: { alignItems: "flex-end" },
  knob: { width: 18, height: 18 },
  knobLarge: { width: 24, height: 24 },
});
