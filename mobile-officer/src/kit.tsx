/**
 * The officer app's own small pieces, built on the soul app's tokens (see shared.ts): the four
 * states every tab shares, a list row, the 44-high square action buttons, the segmented switch,
 * the identity band and the five-tab bar. Constraints from the spec (§七): buttons 44 high and
 * square; rows 56 / 64 / 72 / 88 high; spacing 4 / 8 / 12 / 16 / 24; states by glyph plus words.
 * 第三十批 (卷宗): the civilization colour only in the 2px top line, the seal, the spine and focus -- the primary
 * button is ink-filled; the tinted status tag (`Tag`) and the touch sizes (`touch`) are here too.
 */
import { fetchFailureOf, responseCode, responseStatus } from "@soulledger/core/api/client";
import { requestIdOf } from "@soulledger/core/api/requestStamp";
import type { SoulErrorMessage } from "@soulledger/core/api/soul";
import { DOOR_ICON, officerDoors, type OfficerDoorKey, type OfficerPage } from "@soulledger/core/domain/doors";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { isDenied } from "./rules";
import { BusyLine, EASE, Emblem, GONE_OPACITY, HIGHLIGHT_ALPHA, GUTTER, GlowTop, GoneState, Notice, OneLine, ScreenError, Topline, Txt, family, motion, radius, space, useI18n, useAfter, useLandingFade, useLayout, useReducedMotion, useReducedMotionDurations, useTheme, Press, sharedTouch } from "./shared";

/**
 * Touch sizes (Design 第三十批 三 / 四), the web's values (`frontend/app/globals.css` `--control-h-*`, `--topline`):
 * controls 44 / 48 / 56, the 2px top line, a status tag 28 high (all `touch` in theme.ts), and a desk row 72.
 */
export const touch = { ...sharedTouch, row: 72 } as const;

// ── status tags ────────────────────────────────────────────────────────

/** Each tag's shape prefix (第三十批 一.2): a state is never told by colour alone. */
export const TAG_SHAPE = {
  reviewing: "◇",
  returned: "↺",
  overdue: "!",
  deferred: "‖",
  others: "◌",
  disposed: "▣",
  reincarnating: "↻",
  done: "✓",
  demerit: "−",
  merit: "+",
} as const;

export type TagTone = "neutral" | "pos" | "neg" | "warn";

/**
 * A tinted tag: no border, radius 4, 28 high. Neutral is `card2` under `sub`; the other three their colour on the
 * `posBg` / `negBg` / `warnBg` tint, the grounds the soul app's `Badge` reads (第六十七批 五.1; it was the colour at 14%).
 */
export function Tag({ tone = "neutral", children, testID }: { tone?: TagTone; children: string; testID?: string }) {
  const t = useTheme();
  const ink = tone === "neutral" ? t.inkMuted : t[tone];
  const ground = tone === "neutral" ? t.s2 : t[`${tone}Bg`];
  return (
    <View testID={testID} style={[styles.tag, { backgroundColor: ground }]}>
      <Txt variant="caption" numberOfLines={2} style={{ color: ink }}>
        {children}
      </Txt>
    </View>
  );
}

// ── the four states ────────────────────────────────────────────────────

/** `gone` (Design 第四十批 O-c) is a detail's own fifth state: what it showed is deleted or no longer this officer's to see. */
export type ViewState = "loading" | "empty" | "error" | "denied" | "gone";

/**
 * Where 「回到{from}」 goes from a detail that is gone: the list the officer came from. `onGone` lets that list grey
 * the row out once the officer is back (the shell keeps which ones). Without a provider the state has no button.
 */
export const GoneContext = createContext<{ from: string; onBack: () => void; onGone?: () => void } | null>(null);

/**
 * A detail's state: like `viewStateOf`, but a 404 or 403 is `gone` -- not `denied` (that is a whole tab the role
 * cannot see) and not `error` (nothing a retry fixes). Checked before the data, so a refresh that finds it gone
 * replaces what was on screen.
 */
export function detailStateOf<T>(r: { data: T | null; error: unknown }): ViewState | null {
  if (r.error && fetchFailureOf(r.error) === "gone") return "gone";
  return viewStateOf(r, () => false, () => false);
}

/** 「无权查看或已不存在」: the shared `GoneState`, with the way back from `GoneContext`. */
function GoneView() {
  const gone = useContext(GoneContext);
  const onGone = gone?.onGone;
  useEffect(() => onGone?.(), [onGone]);
  return <GoneState testID="state-gone" style={styles.state} from={gone?.from} onBack={gone?.onBack} />;
}

/** Five 72-high skeleton rows; `accessibilityState.busy` is the app's `aria-busy`. */
/**
 * `inContent`: the rows stand inside a screen's content (a dossier tab), not in the head's top-line position, so the
 * line is ink at 60% (第四十八批第三节 A9: only a loading line in the top line keeps the civilization's colour).
 */
export function LoadingRows({ inContent = false }: { inContent?: boolean } = {}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const reduced = useReducedMotion();
  // 第五十八批 M6: nothing for the first 400, as the soul app's `Skeleton`; `useRemote` / `useCached` keep a shown one 300.
  const shown = useAfter(motion.skeletonDelay);
  const [x] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  // The 32% run travels left to right and starts again, as the soul app's `Skeleton` line and the web's page-head
  // top line do; it stood still here from the start (found on the simulator 2026-11-16). Reduce motion: still.
  useEffect(() => {
    if (reduced || !width) return;
    const run = Animated.loop(Animated.timing(x, { toValue: 1, duration: motion.loadingLine, easing: EASE.standard, useNativeDriver: true }));
    run.start();
    return () => run.stop();
  }, [x, reduced, width]);
  if (!shown) return null;
  return (
    <View testID="state-loading" accessible accessibilityLabel={tr("soul_app.common.loading")} accessibilityState={{ busy: true }}>
      {/* 第三十批 一.5: a 2px line at the top, never a spinner. Where it takes the head's top line it counts as the top line
          (第四十八批第三节 A9) and keeps the civilization's colour; inside content it is ink at 60%. */}
      <View testID="state-loading-track" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: touch.topline, overflow: "hidden" }}>
        <Animated.View
          testID="state-loading-line"
          style={{
            height: touch.topline,
            width: "32%",
            backgroundColor: inContent ? t.ink : t.plaque,
            opacity: inContent ? 0.6 : 1,
            transform: [{ translateX: reduced ? 0 : x.interpolate({ inputRange: [0, 1], outputRange: [-0.32 * width, width] }) }],
          }}
        />
      </View>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={[styles.skeletonRow, { borderBottomColor: t.hair }]}>
          <View style={{ width: i % 2 ? "60%" : "78%", height: 12, backgroundColor: t.s2 }} />
          <View style={{ width: "40%", height: 10, backgroundColor: t.s2 }} />
        </View>
      ))}
    </View>
  );
}

/**
 * A failed officer request in the shape the shared `ScreenError` reads: no answer is `network`; otherwise the body's
 * `code`, or the status, carried in `unknown` (the soul app's `soulErrorMessage`, without pulling in the soul client).
 */
export function failureOf(error: unknown): SoulErrorMessage {
  const status = responseStatus(error);
  const message: SoulErrorMessage =
    status === null ? { key: "soul_app.errors.network" } : { key: "soul_app.errors.unknown", params: { code: responseCode(error) ?? String(status) } };
  const requestId = requestIdOf(error);
  return requestId ? { ...message, requestId } : message;
}

/**
 * One body for all four states, so no tab can forget one. `denied` carries the role and the area:
 * 「你的角色「{role}」看不到{area}」 -- and the tab itself stays in the bar.
 */
export function StateView({
  state,
  onRetry,
  emptyTitle,
  emptyBody,
  role,
  area,
  error,
}: {
  state: ViewState;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyBody?: string;
  role?: string;
  area?: string;
  /** What failed, for the code at the foot of the error state. */
  error?: unknown;
}) {
  const t = useTheme();
  const { t: tr, enumLabel } = useI18n();
  if (state === "loading") return <LoadingRows />;
  if (state === "gone") return <GoneView />;
  if (state === "error") {
    // 第六十七批 五.3: the soul app's full-page error, not a red Notice (第六十一批 E2).
    return (
      <ScreenError
        testID="state-error"
        retryTestID="state-retry"
        title={tr("officer_app.state.error_title")}
        body={tr("officer_app.state.error_body")}
        error={error ? failureOf(error) : undefined}
        onRetry={onRetry}
      />
    );
  }
  if (state === "denied") {
    return (
      <View testID="state-denied" style={styles.state}>
        <Txt variant="title">{`□ ${tr("officer_app.state.denied_title")}`}</Txt>
        <Txt variant="body" tone="muted">
          {tr("officer_app.state.denied_body", { role: roleName(enumLabel, role), area: area ?? "" })}
        </Txt>
      </View>
    );
  }
  return (
    <View testID="state-empty" style={[styles.state, styles.empty]}>
      {/* The hall's mark at 96, ink 10% (第四十八批第三节 A8, as the soul app's): decoration, never a target. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.emptyMark}>
        <Emblem civ={t.civ} size={96} stroke={t.ink} />
      </View>
      <Txt variant="title" style={{ color: t.ink, textAlign: "center" }}>
        {emptyTitle ?? ""}
      </Txt>
      {emptyBody ? (
        <Txt variant="body" tone="muted" style={{ textAlign: "center" }}>
          {emptyBody}
        </Txt>
      ) : null}
    </View>
  );
}

// ── rows ───────────────────────────────────────────────────────────────

/**
 * A line under a row's title. `{ one }` (Design 第二十八批 S4, as in the soul app): an identifier, a time, an amount
 * or a status keeps to one line at any text size, cut with …, and a long press reads it in full.
 */
export type RowLine = string | { one: string };

/**
 * A list row: at least `minHeight` (56 / 64 / 72 / 88), the title bold when `strong`, a state glyph
 * and words on the first line. `highlight` lays `ink / .07` over the row and fades it out over
 * 1.2 s -- not at all when the system asks for reduced motion.
 *
 * `value`: a short value at the right (a count, a time), one line; at ≥ 1.5× text (S4) "text left, value right"
 * becomes two lines -- the value moves under the title. `right` (a ›, a ✓, a button) stays where it is.
 * `below`: content under the title and lines at the text column's full width (我的数's three numbers).
 */
/**
 * Design v4 第六十三批 二 e (E1): opacity 0 → 1 over `unreadIn` (160, enter curve) as it mounts, so a row turning back
 * reads as an answer, not as nothing having happened. `on` false, or reduce motion: there at once, no wrapper.
 */
function FadeIn({ on, testID, children }: { on: boolean; testID?: string; children: ReactNode }) {
  const { unreadIn } = useReducedMotionDurations();
  const run = on && unreadIn > 0;
  const [opacity] = useState(() => new Animated.Value(run ? 0 : 1));
  useEffect(() => {
    if (!run) {
      opacity.setValue(1);
      return;
    }
    const fade = Animated.timing(opacity, { toValue: 1, duration: unreadIn, easing: EASE.enter, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [run, opacity, unreadIn]);
  if (!run) return <>{children}</>;
  return (
    <Animated.View testID={testID} style={{ opacity }}>
      {children}
    </Animated.View>
  );
}

export function Row({
  title,
  lines = [],
  value,
  glyph,
  glyphLabel,
  glyphFadeIn,
  strong,
  onPress,
  right,
  below,
  highlight,
  minHeight = 72,
  testID,
  gone,
}: {
  /** What it opens is no longer there (O-c): the row is greyed and does nothing. */
  gone?: boolean;
  title: string;
  lines?: RowLine[];
  value?: string;
  glyph?: string;
  /** What the glyph means, when no other text on the row says it; without one the glyph is decoration and screen readers skip it. */
  glyphLabel?: string;
  /** The glyph fades in as it mounts (`unreadIn`, enter curve; reduce motion: at once) -- a notice's ● coming back. */
  glyphFadeIn?: boolean;
  strong?: boolean;
  onPress?: () => void;
  right?: ReactNode;
  below?: ReactNode;
  highlight?: boolean;
  minHeight?: 56 | 64 | 72 | 88;
  testID?: string;
}) {
  const t = useTheme();
  const { twoLine } = useLayout();
  const press = gone ? undefined : onPress;
  // A Text with a long press takes the touch from the row around it, so the row's press goes on it too.
  const valueText = value ? (
    <OneLine testID={testID ? `${testID}-value` : undefined} variant="body" tone="muted" onPress={press} style={twoLine ? undefined : styles.rowValue}>
      {value}
    </OneLine>
  ) : null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={press ? "button" : undefined}
      accessibilityState={gone ? { disabled: true } : undefined}
      disabled={!press}
      onPress={press}
      style={({ pressed }) => [styles.row, { minHeight, borderBottomColor: t.hair, backgroundColor: pressed ? t.hair : "transparent" }, gone ? { opacity: GONE_OPACITY } : null]}
    >
      {highlight ? <Highlight /> : null}
      {glyph ? (
        <FadeIn key={glyph} on={!!glyphFadeIn} testID={testID ? `${testID}-glyph-fade` : undefined}>
          <Txt
            variant="bodyLg"
            tone="muted"
            style={styles.glyph}
            {...(glyphLabel ? { accessibilityLabel: glyphLabel } : { accessibilityElementsHidden: true, importantForAccessibility: "no" as const })}
          >
            {glyph}
          </Txt>
        </FadeIn>
      ) : null}
      {/* Named only on a row with a value (where the value goes is what a test asks); lists count rows by testID prefix. */}
      <View testID={testID && value ? `${testID}-text` : undefined} style={styles.rowText}>
        <Txt variant="section" style={strong ? undefined : { fontFamily: family.ui[500] }}>
          {title}
        </Txt>
        {lines.map((line, i) =>
          typeof line === "string" ? (
            <Txt key={i} variant="caption" tone="muted">
              {line}
            </Txt>
          ) : (
            <OneLine key={i} variant="caption" tone="muted" onPress={press}>
              {line.one}
            </OneLine>
          )
        )}
        {twoLine ? valueText : null}
        {below}
      </View>
      {twoLine ? null : valueText}
      {right}
    </Pressable>
  );
}

/**
 * The pushed row's wash: ink at `HIGHLIGHT_ALPHA` (10%, 第五十九批: one strength on all three surfaces), on the one landing recipe both apps and the web share (`useLandingFade`:
 * held 1600, faded over 400, 2s in all; 第四十批 S-e). Nothing is drawn under reduce-motion (spec §五).
 */
export function Highlight() {
  const t = useTheme();
  const reduced = useReducedMotion();
  const fade = useLandingFade(true, reduced);
  const [opacity] = useState(() => Animated.multiply(fade, HIGHLIGHT_ALPHA));
  if (reduced) return null;
  return <Animated.View testID="row-highlight" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.ink, opacity }]} />;
}

// ── buttons ────────────────────────────────────────────────────────────

/**
 * 44 high, square. `outline`: the secondary (ink3 border); `ink-outline`: ink border (驳回);
 * `ink`: ink-solid (the reject confirmation); `primary` (批准): ink-solid too since 第三十批 五.1 -- the
 * civilization colour stays out of buttons. The two kinds are kept apart for their callers' meaning.
 * `busy` (第五十八批 M10): it stops taking presses and keeps its look, words and width; past 160 a line runs along its
 * foot in its own text colour at 60% (`BusyLine`, shared with the soul app).
 */
export function ActionButton({
  title,
  onPress,
  kind,
  busy,
  disabled,
  accessibilityHint,
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  kind: "outline" | "ink-outline" | "ink" | "primary";
  busy?: boolean;
  /** Greyed (s2 ground, ink3 text) and inert; give `accessibilityHint` the reason, as the sentence above it. */
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const inert = busy || disabled;
  const look = disabled
    ? { bg: t.s2, border: t.s2, ink: t.inkSubtle }
    : kind === "primary" || kind === "ink"
      ? { bg: t.ink, border: t.ink, ink: t.s0 }
        : { bg: "transparent", border: kind === "ink-outline" ? t.ink : t.inkSubtle, ink: t.ink };
  return (
    <Press
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: !!busy, disabled: !!inert }}
      disabled={inert}
      onPress={onPress}
      style={[styles.action, { backgroundColor: look.bg, borderColor: look.border }, style]}
    >
      <Txt variant="nav" style={{ color: look.ink }}>
        {title}
      </Txt>
      {busy && !disabled ? <BusyLine color={look.ink} testID={testID ? `${testID}-busy` : "action-busy"} /> : null}
    </Press>
  );
}

/** A two-way (or n-way) switch: 「我手上 / 待认领」. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  testID,
  disabled = false,
  role = "tablist",
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  testID?: string;
  /** 正在保存 / 没网:每一段都不可按,读屏也念「不可用」(不只是按了没反应)。 */
  disabled?: boolean;
  /** 切换视图的分段是 tablist(默认);在几个值里选一个(冤情等级)是 radiogroup,读屏念「单选按钮 · 已选」。 */
  role?: "tablist" | "radiogroup";
}) {
  const t = useTheme();
  const radio = role === "radiogroup";
  return (
    <View testID={testID} accessibilityRole={role} style={[styles.segmented, { borderColor: t.inkSubtle }, disabled && { opacity: 0.5 }]}>
      {options.map(({ key, label }) => {
        const on = key === value;
        return (
          <Press
            key={key}
            testID={testID ? `${testID}-${key}` : undefined}
            accessibilityRole={radio ? "radio" : "tab"}
            accessibilityState={radio ? { checked: on, disabled } : { selected: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(key)}
            style={[styles.segment, { backgroundColor: on ? t.ink : "transparent" }]}
          >
            {/* One line, always: four segments on a 360dp phone left 「他人手上 · 0」 its count on a second
                line (华为真机 10-29 第二轮). Four or more take 13pt, so the label fits, not cut; a label still too wide for
                its third (「Medu Kemet」, 华为真机 11-14) shrinks to fit rather than end in …. */}
            <Txt variant="nav" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[{ color: on ? t.s0 : t.ink }, options.length > 3 && styles.segmentTight]}>
              {label}
            </Txt>
          </Press>
        );
      })}
    </View>
  );
}

/**
 * One chip of `FilterChips`, alone: also the recent-reason chips above the reject box (D8), which have no count and
 * wrap instead of scrolling. A long label is cut to one line once a parent bounds the width.
 */
export function Chip({ label, count, on = false, size = "md", onPress, testID }: { label: string; count?: number; on?: boolean; size?: "md" | "lg"; onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Press
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={count == null ? label : `${label} · ${count}`}
      accessibilityState={{ selected: on }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      style={[styles.chip, size === "lg" && styles.chipLg, { borderColor: on ? t.ink : t.hair2, backgroundColor: on ? t.ink : "transparent" }]}
    >
      <Txt variant="caption" numberOfLines={1} style={{ flexShrink: 1, color: on ? t.s0 : t.ink, fontFamily: on ? family.ui[500] : family.ui[400] }}>
        {label}
      </Txt>
      {count == null ? null : (
        <Txt variant="value" style={{ color: on ? t.s0 : t.inkMuted }}>
          {count}
        </Txt>
      )}
    </Press>
  );
}

/**
 * 多选标签 + 数量角标 (Design batch 28 O2): the filter bar of the web's Social / CooldownDesk, on
 * the phone -- ONE row that scrolls sideways (never wraps), a hairline under it. Chips are 36 high
 * with a 44 touch target (padding and `hitSlop`); a count of 0 is still shown and the chip stays on.
 */
export function FilterChips<K extends string>({
  options,
  selected,
  onToggle,
  testID,
  size = "md",
}: {
  options: readonly { key: K; label: string; count: number }[];
  selected: readonly K[];
  onToggle: (key: K) => void;
  testID?: string;
  /** `lg`: the 393 chip (第三十批 一.4), 44 high and round (22). */
  size?: "md" | "lg";
}) {
  const t = useTheme();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: t.hair }}>
      <ScrollView testID={testID} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {options.map(({ key, label, count }) => (
          <Chip key={key} testID={testID ? `${testID}-${key}` : undefined} label={label} count={count} on={selected.includes(key)} size={size} onPress={() => onToggle(key)} />
        ))}
      </ScrollView>
    </View>
  );
}

// ── identity band & tab bar ────────────────────────────────────────────

/**
 * 身份带: compact, 48 high, the officer's HALL -- fixed for the account, never changing with a
 * soul -- and the officer's name. A soul from another civilization is marked inside rows and
 * details in words, not here.
 *
 * v4 (V4Batch07 05 App) draws no band: the page's own ground with the header light (`GlowTop`, the hall's glow), in the
 * page's inks -- the soul app's `PlaqueFrame` (mobile/src/chrome.tsx). Not imported from there: chrome.tsx pulls the
 * soul's session and assist into this bundle (sharedClosure.test.ts); the pieces it draws with live in emblems.tsx and
 * civHead.tsx, which are shared. (v3's solid band under onPlaque, gone 2026-11-06.) No texture here since 第四十六批第四节:
 * the paper texture is a first-level page's head only (`TabHead`), and this band is on every page.
 */
export function IdentityBand({ hall, name }: { hall: string; name: string }) {
  const t = useTheme();
  const { top } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  return (
    <View
      testID="identity-band"
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={{ backgroundColor: t.s0, paddingTop: top, overflow: "hidden", borderBottomWidth: 1, borderBottomColor: t.hair }}
    >
      {height ? <GlowTop testID="identity-band-glow" color={t.glow} scheme={t.scheme} width={width} height={height} /> : null}
      {/* 第三十批 一.1: the civilization's line at the top of every page — four shapes since 第四十六批 (civHead.tsx). */}
      <Topline />
      <View style={styles.band}>
        <Txt variant="nav" numberOfLines={1} style={[styles.bandHall, { color: t.ink, fontFamily: family.title }]}>
          {hall}
        </Txt>
        <Txt variant="caption" numberOfLines={1} tone="muted" style={styles.bandName}>
          {name}
        </Txt>
      </View>
    </View>
  );
}

/**
 * The pages a signed-in officer moves between. Since 第三十批 第 4 步 (九.5) they sit behind doors in the bar --
 * 审 (案卷台 + 待办: 待办 is the desk's 「我认领」 and the rest of what waits for this officer), 册 (查询) and 我 (我的 +
 * 通知, the unread dot on 我) -- and a door with two pages switches between them under the top bar (`PageSwitch`).
 * 律 has no page in this app (the statutes are read on the desk) and is not drawn: a door the officer cannot open is
 * not drawn at all. The pages keep their keys: links, pushes and the assistant still name them.
 */
export type TabKey = OfficerPage;
export type DoorKey = OfficerDoorKey;
/**
 * The doors and their pages are the shared definition (`@soulledger/core/domain/doors` `OFFICER_APP_DOORS`: the web's
 * five doors, the ones with a page here, then 我) -- not a second table. Each door's pages, the one it opens on first.
 */
const DOOR_LIST = officerDoors();
export const DOOR_PAGES = Object.fromEntries(DOOR_LIST.map((d) => [d.key, d.pages])) as Readonly<Record<DoorKey, readonly TabKey[]>>;
const DOORS = DOOR_LIST.map((d) => d.key);
/** Every page, door by door: the order `visibleTabs` answers in. */
export const TABS: readonly { key: TabKey }[] = DOOR_LIST.flatMap((d) => d.pages.map((key) => ({ key })));
export const doorOf = (page: TabKey): DoorKey => DOORS.find((d) => DOOR_PAGES[d].includes(page)) ?? "me";

/**
 * Which tabs this officer gets (RBAC decisions 30 / 31): a tab is drawn when the officer holds ANY of the codes its
 * own requests need, `null` = everyone (通知 and 我的 are the officer's own). 待办: each server group checks one of
 * these (officer_app/todo.py `build`; 城隍初审 / 枉死申诉 by city_god.execute / wangsi.execute since 2026-10-29);
 * 审判: the queue is `judgment.read`; 查询: the soul search is `soul.read`.
 * So 牛头马面 / 访客 (GUARDIAN / VIEWER) see 查询 and 通知 (and 我的) only. The server still decides every request;
 * this only keeps a role out of tabs that would answer 403.
 */
export const TAB_CODES: Readonly<Record<TabKey, readonly string[] | null>> = {
  todo: ["workflow.approve", "dispatch.approve", "soul_inbox.reply", "judgment.execute", "city_god.execute", "wangsi.execute"],
  queue: ["judgment.read"],
  search: ["soul.read"],
  notices: null,
  me: null,
};

export function visibleTabs(permissions: readonly string[] | undefined): TabKey[] {
  const held = new Set(permissions ?? []);
  return TABS.map((tab) => tab.key).filter((key) => TAB_CODES[key]?.some((code) => held.has(code)) ?? true);
}

/** A role code through the bundles (守护者), the raw code only for a role the bundles do not know (a custom one). */
export function roleName(enumLabel: ReturnType<typeof useI18n>["enumLabel"], role: string | null | undefined): string {
  const d = enumLabel("users.roles", role);
  return d.state === "known" ? d.label : (role ?? "");
}

/**
 * How far the bar's glyph and name grow with the system text size (App 手感, 2026-11-15): 18 / 11 reach 23.4 / 14.3 and
 * the cell (`minHeight` 56) grows past 56 only beyond that; the app's own cap (2.35x) would put a 42pt glyph over a 26pt
 * name in a 56-high bar. The name is also the cell's `accessibilityLabel`, so a reader hears it at any size.
 */
export const TAB_FONT_SCALE = 1.3;

/**
 * At least 56 high plus the safe area, equal parts (each at least 64 wide), the page's ground (s0, as the soul app's bar;
 * 第六十七批 五.2, it was surface-1) with a 1px top line: one cell per door that
 * has a page this officer gets (第三十八批 四). In zh each cell is the door's glyph in the serif (18 / 22) over its name;
 * in en / egy it is the shared 24px line icon (`DOOR_ICON`, the web's set) over its name (`officer_app.doors.*.label`,
 * Geist 500 11 / 16, batch 54 H3) --`.glyph` is drawn only in zh. The current door in ink (the icon's stroke 1.8), with a 14 x 2
 * ink line 3 under the glyph box (第四十八批第三节 A1; it was the civilization's colour). The unread dot (8, ink -- unread is not an error, 第六十七批 五.2 -- with a 2px ring of the bar's ground) sits on
 * 我's glyph box, 4 past its right edge and 1 above its top (九.5).
 */
export function TabBar({ current, onSelect, unread, tabs }: { current: TabKey; onSelect: (tab: TabKey) => void; unread?: boolean; tabs?: readonly TabKey[] }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const zh = locale === "zh-Hans";
  const { bottom } = useSafeAreaInsets();
  const on = doorOf(current);
  return (
    <View testID="tab-bar" accessibilityRole="tablist" style={[styles.tabBar, { backgroundColor: t.s0, borderTopColor: t.hair, paddingBottom: bottom }]}>
      {DOORS.map((door) => {
        const first = DOOR_PAGES[door].find((page) => !tabs || tabs.includes(page));
        if (!first) return null;
        const selected = door === on;
        const colour = selected ? t.ink : t.inkMuted;
        const dot = door === "me" && unread;
        return (
          <Press
            key={door}
            testID={`door-${door}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            // The dot is drawn, not read: the unread state goes into the label (review 2026-11-01).
            accessibilityLabel={dot ? tr("officer_app.doors.me_unread") : tr(`officer_app.doors.${door}.label`)}
            onPress={() => onSelect(first)}
            style={[styles.tab, { gap: zh ? 2 : 3 }]}
          >
            <View style={styles.mark}>
              {zh ? (
                <Txt maxFontSizeMultiplier={TAB_FONT_SCALE} style={{ color: colour, fontFamily: family.title, fontSize: 18, lineHeight: 22 }}>{tr(`officer_app.doors.${door}.glyph`)}</Txt>
              ) : (
                <Svg testID={`door-${door}-icon`} width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={colour} strokeWidth={selected ? 1.8 : 1.6} strokeLinecap="round" strokeLinejoin="round">
                  {DOOR_ICON[door].map((d) => (
                    <Path key={d} d={d} />
                  ))}
                </Svg>
              )}
              {selected ? <View testID={`door-${door}-current`} style={[styles.currentLine, { backgroundColor: t.ink }]} /> : null}
              {dot ? <View testID="door-me-unread" style={[styles.dot, { backgroundColor: t.ink, borderColor: t.s0 }]} /> : null}
            </View>
            <Txt variant="caption" numberOfLines={1} maxFontSizeMultiplier={TAB_FONT_SCALE} style={{ color: colour, fontSize: 11, lineHeight: 16, fontFamily: family.ui[zh ? 400 : 500] }}>
              {tr(`officer_app.doors.${door}.label`)}
            </Txt>
          </Press>
        );
      })}
    </View>
  );
}

/** The left-edge strip an iOS back swipe starts in (pt). */
export const EDGE_BACK_PT = 20;

/**
 * iOS's back swipe for a screen drawn over the tabs (App 手感, 2026-11-15): this app has no navigator (`b3aeab110` took
 * `react-native-screens` out on purpose), so the system gesture is not there, and the 「‹ 返回」 row sits in the corner a
 * thumb reaches last. A pan that starts within `EDGE_BACK_PT` of the left edge carries the page with the finger; let go
 * past a third of the width (or flung faster than 800 pt/s) the page carries on off the right edge over 160 on the exit
 * curve and then calls `onBack`; short of that it slides back over 160 on the exit curve, no bounce (第五十八批 M1 / M12).
 * Under reduce motion the page does not follow -- past the line it just closes. Android has its own back gesture (and `BackHandler`),
 * so there this is only its children. No `onBack` (a screen that must not be left yet): no gesture.
 */
export function EdgeBack({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const durations = useReducedMotionDurations();
  const [x] = useState(() => new Animated.Value(0));
  if (Platform.OS !== "ios") return <>{children}</>;
  const pan = Gesture.Pan()
    .withTestId("edge-back")
    .runOnJS(true)
    .enabled(!!onBack)
    .hitSlop({ left: 0, width: EDGE_BACK_PT })
    .activeOffsetX(12)
    .failOffsetY([-16, 16])
    .onUpdate((e) => {
      if (!reduced) x.setValue(Math.max(0, e.translationX));
    })
    .onEnd((e, ok) => {
      if (ok && (e.translationX > width / 3 || e.velocityX > 800)) {
        if (reduced) {
          onBack?.();
          return;
        }
        Animated.timing(x, { toValue: width, duration: motion.sheetOut, easing: EASE.exit, useNativeDriver: false }).start(() => {
          onBack?.();
          x.setValue(0); // a detail that only popped an inner layer stays: back in place
        });
      } else Animated.timing(x, { toValue: 0, duration: durations.sheetOut, easing: EASE.exit, useNativeDriver: false }).start();
    });
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: x }] }}>{children}</Animated.View>
    </GestureDetector>
  );
}

/**
 * 第五十八批 M1, the soul app's pattern without a navigator: a tab's page cross-fades in over `tabFade` (240, enter curve);
 * a screen drawn over the tabs (a detail, 我的's sub-screens, 滑卡) slides in from the right over the same 240. Under
 * reduce motion both are an 80 fade, nothing moves (M3). The shell keys it by what is shown, so each change plays once.
 */
export function PageEnter({ slide, children }: { slide: boolean; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const { tabFade } = useReducedMotionDurations();
  const [p] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(p, { toValue: 1, duration: tabFade, easing: EASE.enter, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [p, tabFade]);
  const moves = slide && !reduced;
  return (
    <Animated.View
      testID={slide ? "page-slide" : "page-fade"}
      style={{ flex: 1, opacity: moves ? 1 : p, transform: moves ? [{ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) }] : [] }}
    >
      {children}
    </Animated.View>
  );
}

/** Under the top bar of a door with two pages this officer gets (审: 案卷台 · 待办; 我: 我的 · 通知): which one is open. */
export function PageSwitch({ current, tabs, unread, onSelect }: { current: TabKey; tabs: readonly TabKey[]; unread?: boolean; onSelect: (tab: TabKey) => void }) {
  const { t: tr } = useI18n();
  const pages = DOOR_PAGES[doorOf(current)].filter((page) => tabs.includes(page));
  if (pages.length < 2) return null;
  return (
    <Segmented
      testID="tab"
      options={pages.map((key) => ({ key, label: tr(key === "notices" && unread ? "officer_app.tabs.notices_unread" : key === "queue" ? "officer_app.desk.title" : `officer_app.tabs.${key}`) }))}
      value={current}
      onChange={onSelect}
    />
  );
}

/** A band under the identity band that does not go away: the two-step-verification reminder. */
export function StandingBanner({ children, testID, action }: { children: string; testID?: string; action?: { label: string; onPress: () => void } }) {
  const t = useTheme();
  const colours = { backgroundColor: t.warnBg, borderBottomColor: t.warn };
  const text = (
    <Txt variant="caption" style={{ color: t.warn, flexShrink: 1 }}>{`! ${children}`}</Txt>
  );
  if (!action) {
    return (
      <View testID={testID} accessibilityRole="alert" style={[styles.banner, colours]}>
        {text}
      </View>
    );
  }
  // The whole band is the target (>= 44 high) and reads as ONE button: its text plus the action. The
  // action is a plain trailing label at the far right, not drawn as a button.
  return (
    <Press
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${children} ${action.label}`}
      onPress={action.onPress}
      style={[styles.banner, styles.bannerRow, colours]}
    >
      {text}
      <Txt testID={testID ? `${testID}-action` : undefined} variant="nav" style={{ color: t.warn }}>{`${action.label} ›`}</Txt>
    </Press>
  );
}

/**
 * Which of the four states a request is in, or `null` when there is data to draw. A 403 is the
 * "denied" state (the role cannot see the area), not an error; an error with data already on screen
 * keeps the data (a failed refresh must not wipe a list that was good a second ago).
 */
export function viewStateOf<T>(
  r: { data: T | null; error: unknown },
  isEmpty: (data: T) => boolean,
  isDeniedError: (error: unknown) => boolean
): ViewState | null {
  if (r.error && isDeniedError(r.error)) return "denied";
  if (r.data === null) return r.error ? "error" : "loading";
  return isEmpty(r.data) ? "empty" : null;
}

/**
 * The other half of `viewStateOf`: a refresh that failed while the list from before is still on screen.
 * The list stays; this says it may be out of date, with a way to try again. Nothing for a 403 (that is
 * `denied`, which replaces the list) or when there is no data (that is `error`).
 */
export function RefreshFailed({ data, error, onRetry }: { data: unknown; error: unknown; onRetry: () => void }) {
  const { t: tr } = useI18n();
  if (data === null || !error || isDenied(error)) return null;
  return (
    <View style={{ paddingHorizontal: GUTTER, paddingBottom: space[3] }}>
      <Notice tone="neg" onRetry={onRetry} testID="refresh-failed">
        {tr("officer_app.state.refresh_failed")}
      </Notice>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonRow: { height: 72, justifyContent: "center", gap: space[3], paddingHorizontal: GUTTER, borderBottomWidth: 1 },
  state: { padding: GUTTER, gap: space[4] },
  empty: { alignItems: "center", paddingTop: space[7] },
  emptyMark: { opacity: 0.1 },
  tag: { minHeight: touch.tag, borderRadius: radius.control, paddingHorizontal: space[2], justifyContent: "center", alignSelf: "flex-end" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: GUTTER, paddingVertical: space[3], borderBottomWidth: 1 },
  glyph: { width: 20, textAlign: "center", fontFamily: family.glyph },
  rowText: { flex: 1, gap: space[1] },
  rowValue: { flexShrink: 1, maxWidth: "60%" },
  action: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.control, alignItems: "center", justifyContent: "center", paddingHorizontal: space[3] },
  segmented: { flexDirection: "row", borderWidth: 1, borderRadius: radius.control, overflow: "hidden", marginHorizontal: GUTTER, marginVertical: space[3] },
  segment: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  // tabular-nums (Design 第六十一批): a count going from 「· 0」 to 「· 12」 does not shift the segment widths.
  segmentTight: { fontSize: 14, lineHeight: 20, fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: GUTTER, paddingVertical: space[2] },
  chipLg: { minHeight: 44, borderRadius: radius.control, paddingHorizontal: space[4] }, // 第五十六批：能点的东西一律 4,大号筛选签不再是胶囊
  chip: { minHeight: 36, paddingHorizontal: space[3], borderWidth: 1, borderRadius: radius.control, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2] },
  band: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], paddingHorizontal: GUTTER },
  bandHall: { flexShrink: 1 },
  bandName: { flexShrink: 1 },
  tabBar: { flexDirection: "row", borderTopWidth: 1 },
  // `minHeight`, not `height`: at large text the cell grows with its glyph and name instead of spilling over the page.
  tab: { flex: 1, minWidth: 64, minHeight: 56, paddingVertical: space[1], alignItems: "center", justifyContent: "center" },
  // The glyph box: 24 high. The current line sits 3 under it; the dot (8 plus its 2px ring) 4 past its right edge, 1 above it.
  mark: { minHeight: 24, minWidth: 24, alignItems: "center", justifyContent: "center" },
  // No percentage `left`: on Android it resolved against the wrong box and the line sat ~50 dp right of its glyph
  // (TAS-AL00, 2026-11-14). An absolute child with no left/right is centred by `mark`'s alignItems instead.
  currentLine: { position: "absolute", bottom: -1, width: 14, height: 2, borderRadius: 1 },
  dot: { position: "absolute", top: -3, right: -6, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  banner: { paddingHorizontal: GUTTER, paddingVertical: space[3], borderBottomWidth: 1 },
  bannerRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
});
