/**
 * The soul app's primitives, per the design handoff "灵魂簿 App", restyled for
 * v2「朱印」(补足 A1 component states, A2 rules, A3 type):
 *
 *   radius per v4 (`radius` in theme.ts): a control 4 (input, button, badge), a panel, dialog or
 *   sheet 6, and the pill / circle (the lamp, a drawer handle, a radio, an avatar); the focus
 *   ring follows its element;
 *   depth is 1px hairlines between two surfaces, never a shadow or elevation;
 *   pressed is a darker ground (A1: fills darken 24% toward black, ghosts take
 *   `hair`), never an Android ripple, whose colour cannot be held to contrast;
 *   checked controls are solid ink, never the plaque (匾色 is for five places only);
 *   motion runs on the four tiers 80 / 160 / 240 / 320 and the two named curves, never a bounce; reduce motion
 *   stills every movement and keeps an 80ms fade where one says what changed (`useReducedMotionDurations`).
 */
import type { SoulErrorMessage } from "@soulledger/core/api/soul";
import type { EnumDisplay } from "@soulledger/core/domain/enumDisplay";
import { useFocusEffect } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
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
  Dimensions,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type ModalProps,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
  useWindowDimensions,
} from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { Easing as REasing, FadeOut, Keyframe } from "react-native-reanimated";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { notify } from "@soulledger/core/platform";
import { formatAsOf, hhmm } from "@soulledger/core/domain/dates";

import { Emblem, Hero, Icon, LedgerUnreachable } from "./emblems";
import { family, quoteFamily } from "./fonts";
import { useI18n } from "./i18n";
import { useOnline } from "./online";
import { STACK_FONT_SCALE, badgeSpec, layoutFor, stacksLabel, type BadgeSpec, type Layout } from "./layout";
import { GUTTER_PT, HIGHLIGHT_ALPHA, curves, motion, radius, space, themeFor, touch, type Theme } from "./theme";

// ── theme & motion ─────────────────────────────────────────────────────

/**
 * Inside a `Sheet`, an `Input` renders @gorhom's `BottomSheetTextInput`: only that one tells the sheet
 * which field has focus, and without it the sheet never lifts above the keyboard (reason fields were covered, 2026-10-17).
 */
/**
 * Keyboard for a field typed in Latin letters (soul codes, recovery codes). iOS has "ascii-capable"; Android has no such
 * type and falls back to the default keyboard, where a pinyin IME (Sogou on Huawei) composes the letters into words.
 * "visible-password" is Android's Latin keyboard. `Input` applies this itself; hand-written TextInputs use this constant.
 */
export const LATIN_KEYBOARD = Platform.OS === "android" ? ("visible-password" as const) : ("ascii-capable" as const);

export const InSheetContext = createContext(false);
/** Inside a `Sheet`: bring a focused field (and ~one button below it) above the keyboard. */
export const SheetRevealContext = createContext<((field: TextInput | null) => void) | null>(null);

export const ThemeContext = createContext<Theme>(themeFor(null, "dark"));
export const useTheme = () => useContext(ThemeContext);

/**
 * The last answer the OS gave, for the first render of whatever mounts later (a toast, a modal, content after its
 * skeleton): the OS answers asynchronously, and each of them otherwise started its first frame with full motion.
 */
let lastReduced = false;

/** The OS "reduce motion" setting, live. */
export function useReducedMotion(): boolean {
  const [reduced, setReducedState] = useState(lastReduced);
  useEffect(() => {
    let alive = true;
    const setReduced = (value: boolean) => {
      lastReduced = value;
      setReducedState(value);
    };
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
/** Waits, not movement: a toast still stays up long enough to read, a skeleton still waits and holds. */
const WAITS: ReadonlySet<string> = new Set(["skeletonDelay", "skeletonHold", "busyDelay"]);
/**
 * 第五十八批 M3: under reduce motion these keep an 80ms fade — a page or tab, a toast, content after its skeleton.
 * Opacity only: each caller drops its translate under reduce motion. (A sheet moves; it stays 0.)
 */
export const REDUCED_FADES: readonly (keyof typeof motion)[] = ["fade", "toastIn", "toastOut", "tabFade", "dialogIn", "dialogOut", "reduced"];
const STILL: Durations = Object.fromEntries(
  Object.entries(motion).map(([key, ms]) => [
    key,
    key.endsWith("Hold") || WAITS.has(key) ? ms : (REDUCED_FADES as readonly string[]).includes(key) ? motion.reduced : 0,
  ])
) as Durations;

/**
 * `motion`'s durations, for `Animated` or Reanimated alike — under the OS "reduce motion" setting every movement 0,
 * the fades in `REDUCED_FADES` 80 (第五十八批 M3), holds and waits unchanged.
 */
export function useReducedMotionDurations(): Durations {
  return useReducedMotion() ? STILL : motion;
}

/** The general curves (the web's --ease-*) as RN `Animated` easings. */
export const EASE = {
  standard: Easing.bezier(...curves.standard),
  enter: Easing.bezier(...curves.enter),
  exit: Easing.bezier(...curves.exit),
} as const;

/**
 * A push's landing ground (第四十批 S-e, 「同其他推送的 2 秒底色」), one recipe on every landing in both apps and
 * as the web's `row-changed`: opacity 1 held for `highlight - highlightFade` (1600), then 0 over `highlightFade`
 * (400) on the exit curve, 2s in all. Each caller keeps its own colour. Under reduce motion the caller draws no ground.
 */
export function useLandingFade(on: boolean, reduced: boolean): Animated.Value {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!on || reduced) return;
    const fade = Animated.timing(opacity, { toValue: 0, duration: motion.highlightFade, easing: EASE.exit, useNativeDriver: true });
    const timer = setTimeout(() => fade.start(), motion.highlight - motion.highlightFade);
    return () => {
      clearTimeout(timer);
      fade.stop();
    };
  }, [on, reduced, opacity]);
  return opacity;
}

/**
 * Fades its content in over `fade` (the web's reveal, 160, enter curve) when it mounts — content after its skeleton
 * (第五十八批 M7); 80 under reduce motion (M3).
 */
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
    Animated.timing(opacity, { toValue: 1, duration: fade, easing: EASE.enter, useNativeDriver: true }).start();
  }, [opacity, fade]);
  return (
    <Animated.View onLayout={onLayout} style={[{ opacity }, style]}>
      {children}
    </Animated.View>
  );
}

/** False until `ms` after mount, then true: a wait before something appears (a skeleton, a busy line). */
export function useAfter(ms: number): boolean {
  const [past, setPast] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const timer = setTimeout(() => setPast(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return past;
}

/**
 * The wait `useRemote` adds before painting an answer, so a skeleton that has appeared stays its 300 (第五十八批 M6).
 * `since`: ms since a load with nothing on screen started. Under 400 the skeleton never showed: none. Past 700: none.
 */
export function skeletonHoldLeft(since: number): number {
  return since > motion.skeletonDelay ? Math.max(0, motion.skeletonDelay + motion.skeletonHold - since) : 0;
}

/**
 * 第五十八批 M8: a refresh of what is already on screen — back online, a version bump, a refocus, a push, a released
 * pull — runs the top line (civHead.tsx `Topline`) once. No spinner. `runTopline()` from anywhere; `Topline` listens.
 */
const toplineListeners = new Set<() => void>();
export function runTopline(): void {
  toplineListeners.forEach((fn) => fn());
}
/** A counter that goes up on every `runTopline()`. */
export function useToplineRuns(): number {
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    const fn = () => setRuns((n) => n + 1);
    toplineListeners.add(fn);
    return () => {
      toplineListeners.delete(fn);
    };
  }, []);
  return runs;
}

/**
 * 第五十八批 M4: an RN `Modal` (a confirmation, a photo viewer) that fades on the shared values — in over `dialogIn`
 * (240, enter curve), out over `dialogOut` (160, exit curve), both 80 under reduce motion (not a cut: a whole layer
 * appearing at once is harsher than an 80 fade). RN's own `animationType="fade"` has a fixed length and ignores
 * reduce motion, so this one is always `animationType="none"` and `transparent`, the content carrying its own ground.
 * It stays up through its fade-out.
 *
 * 第六十批 P6, a photo viewer (`closeTo`: the thumbnail key of the photo in front, see `thumbRef`): closing shrinks the
 * layer back onto that thumbnail over `photoClose` (160, exit curve), fading as it goes; a thumbnail off screen or gone
 * fades in place over the same 160; under reduce motion an 80 fade, as any modal.
 */
export function FadeModal({
  visible,
  closeTo,
  closeFrom,
  children,
  ...rest
}: Omit<ModalProps, "animationType" | "transparent"> & { visible: boolean; closeTo?: () => string | null; closeFrom?: () => Rect | null }) {
  const { dialogIn, dialogOut } = useReducedMotionDurations();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const [opacity] = useState(() => new Animated.Value(0));
  const [shrink] = useState(() => new Animated.Value(0));
  const [onto, setOnto] = useState<PhotoShrink | null>(null);
  // What it showed last while open: callers drop their content with `visible`, and a fade (or a shrink) of an empty
  // layer would show nothing leaving.
  const [held, setHeld] = useState<ReactNode>(children);
  if (visible && held !== children) setHeld(children);
  const closeToRef = useRef(closeTo);
  const closeFromRef = useRef(closeFrom);
  useEffect(() => {
    closeToRef.current = closeTo;
    closeFromRef.current = closeFrom;
  });
  useEffect(() => {
    if (!mounted) return;
    let run: Animated.CompositeAnimation | null = null;
    const play = (target: PhotoShrink | null, ms: number) => {
      setOnto(target);
      const out = { toValue: visible ? 1 : 0, duration: ms, easing: visible ? EASE.enter : EASE.exit, useNativeDriver: true };
      run = Animated.parallel([
        Animated.timing(opacity, out),
        ...(target ? [Animated.timing(shrink, { toValue: 1, duration: ms, easing: EASE.exit, useNativeDriver: true })] : []),
      ]);
      run.start(({ finished }) => finished && !visible && setMounted(false));
    };
    if (visible) {
      shrink.setValue(0);
      play(null, dialogIn);
      return () => run?.stop();
    }
    if (reduced || !closeToRef.current) {
      play(null, dialogOut);
      return () => run?.stop();
    }
    const key = closeToRef.current();
    const node = key ? thumbNodes.get(key) : undefined;
    // Fabric answers measureInWindow synchronously; a host that does not (a test double) gets the fade in place.
    let thumb: Rect | null = null;
    node?.measureInWindow((x, y, width, height) => {
      thumb = { x, y, width, height };
    });
    play(thumb ? photoShrinkTo(thumb, Dimensions.get("window"), closeFromRef.current?.()) : null, motion.photoClose);
    return () => run?.stop();
  }, [visible, mounted, opacity, shrink, dialogIn, dialogOut, reduced]);
  const transform = onto
    ? [
        { translateX: shrink.interpolate({ inputRange: [0, 1], outputRange: [0, onto.dx] }) },
        { translateY: shrink.interpolate({ inputRange: [0, 1], outputRange: [0, onto.dy] }) },
        { scale: shrink.interpolate({ inputRange: [0, 1], outputRange: [1, onto.scale] }) },
      ]
    : undefined;
  return (
    <Modal {...rest} visible={mounted} transparent animationType="none">
      <Animated.View testID="fade-modal" style={[styles.fill, { opacity, transform }]}>
        {visible ? children : held}
      </Animated.View>
    </Modal>
  );
}

type Rect = { x: number; y: number; width: number; height: number };
export type PhotoShrink = { dx: number; dy: number; scale: number };
/**
 * 第六十批 P6: the move that lays a full-window layer onto `thumb` (window coordinates), or null -- fade in place --
 * when the thumbnail is not on screen at all (scrolled away) or has no size (gone).
 */
export function photoShrinkTo(thumb: Rect, window: { width: number; height: number }, from?: Rect | null): PhotoShrink | null {
  if (!(thumb.width > 0 && thumb.height > 0 && window.width > 0 && window.height > 0)) return null;
  const off = thumb.x + thumb.width <= 0 || thumb.y + thumb.height <= 0 || thumb.x >= window.width || thumb.y >= window.height;
  if (off) return null;
  const cx = window.width / 2;
  const cy = window.height / 2;
  if (from && from.width > 0 && from.height > 0) {
    // The photo itself, not the window, lands on the tile, fitted inside it. The layer scales about the window's centre,
    // so a point p goes to c + s(p - c) + d. Before this the whole window was laid on the tile: a 4:3 photo under the
    // 48 pt bar landed low and spilled past a square tile's edge (iPhone 17, 2026-11-21).
    const scale = Math.min(thumb.width / from.width, thumb.height / from.height);
    return {
      dx: thumb.x + thumb.width / 2 - cx - scale * (from.x + from.width / 2 - cx),
      dy: thumb.y + thumb.height / 2 - cy - scale * (from.y + from.height / 2 - cy),
      scale,
    };
  }
  return { dx: thumb.x + thumb.width / 2 - cx, dy: thumb.y + thumb.height / 2 - cy, scale: Math.max(thumb.width / window.width, thumb.height / window.height) };
}

/** Where a `contain`-fitted picture of `size` actually sits inside `box`. */
export function containRect(box: Rect, size: { width: number; height: number }): Rect {
  if (!(size.width > 0 && size.height > 0)) return box;
  const s = Math.min(box.width / size.width, box.height / size.height);
  const width = size.width * s;
  const height = size.height * s;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** The photo in front of a viewer, as `FadeModal`'s `closeTo` reads it: the pages call `setFront(id)` as they turn. */
export function useFrontPhoto(prefix: string) {
  const front = useRef<string | null>(null);
  const nodes = useRef(new Map<string, View>());
  const sizes = useRef(new Map<string, { width: number; height: number }>());
  const closeTo = useCallback(() => (front.current ? `${prefix}:${front.current}` : null), [prefix]);
  const setFront = useCallback((id: string | null) => {
    front.current = id;
  }, []);
  /** Each page's picture: `attach` as the ref of the box it fills, `onLoad` on the image, so a close starts from the picture itself. */
  const framePhoto = useCallback(
    (id: string) => ({
      attach: (node: View | null) => {
        if (node) nodes.current.set(id, node);
        else nodes.current.delete(id);
      },
      onLoad: (e: { source?: { width: number; height: number } }) => {
        if (e?.source) sizes.current.set(id, { width: e.source.width, height: e.source.height });
      },
    }),
    []
  );
  /** The picture in front where it actually shows (window coordinates); its box when the size is not known yet. */
  const closeFrom = useCallback((): Rect | null => {
    const id = front.current;
    const node = id ? nodes.current.get(id) : undefined;
    let box: Rect | null = null;
    node?.measureInWindow((x, y, width, height) => {
      box = { x, y, width, height };
    });
    const size = id ? sizes.current.get(id) : undefined;
    return box && size ? containRect(box, size) : box;
  }, []);
  return { closeTo, closeFrom, setFront, framePhoto };
}

/**
 * The pages of a full-screen photo viewer, one window wide each: the chat's, the circle's and the officer's letters'
 * (they were three ScrollViews that mounted every picture of a thread at once). A FlatList with `getItemLayout`, so
 * only the page in front and its neighbours are mounted; `contentOffset` still opens it on `start` (initialScrollIndex
 * picks what is rendered first). `onIndex` hears the page in front after a swipe, kept inside the list.
 */
export function PhotoPager<T>({
  testID,
  items,
  start,
  keyOf,
  onIndex,
  renderPage,
}: {
  testID: string;
  items: readonly T[];
  start: number;
  keyOf: (item: T) => string;
  onIndex: (index: number) => void;
  renderPage: (item: T, index: number) => ReactElement;
}) {
  const { width } = useWindowDimensions();
  const n = items.length;
  const first = Math.min(Math.max(0, start), Math.max(0, n - 1));
  return (
    <FlatList
      testID={testID}
      data={items}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      keyExtractor={keyOf}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      initialScrollIndex={first}
      initialNumToRender={1}
      windowSize={3}
      contentOffset={{ x: first * width, y: 0 }}
      onMomentumScrollEnd={(e) => onIndex(Math.min(n - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))))}
      renderItem={({ item, index }) => renderPage(item, index)}
    />
  );
}

// ponytail: one module-level map, the last thumbnail mounted under a key wins; enough while a photo has one tile on screen.
const thumbNodes = new Map<string, View>();
/** A thumbnail a photo viewer closes back onto: `ref={thumbRef("chat:" + id)}`. Unmounted, it is gone from the map. */
export function thumbRef(key: string): (node: View | null) => () => void {
  return (node) => {
    if (node) thumbNodes.set(key, node);
    return () => {
      if (node && thumbNodes.get(key) === node) thumbNodes.delete(key);
    };
  };
}

// ── type ───────────────────────────────────────────────────────────────

/**
 * v4 (定稿 V4Batch07 的手机屏; user decision 2026-11-06 一律按 v4): 11 / 12 / 13 / 14 / 15 / 20 / 30
 * with line heights 16 / 16 / 20 / 22 / 24 / 28 / 38. Body is 14/22 (v3 13/20), the big serif
 * title 30/38 (v3 28/36), the line under a title 13/20 in --sub (`caption`, v3 12/18). v4 tracks
 * no control text; the eyebrow keeps its 0.08em. letterSpacing is in pt.
 */
export const TYPE = {
  /** Titles and display text in Noto Serif SC 600 (`family.title`); body and controls stay `ui`. */
  display: { fontSize: 32, lineHeight: 40, fontFamily: family.title },
  title: { fontSize: 20, lineHeight: 28, fontFamily: family.title },
  nav: { fontSize: 16, lineHeight: 24, fontFamily: family.ui[600] },
  body: { fontSize: 14, lineHeight: 20, fontFamily: family.ui[400] },
  bodyLg: { fontSize: 16, lineHeight: 24, fontFamily: family.ui[500] },
  label: { fontSize: 12, lineHeight: 16, fontFamily: family.ui[500], letterSpacing: 0.4 },
  /** A ledger row's title (v3 `.life-records article b`), 15 / 600 on its row. */
  section: { fontSize: 16, lineHeight: 24, fontFamily: family.ui[600] },
  /**
   * What a block of the page is — 11, upper case, always in `muted` (`SectionLabel`). Every
   * section header and form-group label outside the ledger rows. The interface face, not mono:
   * v3 第一批「区块标签：11 号，大写，界面字体（不用等宽）」 overrides the round-7 prototype's
   * mono `.product-label`; the 0.08em tracking is the prototype's.
   */
  eyebrow: { fontSize: 11, lineHeight: 16, fontFamily: family.ui[500], letterSpacing: 0.88, textTransform: "uppercase" },
  caption: { fontSize: 14, lineHeight: 20, fontFamily: family.ui[400] },
  value: { fontSize: 14, lineHeight: 20, fontFamily: family.mono[400] },
  valueLg: { fontSize: 32, lineHeight: 40, fontFamily: family.mono[500] },
  /**
   * 第三十批 `--juan`: the 「卷」 register — a record's own words, the serif 16/28. Design draws 400; the app
   * bundles Noto Serif SC at 500 / 600 only, so it is 500 (a value with no Han takes EB Garamond, `quoteFamily`,
   * as quoted words do). `--juan-strong` (600) waits for the screen that draws it.
   */
  juan: { fontSize: 16, lineHeight: 24, fontFamily: family.serifHan },
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

/**
 * 第二十八批 S4: both apps follow the system text size, with no in-app setting. The cap is
 * Design's rule: the system's 3rd-largest step, "iOS AX3 / Android 200%" -- 2.35 on iOS (AX3 body
 * 40pt against the default 17); Android's own largest scale is 2.0, so it never bites there.
 *
 * Identifiers / times / amounts / status labels on one line with … and long-press to read in
 * full: `OneLine` below (and `Badge`). Left-text + right-time rows stacking above 1.5×:
 * `Layout.twoLine`. NOT implemented yet (needs a device pass): the filter bar and identity band
 * staying at the default size; printed / scanned content not scaling.
 */
export const MAX_FONT_SCALE = 2.35;

export function Txt({
  variant = "body",
  tone = "ink",
  style,
  ...rest
}: TextProps & { variant?: keyof typeof TYPE; tone?: Tone }) {
  const t = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[TYPE[variant], { color: toneColor(t, tone) }, style]}
    />
  );
}

/**
 * S4: a value that keeps to one line at any text size — an identifier, a time, an amount, a
 * name in a row. Cut with …; a long press reads it in full (the platform toast / alert). A
 * press handler on a Text takes the touch from the row around it, so a row that is itself
 * pressable passes its `onPress` here too.
 */
export function OneLine({ children, ...rest }: Omit<Parameters<typeof Txt>[0], "children"> & { children: string }) {
  return (
    <Txt numberOfLines={1} ellipsizeMode="tail" onLongPress={() => notify({ text: children }, "info")} {...rest}>
      {children}
    </Txt>
  );
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

/** The scroller's last offset, and whether the finger now down landed at the top (see usePullRefresh). */
class PullStart {
  private offset = 0;
  private landed = true;
  scrolled(y: number) {
    this.offset = y;
  }
  atTop() {
    return this.offset <= 0;
  }
  land() {
    this.landed = this.atTop();
  }
  landedAtTop() {
    return this.landed;
  }
}
const PULL_EASING = EASE.enter;

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
 * over 160ms (第五十九批, was 200) on cubic-bezier(.2,.8,.2,1); a release short of 56 goes back the same way. While
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
 * every move anyway, so the 160ms return runs on the JS driver too (one driver for one value).
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
  if (held === "wait" && !refreshing) setHeld(false);
  // …and for at least `motion.pullMinHold` after the pull, even when the reload answers in 40ms
  // (a local backend does): shorter, the hold is a one-frame flash that reads as "did not refresh".
  const [minHeld, setMinHeld] = useState(false);
  const holding = !!held || minHeld;
  // While it refreshes the ↻ turns (user decision 2026-10-03: a still glyph during the hold read
  // as "stuck"; this overrides v3 B2's "刷新指示不旋转"). Not under reduce motion.
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!holding || reduced || reader) return; // with a reader on, the system control shows instead
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: motion.pullSpin, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [holding, reduced, reader, spin]);

  const trigger = () => {
    if (!onRefresh) return;
    // 第五十八批 M8: the pull keeps its own indicator (an answer to the gesture); released, the top line runs too.
    runTopline();
    setMinHeld(true);
    setTimeout(() => setMinHeld(false), motion.pullMinHold);
    const result = onRefresh();
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      setHeld("promise");
      (result as PromiseLike<unknown>).then(
        () => setHeld(false),
        () => setHeld(false)
      );
    } else setHeld("wait");
  };
  const back = () => {
    if (pullRelease) Animated.timing(y, { toValue: 0, duration: pullRelease, easing: PULL_EASING, useNativeDriver: false }).start();
    else y.setValue(0);
  };
  // The reload is done: back from the 56 hold (only then — nothing moves on mount).
  const wasHeld = useRef(false);
  useEffect(() => {
    if (holding || !wasHeld.current) {
      wasHeld.current = holding;
      return;
    }
    wasHeld.current = false;
    if (pullRelease) Animated.timing(y, { toValue: 0, duration: pullRelease, easing: PULL_EASING, useNativeDriver: false }).start();
    else y.setValue(0);
  }, [holding, pullRelease, y]);

  // Built every render: the detector keeps the native handler (same tag) and swaps in the new
  // config and callbacks, so a re-render mid-drag does not drop the pull.
  // `enabled` follows `atTop`, a state: it reaches the native handler a render (and a setImmediate) after the
  // scroll event. A touch that lands in that window, mid-page, used to start a pull (2026-11-20, iOS: scrolled
  // down, then a quick drag back). So the pull also asks the live offset, read off the last scroll event, when
  // the finger lands: not at the top, the pull fails at once and the drag is the list's.
  // Not refs: the gesture builder takes these callbacks during render, and the hooks lint reads a ref there as a
  // read during render. Nothing here renders; the scroller writes it and the pan reads it.
  const [live] = useState(() => new PullStart());
  const pan = Gesture.Pan()
    .withTestId("pull")
    .runOnJS(true)
    .enabled(!!onRefresh && atTop && !holding && !reader)
    .activeOffsetY(PULL_SLOP_PT)
    .failOffsetY(-PULL_SLOP_PT)
    .failOffsetX([-PULL_SLOP_PT, PULL_SLOP_PT])
    .onTouchesDown((_e, manager) => {
      if (!live.atTop()) manager.fail();
    })
    .onBegin(() => {
      live.land();
    })
    .onUpdate((e) => {
      if (!live.landedAtTop()) return;
      const d = Math.min(Math.max(e.translationY, 0), PULL_REFRESH_PT);
      y.setValue(reduced ? (d >= PULL_REFRESH_PT ? PULL_REFRESH_PT : 0) : d);
    })
    .onEnd((e, ok) => (ok && live.landedAtTop() && e.translationY >= PULL_REFRESH_PT ? trigger() : back()));
  const native = Gesture.Native().requireExternalGestureToFail(pan);

  if (!onRefresh) return { props: {}, frame: (scroller) => scroller };
  const opacity = y.interpolate({ inputRange: [0, PULL_REFRESH_PT], outputRange: [0, 1], extrapolate: "clamp" });
  return {
    props: reader
      ? { refreshControl: <RefreshControl refreshing={holding} onRefresh={trigger} tintColor={t.inkSubtle} /> }
      : { bounces: false, overScrollMode: "never", scrollEventThrottle: 16, onScroll: (e) => {
          live.scrolled(e.nativeEvent.contentOffset.y);
          setAtTop(live.atTop());
        } },
    frame: (scroller) => (
      <GestureDetector gesture={pan}>
        <View style={styles.fill} collapsable={false}>
          {reader ? null : (
            <Animated.View testID="pull-indicator" pointerEvents="none" style={[styles.pullIndicator, { opacity }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Animated.Text
                testID="pull-glyph"
                style={[styles.pullGlyph, { color: t.inkSubtle, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }]}
              >
                ↻
              </Animated.Text>
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
  belowHeader,
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
  /**
   * This screen starts below a header (or a back row). KeyboardAvoidingView pads by its frame measured from its
   * parent, so it comes up short by exactly the distance from the top of the window and the button under a
   * form stays beneath the keyboard; passing the distance fixes that (`mobile-officer` letter.tsx, 2026-10-11).
   */
  belowHeader?: boolean;
}) {
  const t = useTheme();
  const keyboardFrame = useRef<View>(null);
  const [top, setTop] = useState(0);
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
      // The keyboard frame fills this view from its top, so this view's distance from the window's top is the offset.
      ref={keyboardFrame}
      onLayout={belowHeader ? () => keyboardFrame.current?.measureInWindow((_x, y) => setTop(y)) : undefined}
    >
      {scroll ? (
        // The keyboard covers the lower half of the screen; without this a focused field low on
        // the page (登录的密码框) sits under it. Android is edge-to-edge (SDK 35+), where
        // `adjustResize` no longer shrinks the window, so both platforms pad by the keyboard.
        <KeyboardAvoidingView
          style={styles.fill}
          behavior="padding"
          keyboardVerticalOffset={belowHeader ? top : undefined}
        >
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
 * `sectionIn` (240, the web's collapse in) — and goes over `sectionOut` (160). Its height changes at
 * once, never animated (no layout jump). A zero duration (reduce motion) is no animation.
 */
export function sectionTransitions(inMs: number, outMs: number) {
  return {
    entering: inMs
      ? new Keyframe({
          0: { opacity: 0, transform: [{ translateY: -4 }] },
          100: { opacity: 1, transform: [{ translateY: 0 }], easing: REasing.bezier(...curves.enter) },
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
 *
 * `open` false (第五十八批 M13, the offline bars): it folds back to nothing over the same `ms` on the exit curve, then
 * calls `onClosed` — the caller keeps it mounted until then. `ms` 0: `onClosed` at once.
 */
export function Grow({ ms, open = true, onClosed, children }: { ms: number; open?: boolean; onClosed?: () => void; children: ReactNode }) {
  const [height] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(ms ? 0 : 1));
  const [natural, setNatural] = useState<number | null>(null);
  const [done, setDone] = useState(!ms);
  const measured = useRef(0);
  const closed = useRef(onClosed);
  useEffect(() => {
    closed.current = onClosed;
  });
  // Reduce motion is answered asynchronously: a body mounted before the answer lets go at once.
  if (!ms && !done) setDone(true);
  useEffect(() => {
    if (natural === null || done || !open) return;
    const run = Animated.parallel([
      Animated.timing(height, { toValue: natural, duration: ms, easing: EASE.enter, useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 1, duration: ms, easing: EASE.enter, useNativeDriver: false }),
    ]);
    run.start(({ finished }) => finished && setDone(true));
    return () => run.stop();
  }, [natural, done, height, opacity, ms, open]);
  useEffect(() => {
    if (open) return;
    if (!ms) {
      closed.current?.();
      return;
    }
    height.setValue(measured.current);
    const run = Animated.parallel([
      Animated.timing(height, { toValue: 0, duration: ms, easing: EASE.exit, useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 0, duration: ms, easing: EASE.exit, useNativeDriver: false }),
    ]);
    run.start(({ finished }) => finished && closed.current?.());
    return () => run.stop();
  }, [open, ms, height, opacity]);
  const sized = !done || !open;
  // One tree shape before and after: letting go drops the style, not the wrappers — returning the
  // bare children here remounted them (and whatever they held) the moment the growth ended.
  return (
    <Animated.View testID={sized ? "grow" : undefined} style={sized ? { height, opacity, overflow: "hidden" } : undefined}>
      <View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          measured.current = h;
          if (!done && natural === null) setNatural(h);
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/**
 * The row a tapped push points at (a comment, a judgment, a disposition, the residence block): ink at
 * `HIGHLIGHT_ALPHA` (10%, 第五十九批, three surfaces alike) behind it for two seconds, then gone. Not scrolled, not
 * moved. Under reduce-motion it is not drawn.
 */
export function LandingWash({ on, children, testID }: { on: boolean; children: ReactNode; testID?: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const fade = useLandingFade(on, reduced);
  const [opacity] = useState(() => Animated.multiply(fade, HIGHLIGHT_ALPHA));
  return (
    <View testID={testID}>
      {on && !reduced ? (
        <Animated.View testID="landing-wash" pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity, backgroundColor: t.ink }]} />
      ) : null}
      {children}
    </View>
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
 * 「无权查看或已不存在」(Design 第四十批 O-c, both apps): what a detail showed is deleted or no longer this account's
 * to see (`fetchFailureOf` = `gone`). A hollow dashed circle (not the error's solid mark), two lines, and
 * 「回到{from}」 when the screen knows where it came from. Nothing to retry, so no retry.
 */
export function GoneState({ from, onBack, testID, style }: { from?: string; onBack?: () => void; testID?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View testID={testID} style={[styles.gone, style]}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.goneMark, { borderColor: t.inkSubtle }]} />
      <Txt variant="title" accessibilityRole="header">
        {tr("state.gone_title")}
      </Txt>
      <Txt variant="body" tone="muted">
        {tr("state.gone_body")}
      </Txt>
      {from && onBack ? (
        <Button testID={testID ? `${testID}-back` : undefined} kind="secondary" title={tr("state.gone_back", { from })} onPress={onBack} />
      ) : null}
    </View>
  );
}

/**
 * 第三十批 空态: over a WHOLE-PAGE empty state (书信, 朋友圈, 申请) the civilization's G mark (the armillary
 * sphere, the neutral skin's ledger) at 96, in ink at 10% (第四十八批第三节 A8, as the web's `.empty-mark`; until
 * then the civilization's colour at 12%); the page then says one sentence and one
 * next step. Which page it is, the language bundle says. An empty section inside a page keeps `Empty`'s dash.
 * The 10% view holds no touch target (an iOS view under opacity 0 takes none; this one is not 0, and is inert).
 */
export function PageEmptyArt() {
  const t = useTheme();
  const compact = useFlavorCompact();
  return (
    <View testID={`empty-hero-${t.civ}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[styles.emptyArt, styles.emptyMark]}>
      <Emblem civ={t.civ} size={compact ? 64 : 96} stroke={t.ink} />
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
export function FocusRing({ focused, children }: { focused: boolean; children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.ring, { borderColor: focused ? t.ink : "transparent" }]}>{children}</View>;
}

/** A1 "按下": a fill darkened toward black by `amount` — contrast with its light text only rises. */
export function shade(hex: string, amount = 0.24): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((n >> s) & 255) * (1 - amount)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** What `Press` lays over a target's own face while the finger is down (A1 "按下"). */
export function pressedFace(t: Theme, ground: unknown): ViewStyle {
  if (ground == null || ground === "transparent") return { backgroundColor: t.hair };
  if (typeof ground === "string" && /^#[0-9a-f]{6}$/i.test(ground)) return { backgroundColor: shade(ground) };
  return styles.pressed;
}

/**
 * A `Pressable` that answers the finger (App 手感, 2026-11-15; HIG "immediate feedback", M3 state layer): while it is
 * down its ground darkens -- a solid fill 24% toward black (`shade`), no fill to `hair`, any other fill to 0.8 opacity.
 * Nothing moves, nothing ripples; the face returns as the finger lifts. Every tappable thing in both apps is a `Press`
 * or a `Pressable` whose style already reads `pressed`; the few plain ones (scrims, full-screen skips, holds that fill
 * themselves) are counted in `__tests__/pressedState.test.tsx`.
 */
export function Press({ style, dim, ...rest }: PressableProps & { ref?: Ref<View>; /** An image covers the ground: dim the whole target instead. */ dim?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      {...rest}
      style={(state) => {
        const own = typeof style === "function" ? style(state) : style;
        if (!state.pressed) return own;
        return [own, dim ? styles.pressed : pressedFace(t, StyleSheet.flatten(own)?.backgroundColor)];
      }}
    />
  );
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

/** Keyboards that can only type Latin letters, digits and symbols: a field on one of them is a code, a number or an address. */
const LATIN_KEYBOARDS: ReadonlySet<string> = new Set([
  "ascii-capable",
  "number-pad",
  "numeric",
  "decimal-pad",
  "phone-pad",
  "email-address",
  "url",
  "visible-password",
  "numbers-and-punctuation",
]);

export function Input({
  label,
  labelHidden,
  labelAside,
  hint,
  error,
  invalid,
  mono,
  secureToggle,
  multiline,
  style,
  inputWidth,
  suffix,
  inputRef,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & {
  /** The field's TextInput, for a screen that puts the cursor back after a refusal. */
  inputRef?: Ref<TextInput>;
  label: string;
  /** The label is for screen readers only (a sheet whose title already names the field): no visible row, no row height. */
  labelHidden?: boolean;
  /** Beside the label, at its right: a link (「忘记密码」) or a live value (a countdown). */
  labelAside?: ReactNode;
  hint?: string;
  /** Shown under the field, in the error ink; also turns the border red. */
  error?: string | null;
  invalid?: boolean;
  mono?: boolean;
  secureToggle?: { show: string; hide: string };
  /** A short field (a count of days): the box is this wide, the label and hint keep the full width. */
  inputWidth?: number;
  /** After a short field, on its row: the unit (「天」). */
  suffix?: ReactNode;
}) {
  const t = useTheme();
  const inSheet = useContext(InSheetContext);
  const revealInSheet = useContext(SheetRevealContext);
  const Field = inSheet ? (BottomSheetTextInput as unknown as typeof TextInput) : TextInput;
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const bad = invalid || !!error;
  // A1 输入: disabled = s2 ground, hairline, ink3 text, not focusable; error = 2px neg; focus = ink.
  const off = rest.editable === false;
  const box = off
    ? { backgroundColor: t.s2, borderColor: t.hair }
    : { backgroundColor: t.s1, borderColor: bad ? t.neg : focused ? t.ink : t.inkSubtle, borderWidth: bad ? 2 : 1 };
  const text = typeof rest.value === "string" ? rest.value : "";
  // A1 input faces. Multiline (prose) is always the quote face. A single-line field is set in mono only when it
  // can hold nothing but Latin: `mono`, a password, or a Latin-only keyboard (a code, a number, an email). Any
  // other field gets the quote face, so Han text and a Han placeholder are drawn in the bundled Noto Serif SC
  // instead of falling back to the phone's own face (on the test Huawei a script face, 10-31).
  const latinOnly = mono || !!rest.secureTextEntry || (rest.keyboardType !== undefined && LATIN_KEYBOARDS.has(rest.keyboardType));
  const fontFamily = multiline || !latinOnly ? quoteFamily(text || (rest.placeholder ?? "")) : mono ? family.mono[500] : family.mono[400];
  // Handoff 2d: at ≥ 1.7× text the reveal leaves the field's right edge for a full-width row under it.
  const { stack } = useLayout();
  const reveal = secureToggle ? (
    <Press
      testID={rest.testID ? `${rest.testID}-reveal` : undefined}
      accessibilityRole="button"
      onPress={() => setRevealed((v) => !v)}
      style={stack ? [styles.revealRow, { borderColor: t.hair, backgroundColor: t.s1 }] : [styles.reveal, { borderLeftColor: t.hair }]}
    >
      <Txt variant="label" tone="muted" style={styles.noSpacing}>
        {revealed ? secureToggle.hide : secureToggle.show}
      </Txt>
    </Press>
  ) : null;
  return (
    <View style={styles.field}>
      {labelHidden ? null : (
        <View style={styles.labelRow}>
          <Txt variant="label" tone="muted" style={styles.shrink}>
            {label}
          </Txt>
          {labelAside}
        </View>
      )}
      <View style={inputWidth || suffix ? styles.inlineRow : undefined}>
        <View style={inputWidth ? { width: inputWidth } : undefined}>
          <FocusRing focused={focused && !off}>
            <View style={[styles.inputBox, box]}>
              <Field
                ref={inputRef}
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
                // A multiline field's return key only adds a line, so inside a sheet nothing could put the keyboard
                // away: let return finish the field there.
                {...(inSheet && multiline ? { submitBehavior: "blurAndSubmit" as const, returnKeyType: "done" as const } : null)}
                // A password field is typed in Latin letters; revealed, the pinyin keyboard would compose it. The caller may still override.
                {...(rest.secureTextEntry && !rest.keyboardType ? { keyboardType: "ascii-capable" as const } : null)}
                {...rest}
                // Android has no "ascii-capable": it falls back to the default keyboard, and a pinyin one composes the
                // letters. "visible-password" is its Latin keyboard; never on a masked field, whose mask it would drop.
                {...(Platform.OS === "android" && (rest.keyboardType ?? (rest.secureTextEntry ? "ascii-capable" : undefined)) === "ascii-capable" && !(rest.secureTextEntry && !revealed)
                  ? { keyboardType: "visible-password" as const }
                  : null)}
                secureTextEntry={secureToggle ? rest.secureTextEntry && !revealed : rest.secureTextEntry}
                onFocus={(e) => {
                  setFocused(true);
                  revealInSheet?.(e.currentTarget as unknown as TextInput);
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
        </View>
        {suffix}
      </View>
      {secureToggle && stack ? reveal : null}
      {error ? <FieldError text={error} /> : hint ? <Txt variant="label" tone="subtle" style={styles.noSpacing}>{hint}</Txt> : null}
    </View>
  );
}

/**
 * The ⚠ before an error is its only "this is an error" mark (Design 第三十二批: no 「!」 in the text), so a screen
 * reader must say it rather than skip it as decoration.
 */
function alertIconLabel(tr: (key: string) => string) {
  return { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: tr("soul_app.common.alert") };
}

export function FieldError({ text, testID }: { text: string; testID?: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View style={styles.iconRow} accessibilityRole="alert">
      <View style={styles.iconNudge} {...alertIconLabel(tr)}>
        <Icon name="alert" size={14} color={t.neg} />
      </View>
      <Txt testID={testID} variant="caption" tone="negInk" style={styles.fill}>
        {text}
      </Txt>
    </View>
  );
}

/** Says `text` once when the component mounts: `role=alert` alone is silent on iOS. */
export function useAnnounceOnMount(text: string) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
}

/** A failure line with no ⚠ beside it (an overlay on an image): alert role, live region, and spoken once on mount. */
export function AlertTxt({ children, ...rest }: Omit<Parameters<typeof Txt>[0], "children"> & { children: string }) {
  useAnnounceOnMount(children);
  return (
    <Txt accessibilityRole="alert" accessibilityLiveRegion="polite" {...rest}>
      {children}
    </Txt>
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
  accessibilityHint,
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
  /** What a screen reader says after the label: the reason, when the button is disabled. */
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const inert = disabled || busy;
  // A1 按钮, v4 `.btn`: primary = ink under the page's ground (第三十批: 墨色实底 — the civilization's colour is
  // kept to the top line, the seal, the spine and focus); danger = solid neg under `--onNeg`
  // (dark ink on dark's pink), always with ✕; secondary = ghost, the `--line2` outline. Disabled: s2 ground, ink3
  // text, same opacity. Busy (第五十八批 M10) keeps its look, its words and its width: it only stops taking presses,
  // and past 160 a line runs along its foot (`BusyLine`). Pressed: fills darken 24%, the ghost takes hair.
  const look = disabled
    ? { bg: t.s2, border: t.s2, ink: t.inkSubtle, pressed: t.s2 }
    : kind === "primary"
      ? { bg: t.ink, border: t.ink, ink: t.s0, pressed: shade(t.ink) }
      : kind === "danger"
        ? { bg: t.negStrong, border: t.negStrong, ink: t.onNeg, pressed: shade(t.negStrong) }
        : { bg: "transparent", border: t.hair2, ink: t.ink, pressed: t.hair };
  return (
    <View style={[styles.buttonWrap, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!inert, busy: !!busy }}
        disabled={inert}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: pressed ? look.pressed : look.bg, borderColor: pressed && kind !== "secondary" ? look.pressed : look.border },
        ]}
      >
        {kind === "danger" ? <Icon name="close" size={14} color={look.ink} strokeWidth={1.6} /> : null}
        <Text numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.buttonText, { color: look.ink }]}>
          {title}
        </Text>
        {busy && !disabled ? <BusyLine color={look.ink} testID={testID ? `${testID}-busy` : "button-busy"} /> : null}
      </Pressable>
      {reason && inert ? <DisabledReason testID={reasonTestID}>{reason}</DisabledReason> : null}
    </View>
  );
}

/**
 * 第五十八批 M10, one busy look for both apps and the web: a 2px line along a busy button's foot, 34% wide, running
 * back and forth one pass per `loadingLine` (1.2s) — shown only once the wait passes `busyDelay` (160), so a quick
 * answer shows nothing. In the button's own text colour at 60% (canvas on an ink button, ink on an outline): never
 * the civilization's. Reduce motion: still, in the middle. Hidden from a screen reader: the button's own label and
 * `busy` state say it.
 */
export function BusyLine({ color, testID }: { color: string; testID?: string }) {
  const reduced = useReducedMotion();
  const shown = useAfter(motion.busyDelay);
  const [width, setWidth] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!shown || reduced || !width) return;
    const leg = (toValue: number) => Animated.timing(x, { toValue, duration: motion.loadingLine, easing: EASE.standard, useNativeDriver: true });
    const run = Animated.loop(Animated.sequence([leg(1), leg(0)]));
    run.start();
    return () => run.stop();
  }, [shown, reduced, width, x]);
  if (!shown) return null;
  const run = BUSY_LINE_WIDTH * width;
  return (
    <View
      testID={testID}
      pointerEvents="none"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={styles.busyTrack}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Animated.View
        testID={testID ? `${testID}-run` : undefined}
        style={{
          width: `${BUSY_LINE_WIDTH * 100}%`,
          height: touch.topline,
          backgroundColor: color,
          opacity: 0.6,
          transform: [{ translateX: reduced ? (width - run) / 2 : x.interpolate({ inputRange: [0, 1], outputRange: [0, width - run] }) }],
        }}
      />
    </View>
  );
}
const BUSY_LINE_WIDTH = 0.34;

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
        <View style={styles.iconNudge} {...alertIconLabel(tr)}>
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
export function ScreenError({
  error,
  onRetry,
  onHome,
  reported,
}: {
  error: SoulErrorMessage;
  onRetry: () => void;
  /** The crash screen only: a second, quieter way out. */
  onHome?: () => void;
  /** The crash screen only: said once the report has really been delivered. */
  reported?: boolean;
}) {
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
      {reported ? (
        <Txt testID="crash-reported" variant="caption" tone="subtle" style={styles.center}>
          {tr("soul_app.errors.reported")}
        </Txt>
      ) : null}
      <Button kind="secondary" title={tr("soul_app.common.retry")} onPress={onRetry} style={styles.retry} />
      {onHome ? <Button testID="crash-home" kind="secondary" title={tr("soul_app.errors.go_home")} onPress={onHome} style={styles.home} /> : null}
      <Txt testID="error-code" variant="value" tone="subtle" style={styles.errorCode}>
        {`${code} · ${clock}${error.requestId ? ` · request ${error.requestId}` : ""}`}
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
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.failedText, { color: theme.neg }]}>✕</Text>
      <Text testID={testID} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.failedText, styles.fill, { color: theme.neg }]}>
        {text}
      </Text>
      <SmallButton testID={retryTestID} title={t("soul_app.common.retry")} onPress={onRetry} />
    </View>
  );
}

// ── values ─────────────────────────────────────────────────────────────

/**
 * `juan` (第三十批 卷): the rows are a 「卷」 — hairline-ruled, the field names in a column of their own, the
 * values in the serif at 16/28 (`TYPE.juan`) in ink. The 本世 page's rows. Without it, the compact list.
 */
const JuanContext = createContext(false);

export function DataRows({ children, style, juan }: { children: ReactNode; style?: StyleProp<ViewStyle>; juan?: boolean }) {
  const t = useTheme();
  return (
    <JuanContext.Provider value={!!juan}>
      <View style={[juan ? [styles.juan, { borderTopColor: t.hair }] : styles.rows, style]}>{children}</View>
    </JuanContext.Provider>
  );
}

/**
 * Label and value. A label longer than 18 characters (EN / egy) puts the value
 * on its own line instead of squeezing both. A mono value (a time, a code) keeps to one
 * line (S4): cut with …, long-press for all of it.
 * EN / egy labels sit in a fixed-width column, so the values start on one line whatever the
 * label's length (华为真机 10-29: a long label pushed its value right of the others). Chinese
 * labels are two to four characters and keep the content-width column they always had.
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
  const t = useTheme();
  const { compact } = useLayout();
  const { locale } = useI18n();
  const juan = useContext(JuanContext);
  // Two lines for a long label (EN / egy), and for every row on a narrow screen (handoff 2c).
  const stacked = compact || stacksLabel(label);
  const tone: Tone = juan ? "ink" : "muted";
  // 卷: a mono value (a date, a code) keeps its face on the serif's 28 line; words take the serif.
  const juanFace = juan ? (mono ? styles.juanMono : [TYPE.juan, typeof children === "string" ? { fontFamily: quoteFamily(children) } : null]) : null;
  const value =
    isValidElement(children) && typeof (children as ReactElement).type !== "string" ? (
      children
    ) : mono && typeof children === "string" ? (
      <OneLine variant="value" tone={tone} style={[!stacked && styles.fill, juanFace]}>
        {children}
      </OneLine>
    ) : (
      <Txt variant={mono ? "value" : "body"} tone={tone} style={[!stacked && styles.fill, juanFace]}>
        {children}
      </Txt>
    );
  const labelStyle = stacked ? undefined : juan && locale === "zh-Hans" ? styles.juanLabel : locale === "zh-Hans" ? styles.rowLabel : styles.rowLabelFixed;
  return (
    <View testID={testID} style={[stacked ? styles.rowStacked : styles.row, juan && [styles.juanRow, { borderBottomColor: t.hair }]]}>
      <Txt variant="caption" tone="subtle" style={[labelStyle, juan && !stacked && styles.juanLabelLine]}>
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
  // 第三十批 淡染: a tinted ground, no frame, radius 4, 28 high on a phone, the glyph before the word. Four
  // colours: neutral (s2 under --sub) and the pos / neg / warn tints. Only a value the app cannot name keeps a
  // (dotted) frame, so it never reads as a status.
  const tint = spec.unknown ? null : spec.tone;
  const color = tint ? t[tint] : t.inkMuted;
  const ground = tint === "pos" ? t.posBg : tint === "neg" ? t.negBg : tint === "warn" ? t.warnBg : t.s2;
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
        spec.unknown ? { borderWidth: 1, borderColor: t.inkSubtle, borderStyle: "dotted" } : null,
        { backgroundColor: ground },
      ]}
    >
      <Text testID={testID ? `${testID}-glyph` : undefined} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, styles.badgeGlyph, { color }]}>{spec.glyph}</Text>
      {/* S4: a status label keeps to one line. No long-press here: the pill sits inside
          pressable rows, and the accessibility label already carries the whole word. */}
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={1}
        style={[styles.badgeText, styles.shrink, { color }]}
      >
        {label}
      </Text>
      {raw ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeRaw, { color }]}>{raw}</Text> : null}
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
        maxFontSizeMultiplier={MAX_FONT_SCALE}
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

/**
 * 第三十批 加载: a 2px line runs across the top (no spinner) — in ink at 60% (第四十八批第三节 A9: only a
 * progress line that takes a page head's top line keeps the civilization's colour; this one sits in the content), over s2 bars in
 * the shape of what is coming — hairline-ruled rows, static, no shimmer. Under reduce motion the line stands
 * still. `${testID}-bars` holds the bars.
 *
 * 第五十八批 M6: nothing for the first `skeletonDelay` (400) — a quick load never flashes it; once shown it stays at
 * least `skeletonHold` (300), which `useRemote` keeps by holding back an answer that lands inside that window.
 */
export function Skeleton({ lines = 3, testID }: { lines?: number; testID?: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const reduced = useReducedMotion();
  const shown = useAfter(motion.skeletonDelay);
  const [x] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (reduced || !width) return;
    const run = Animated.loop(Animated.timing(x, { toValue: 1, duration: motion.loadingLine, easing: EASE.standard, useNativeDriver: true }));
    run.start();
    return () => run.stop();
  }, [x, reduced, width]);
  const widths = ["70%", "90%", "50%", "80%", "60%"] as const;
  if (!shown) return null;
  return (
    <View testID={testID} accessible accessibilityRole="progressbar" accessibilityLabel={tr("soul_app.common.loading")} accessibilityState={{ busy: true }}>
      <View testID={testID ? `${testID}-line` : undefined} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.progressTrack, { backgroundColor: t.hair }]}>
        <Animated.View
          style={[
            styles.progressRun,
            { backgroundColor: t.ink, opacity: 0.6, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-0.32 * width, width] }) }] },
          ]}
        />
      </View>
      <View testID={testID ? `${testID}-bars` : undefined} style={styles.skeleton}>
        {Array.from({ length: lines }, (_, i) => (
          <View key={i} style={[styles.skeletonRow, { borderBottomColor: t.hair }]}>
            <View style={{ width: widths[i % widths.length], height: 12, borderRadius: radius.control, backgroundColor: t.s2 }} />
          </View>
        ))}
      </View>
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

/**
 * Loading / error / data for one request, with a `reload` for pull-to-refresh and retry.
 *
 * A new `fetcher` (another id, another tab) is another request: the old data goes, and a response
 * still on its way from the OLD fetcher is dropped (`seq`) rather than painted over the new one.
 */
export function useRemote<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  /** When the data on screen arrived (ms): the stale line's 「显示的是 {time} 的内容」 (第六十一批 E6). */
  const [at, setAt] = useState<number | null>(null);
  const seq = useRef(0);
  const current = useRef(fetcher);
  const shown = useRef<T | null>(null);
  useEffect(() => {
    shown.current = data;
  }, [data]);
  const run = useCallback(() => {
    const mine = ++seq.current;
    // Nothing on screen: the page shows its skeleton, and an answer landing in the skeleton's first 300 waits for
    // them to pass (第五十八批 M6, `skeletonHoldLeft`). With data on screen there is no skeleton and no wait.
    const cold = shown.current === null;
    const started = Date.now();
    const settle = (apply: () => void) =>
      new Promise<void>((done) => {
        const wait = cold ? skeletonHoldLeft(Date.now() - started) : 0;
        const go = () => {
          if (mine === seq.current) {
            apply();
            setLoading(false);
          }
          done();
        };
        if (wait > 0) setTimeout(go, wait);
        else go();
      });
    // Resolves true when the fetch answered, false when it failed -- whoever refreshed may need to know (life.tsx).
    return fetcher().then(
      (value) =>
        settle(() => {
          setData(value);
          setError(null);
          setAt(Date.now());
        }).then(() => true),
      (e: unknown) => settle(() => setError(e)).then(() => false)
    );
  }, [fetcher]);
  useEffect(() => {
    if (current.current !== fetcher) {
      current.current = fetcher;
      setData(null);
      setError(null);
      setAt(null);
      setLoading(true);
    }
    void run();
  }, [run, fetcher]);
  const reload = useCallback(() => {
    setLoading(true);
    return run();
  }, [run]);
  return { data, error, loading, reload, at };
}

/**
 * Design v4 第六十一批 E6, the one stale line of the whole app: data on screen, a refresh that failed. Under the page
 * head, above the content, a 12 secondary line -- ↻, 「显示的是 {time} 的内容 · 刷新没成功」, a 重试 text button. The time
 * is the dashboard's `as of` rule (`formatAsOf`: HH:mm today, the date across days). Never while the offline bar shows
 * (`connection.offline` already says why); gone once a refresh answers.
 */
export function StaleLine({ state, onRetry }: { state: { data: unknown; error: unknown; at: number | null }; onRetry: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { offline } = useOnline();
  const { gutter } = useLayout();
  const { staleOut } = useReducedMotionDurations();
  const show = !offline && state.data !== null && !!state.error && state.at !== null;
  // Design v4 第六十三批 二 e (E6): once the page answers again the line folds away over `staleOut` (height and
  // opacity, exit curve) instead of vanishing and pushing the content up; it stays mounted, with the time it said,
  // until then. It appears at once, as before. Reduce motion: gone at once.
  const [shownAt, setShownAt] = useState<number | null>(show ? state.at : null);
  if (show && shownAt !== state.at) setShownAt(state.at);
  if (shownAt === null) return null;
  const time = formatAsOf(new Date(shownAt).toISOString(), new Date(), (d) => hhmm(d)) ?? "";
  return (
    <Grow ms={show ? 0 : staleOut} open={show} onClosed={() => setShownAt(null)}>
      <View testID="stale-line" accessibilityRole="alert" style={[styles.staleLine, { paddingHorizontal: gutter }]}>
        <Txt variant="caption" tone="muted" style={styles.shrink}>
          {`↻ ${tr("soul_app.stale.line", { time })}`}
        </Txt>
        <Press testID="stale-retry" accessibilityRole="button" onPress={onRetry} hitSlop={8}>
          <Txt variant="caption" style={{ color: t.ink, textDecorationLine: "underline" }}>
            {tr("soul_app.common.retry")}
          </Txt>
        </Press>
      </View>
    </Grow>
  );
}

/**
 * Tab screens stay mounted, so data loaded once goes stale when the other tab
 * changes it (seen on the iPhone run: a just-submitted application missing from
 * the life tab). Reload on every focus AFTER the first — the first is the mount,
 * which `useRemote` already loads.
 *
 * `state` (what `useRemote` returns): a focus within REFOCUS_FRESH_MS of the last successful answer asks nothing
 * -- tabbing back and forth sent the page's requests every time (opt-apps2 N3) -- and a return to the network asks
 * only when the page failed or has nothing. A pull, and a push arriving while the page is in front, always ask.
 */
export const REFOCUS_FRESH_MS = 15_000;

/**
 * When the app last changed something on the server (any successful non-GET; session.tsx reports them). An
 * answer older than that is not fresh, however recent: back from 「申请转生」 or a new post within 15 s, the page
 * asks again, as it did before the throttle.
 */
let wroteAt = 0;
export function markWritten(): void {
  wroteAt = Date.now();
}

export function useReloadOnRefocus(reload: () => unknown, state?: RemoteState) {
  const first = useRef(true);
  const okAt = useRef(0);
  const ok = state !== undefined && state.data != null && state.error == null;
  useEffect(() => {
    if (ok) okAt.current = Date.now();
  }, [ok, state?.data]);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (okAt.current > wroteAt && Date.now() - okAt.current < REFOCUS_FRESH_MS) return;
      runTopline();
      void reload();
    }, [reload])
  );
  // A push arriving while this page is in front (audit 2026-10-17 #9): its banner is about
  // something that just changed — 「申请已批准」 over the applications page that still says
  // pending. Subscribed only while focused, so a page behind it does not refetch.
  useFocusEffect(
    useCallback(() => {
      const sub = Notifications.addNotificationReceivedListener(() => {
        runTopline();
        void reload();
      });
      return () => sub.remove();
    }, [reload])
  );
  useReloadOnReconnect(reload, state);
}

/** `data` / `error` as `useRemote` holds them. */
export interface RemoteState {
  data: unknown;
  error: unknown;
}

/**
 * Back online (network.tsx): whatever failed while offline loads again, focused or not. With `state`, only a page
 * that failed or has nothing asks (opt-apps2 N3); without it (a caller that cannot tell), every one does.
 */
export function useReloadOnReconnect(reload: () => unknown, state?: RemoteState) {
  const { back } = useOnline();
  const seen = useRef(back);
  const needed = state === undefined || state.error != null || state.data == null;
  const neededNow = useRef(needed);
  useEffect(() => {
    neededNow.current = needed;
  }, [needed]);
  useEffect(() => {
    if (back === seen.current) return; // a new `reload` alone is not a return to the network
    seen.current = back;
    if (!neededNow.current) return;
    runTopline();
    void reload();
  }, [back, reload]);
}

export const styles = StyleSheet.create({
  staleLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingVertical: 8 },
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  grow: { flexGrow: 1 },
  center: { textAlign: "center" },
  pressed: { opacity: 0.8 },
  noSpacing: { letterSpacing: 0 },
  pullIndicator: { position: "absolute", top: 0, left: 0, right: 0, height: PULL_REFRESH_PT, alignItems: "center", justifyContent: "center" },
  pullGlyph: { fontFamily: family.glyph, fontSize: 20, lineHeight: 24 },
  block: { paddingHorizontal: GUTTER, paddingVertical: GUTTER },
  count: { marginLeft: space[3], fontSize: 12, lineHeight: 16 },
  sectionRule: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  // B11: a section's title row is 48 high.
  sectionHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER, paddingVertical: space[3] },
  sectionBody: { paddingHorizontal: GUTTER, paddingBottom: space[4] },
  /** v3 .life-records: a 60pt row — number, title, count, ＋. */
  ledgerHeader: { minHeight: 60 },
  ledgerIndex: { width: 30, fontSize: 12, lineHeight: 16 },
  ledgerPlus: { width: 24, textAlign: "right", fontSize: 16, lineHeight: 24 },
  ledgerPlusOpen: { transform: [{ rotate: "45deg" }] },
  ledgerBody: { marginHorizontal: space[3], marginBottom: space[3], paddingHorizontal: space[4], paddingVertical: space[3], borderLeftWidth: 3 },
  empty: { alignItems: "center", gap: space[2], paddingVertical: space[4] },
  gone: { gap: space[4] },
  goneMark: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderStyle: "dashed" },
  emptyArt: { alignSelf: "center", marginBottom: space[2] },
  // 第三十批 空态: the G mark at 12%.
  emptyMark: { opacity: 0.1 },
  divider: { flexDirection: "row", alignItems: "center", gap: space[3] },
  field: { gap: space[2] },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  // The ring sits 4pt outside the field, so its corner is the field's plus 4.
  ring: { margin: -4, padding: 2, borderWidth: 2, borderRadius: radius.control + 4 },
  inputBox: { flexDirection: "row", borderWidth: 1, minHeight: 48, borderRadius: radius.control, overflow: "hidden" },
  input: { flex: 1, minHeight: 46, paddingHorizontal: space[3], fontSize: 16 },
  monoInput: { fontSize: 16, letterSpacing: 2.2 },
  // Android clips the first line's top of a Noto Serif SC multiline field under about 1.8 x the size
  // (Huawei 10-31: 15/24 and 15/26 clip, 15/27 whole). Design batch 54 H3: 2 x the size (16/32, 14/28), off the
  // ten type steps on purpose, in multiline fields only; `inputFace.test.tsx` holds the ratio.
  multiline: { minHeight: 128, paddingVertical: space[3], fontSize: 16, lineHeight: 32, textAlignVertical: "top" },
  reveal: { width: 52, alignItems: "center", justifyContent: "center", borderLeftWidth: 1 },
  revealRow: { minHeight: 60, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: radius.control },
  iconRow: { flexDirection: "row", gap: space[2], alignItems: "flex-start" },
  iconNudge: { marginTop: 4 },
  buttonWrap: { gap: space[3] },
  // v4 phone: buttons and rows are 48 high (v3 44), 14 / 500 untracked — one size for all three kinds; radius 4.
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.control,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  buttonText: { fontFamily: family.ui[500], fontSize: 14, lineHeight: 20, textAlign: "center" },
  // M10: the busy line's track, along the button's inner foot.
  busyTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: touch.topline, overflow: "hidden" },
  notice: { flexDirection: "row", alignItems: "center", gap: space[2], borderWidth: 1, borderLeftWidth: 3, paddingVertical: space[3], paddingHorizontal: space[3] },
  failed: { flexDirection: "row", alignItems: "center", gap: space[2] },
  failedText: { fontFamily: family.ui[600], fontSize: 14, lineHeight: 20 },
  small: { borderWidth: 1, borderRadius: radius.control, paddingHorizontal: space[3], paddingVertical: space[2] },
  screenError: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], paddingHorizontal: space[6], paddingVertical: space[7] },
  retry: { alignSelf: "stretch", marginTop: space[1] },
  home: { alignSelf: "stretch" },
  errorCode: { fontSize: 12, opacity: 0.8 },
  rows: { gap: space[2] },
  juan: { borderTopWidth: 1 },
  juanRow: { paddingVertical: space[3], borderBottomWidth: 1 },
  // 第三十批 卷: the field names one column, 72 wide (two to four Han characters), on the value's 28 line.
  juanLabel: { width: 72 },
  juanLabelLine: { lineHeight: 24 },
  juanMono: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: space[4], alignItems: "flex-start" },
  rowStacked: { flexDirection: "column", gap: space[1] },
  rowLabel: { minWidth: 56, maxWidth: "45%" },
  // Up to 18 caption characters (LABEL_STACK_THRESHOLD) stay beside the value; past 40% they wrap at a space.
  rowLabelFixed: { width: "40%" },
  // v4 `.tag`: a control, radius 4 (square from v2 to v3; only the lamp and a drawer handle are pills).
  badge: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: touch.tag,
    flexDirection: "row",
    alignItems: "center",
    columnGap: space[1],
    borderRadius: radius.control,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  badgeWraps: { flexWrap: "wrap" },
  badgeText: { fontFamily: family.ui[500], fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  // Design E 组: every status glyph from the one bundled font, never a per-glyph OS fallback.
  badgeGlyph: { fontFamily: family.glyph, letterSpacing: 0 },
  badgeRaw: { fontFamily: family.mono[400], fontSize: 12, lineHeight: 16, opacity: 0.85 },
  quote: { borderLeftWidth: 2, paddingLeft: space[4], paddingVertical: 2 },
  quoteText: { fontSize: 16, lineHeight: 24 },
  quoteCompact: { paddingLeft: space[3] },
  original: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], marginTop: space[2] },
  originalTag: { borderWidth: 1, borderStyle: "dashed", paddingHorizontal: space[1], paddingVertical: 2 },
  originalText: { fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
  skeleton: { paddingVertical: space[2] },
  skeletonRow: { paddingVertical: space[3], borderBottomWidth: 1 },
  progressTrack: { height: touch.topline, overflow: "hidden" },
  progressRun: { width: "32%", height: touch.topline },
  radio: { width: 16, height: 16, borderWidth: 1.5, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 8, height: 8, borderRadius: radius.pill },
  track: { width: 44, height: 26, borderWidth: 1.5, padding: 2, justifyContent: "center" },
  trackLarge: { width: 58, height: 34, borderWidth: 1.5, padding: 4, justifyContent: "center" },
  trackOn: { alignItems: "flex-end" },
  knob: { width: 18, height: 18 },
  knobLarge: { width: 24, height: 24 },
});
