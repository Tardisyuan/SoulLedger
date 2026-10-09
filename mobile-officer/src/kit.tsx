/**
 * The officer app's own small pieces, built on the soul app's tokens (see shared.ts): the four
 * states every tab shares, a list row, the 44-high square action buttons, the segmented switch,
 * the identity band and the five-tab bar. Constraints from the spec (§七): buttons 44 high and
 * square; rows 56 / 64 / 72 / 88 high; spacing 4 / 8 / 12 / 16 / 24; the civilization colour only
 * on the identity band, the primary button and the current tab; states by glyph plus words.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HIGHLIGHT_ALPHA, HIGHLIGHT_MS } from "./rules";
import { Button, GUTTER, Notice, Txt, family, space, useI18n, useReducedMotion, useTheme } from "./shared";

// ── the four states ────────────────────────────────────────────────────

export type ViewState = "loading" | "empty" | "error" | "denied";

/** Five 72-high skeleton rows; `accessibilityState.busy` is the app's `aria-busy`. */
export function LoadingRows() {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View testID="state-loading" accessible accessibilityLabel={tr("soul_app.common.loading")} accessibilityState={{ busy: true }}>
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
}: {
  state: ViewState;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyBody?: string;
  role?: string;
  area?: string;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  if (state === "loading") return <LoadingRows />;
  if (state === "error") {
    return (
      <View testID="state-error" style={styles.state}>
        <Notice tone="neg">{`! ${tr("officer_app.state.error_title")}`}</Notice>
        <Txt variant="caption" tone="muted">
          {tr("officer_app.state.error_body")}
        </Txt>
        {onRetry ? <Button testID="state-retry" kind="secondary" title={tr("soul_app.common.retry")} onPress={onRetry} /> : null}
      </View>
    );
  }
  if (state === "denied") {
    return (
      <View testID="state-denied" style={styles.state}>
        <Txt variant="title">{`□ ${tr("officer_app.state.denied_title")}`}</Txt>
        <Txt variant="body" tone="muted">
          {tr("officer_app.state.denied_body", { role: role ?? "", area: area ?? "" })}
        </Txt>
      </View>
    );
  }
  return (
    <View testID="state-empty" style={styles.state}>
      <Txt variant="title" style={{ color: t.ink }}>
        {emptyTitle ?? ""}
      </Txt>
      {emptyBody ? (
        <Txt variant="body" tone="muted">
          {emptyBody}
        </Txt>
      ) : null}
    </View>
  );
}

// ── rows ───────────────────────────────────────────────────────────────

/**
 * A list row: at least `minHeight` (56 / 64 / 72 / 88), the title bold when `strong`, a state glyph
 * and words on the first line. `highlight` lays `ink / .07` over the row and fades it out over
 * 1.2 s -- not at all when the system asks for reduced motion.
 */
export function Row({
  title,
  lines = [],
  glyph,
  strong,
  onPress,
  right,
  highlight,
  minHeight = 72,
  testID,
}: {
  title: string;
  lines?: string[];
  glyph?: string;
  strong?: boolean;
  onPress?: () => void;
  right?: ReactNode;
  highlight?: boolean;
  minHeight?: 56 | 64 | 72 | 88;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { minHeight, borderBottomColor: t.hair, backgroundColor: pressed ? t.hair : "transparent" }]}
    >
      {highlight ? <Highlight /> : null}
      {glyph ? (
        <Txt variant="bodyLg" tone="muted" style={styles.glyph}>
          {glyph}
        </Txt>
      ) : null}
      <View style={styles.rowText}>
        <Txt variant="section" style={strong ? undefined : { fontFamily: family.ui[500] }}>
          {title}
        </Txt>
        {lines.map((line, i) => (
          <Txt key={i} variant="caption" tone="muted">
            {line}
          </Txt>
        ))}
      </View>
      {right}
    </Pressable>
  );
}

/** The pushed row's wash. Nothing is drawn under reduce-motion (spec §五). */
export function Highlight() {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [alpha] = useState(() => new Animated.Value(HIGHLIGHT_ALPHA));
  useEffect(() => {
    if (reduced) return;
    const run = Animated.timing(alpha, { toValue: 0, duration: HIGHLIGHT_MS, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [alpha, reduced]);
  if (reduced) return null;
  return <Animated.View testID="row-highlight" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.ink, opacity: alpha }]} />;
}

// ── buttons ────────────────────────────────────────────────────────────

/**
 * 44 high, square. `outline`: the secondary (ink3 border); `ink-outline`: ink border (驳回);
 * `ink`: ink-solid (the reject confirmation -- never the civilization colour); `primary`: the
 * hall's colour (批准).
 */
export function ActionButton({
  title,
  onPress,
  kind,
  busy,
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  kind: "outline" | "ink-outline" | "ink" | "primary";
  busy?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const look =
    kind === "primary"
      ? { bg: t.plaqueFill, border: t.plaqueFill, ink: t.onPlaque }
      : kind === "ink"
        ? { bg: t.ink, border: t.ink, ink: t.s0 }
        : { bg: "transparent", border: kind === "ink-outline" ? t.ink : t.inkSubtle, ink: t.ink };
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: look.bg, borderColor: look.border, opacity: pressed || busy ? 0.7 : 1 }, style]}
    >
      <Txt variant="nav" style={[styles.actionText, { color: look.ink }]}>
        {title}
      </Txt>
    </Pressable>
  );
}

/** A two-way (or n-way) switch: 「我手上 / 待认领」, 「查灵魂 / 问一问」. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View testID={testID} accessibilityRole="tablist" style={[styles.segmented, { borderColor: t.inkSubtle }]}>
      {options.map(({ key, label }) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            testID={testID ? `${testID}-${key}` : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(key)}
            style={[styles.segment, { backgroundColor: on ? t.ink : "transparent" }]}
          >
            <Txt variant="nav" style={{ color: on ? t.s0 : t.ink, letterSpacing: 0 }}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── identity band & tab bar ────────────────────────────────────────────

/**
 * 身份带: compact, 48 high, the officer's HALL -- fixed for the account, never changing with a
 * soul -- in the hall's colour. A soul from another civilization is marked inside rows and
 * details in words, not here.
 */
export function IdentityBand({ hall, name }: { hall: string; name: string }) {
  const t = useTheme();
  const { top } = useSafeAreaInsets();
  return (
    <View testID="identity-band" style={{ backgroundColor: t.band, paddingTop: top }}>
      <View style={styles.band}>
        <Txt variant="nav" numberOfLines={1} style={[styles.bandHall, { color: t.onPlaque }]}>
          {hall}
        </Txt>
        <Txt variant="caption" numberOfLines={1} style={[styles.bandName, { color: t.onPlaque }]}>
          {name}
        </Txt>
      </View>
    </View>
  );
}

export type TabKey = "todo" | "queue" | "search" | "notices" | "me";
export const TABS: readonly { key: TabKey; glyph: string }[] = [
  { key: "todo", glyph: "◐" },
  { key: "queue", glyph: "§" },
  { key: "search", glyph: "⌕" },
  { key: "notices", glyph: "○" },
  { key: "me", glyph: "□" },
];

/** 56 high, five equal parts, surface-1 with a 1px top line. The current tab: civilization colour, 600. */
export function TabBar({ current, onSelect, unread }: { current: TabKey; onSelect: (tab: TabKey) => void; unread?: boolean }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { bottom } = useSafeAreaInsets();
  return (
    <View testID="tab-bar" accessibilityRole="tablist" style={[styles.tabBar, { backgroundColor: t.s1, borderTopColor: t.hair, paddingBottom: bottom }]}>
      {TABS.map(({ key, glyph }) => {
        const on = key === current;
        const colour = on ? t.plaque : t.inkMuted;
        return (
          <Pressable
            key={key}
            testID={`tab-${key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={tr(`officer_app.tabs.${key}`)}
            onPress={() => onSelect(key)}
            style={styles.tab}
          >
            <Txt variant="bodyLg" style={{ color: colour, fontFamily: family.glyph }}>
              {key === "notices" && unread ? "●" : glyph}
            </Txt>
            <Txt variant="caption" style={{ color: colour, fontFamily: on ? family.ui[600] : family.ui[400] }}>
              {tr(`officer_app.tabs.${key}`)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A band under the identity band that does not go away: the two-step-verification reminder. */
export function StandingBanner({ children, testID }: { children: string; testID?: string }) {
  const t = useTheme();
  return (
    <View testID={testID} accessibilityRole="alert" style={[styles.banner, { backgroundColor: t.warnBg, borderBottomColor: t.warn }]}>
      <Txt variant="caption" style={{ color: t.warn }}>{`! ${children}`}</Txt>
    </View>
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

const styles = StyleSheet.create({
  skeletonRow: { height: 72, justifyContent: "center", gap: space[3], paddingHorizontal: GUTTER, borderBottomWidth: 1 },
  state: { padding: GUTTER, gap: space[4] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: GUTTER, paddingVertical: space[3], borderBottomWidth: 1 },
  glyph: { width: 20, textAlign: "center", fontFamily: family.glyph },
  rowText: { flex: 1, gap: space[1] },
  action: { flex: 1, minHeight: 44, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space[3] },
  actionText: { letterSpacing: 0 },
  segmented: { flexDirection: "row", borderWidth: 1, marginHorizontal: GUTTER, marginVertical: space[3] },
  segment: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center" },
  band: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], paddingHorizontal: GUTTER },
  bandHall: { flexShrink: 1 },
  bandName: { flexShrink: 1, opacity: 0.9 },
  tabBar: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: space[1] },
  banner: { paddingHorizontal: GUTTER, paddingVertical: space[3], borderBottomWidth: 1 },
});
