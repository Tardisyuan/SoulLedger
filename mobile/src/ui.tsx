/**
 * The soul app's primitives, per the design handoff "灵魂簿 App":
 *
 *   radius 0 everywhere — only the 2px focus ring and pill badges are round;
 *   depth is 1px hairlines between two surfaces, never a shadow;
 *   the only motion is a 120ms opacity change, and reduce-motion makes it 0.
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
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { Emblem, Icon, LedgerUnreachable } from "./emblems";
import { family, quoteFamily } from "./fonts";
import { useI18n } from "./i18n";
import { badgeSpec, layoutFor, stacksLabel, type BadgeSpec, type Layout } from "./rules";
import { motion, radius, space, themeFor, type Theme } from "./theme";

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

/** Fades its content in over 120ms when it mounts; instantly under reduce-motion. */
export function FadeIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: reduced ? 0 : motion.fade, useNativeDriver: true }).start();
  }, [opacity, reduced]);
  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}

// ── type ───────────────────────────────────────────────────────────────

/** The handoff's scale (1h-二). letterSpacing em values are converted to pt at each size. */
export const TYPE = {
  display: { fontSize: 27, lineHeight: 32, fontFamily: family.ui[600] },
  title: { fontSize: 19, lineHeight: 26, fontFamily: family.ui[600] },
  nav: { fontSize: 15, lineHeight: 20, fontFamily: family.ui[600], letterSpacing: 0.6 },
  body: { fontSize: 13, lineHeight: 22, fontFamily: family.ui[400] },
  bodyLg: { fontSize: 15, lineHeight: 24, fontFamily: family.ui[500] },
  label: { fontSize: 11.5, lineHeight: 16, fontFamily: family.ui[500], letterSpacing: 1 },
  section: { fontSize: 12.5, lineHeight: 18, fontFamily: family.ui[600], letterSpacing: 1.75 },
  caption: { fontSize: 12.5, lineHeight: 19, fontFamily: family.ui[400] },
  value: { fontSize: 13, lineHeight: 20, fontFamily: family.mono[400] },
  valueLg: { fontSize: 34, lineHeight: 38, fontFamily: family.mono[500] },
} satisfies Record<string, TextStyle>;

export type Tone = "ink" | "muted" | "subtle" | "accent" | "mark" | "neg" | "negInk" | "pos" | "onAccent";

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
  const { compact } = useLayout();
  return (
    <Text {...rest} style={[TYPE[variant], compact && COMPACT_TYPE[variant], { color: toneColor(t, tone) }, style]} />
  );
}

/** Handoff 2f-二: on a ≤ 340pt screen display and value-lg step down one size; everything else is unchanged. */
const COMPACT_TYPE: Partial<Record<keyof typeof TYPE, TextStyle>> = {
  display: { fontSize: 25, lineHeight: 30 },
  valueLg: { fontSize: 30, lineHeight: 34 },
};

/** Screen width and system text size → the handoff's three layout thresholds. */
export function useLayout(): Layout {
  const { width, fontScale } = useWindowDimensions();
  return layoutFor(width, fontScale);
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

export const GUTTER = space[5];

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  edges = ["left", "right", "bottom"],
  testID,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  edges?: Edge[];
  testID?: string;
}) {
  const t = useTheme();
  // The spinner belongs to a pull. A reload the app starts itself (tab refocus)
  // would otherwise open an empty band above the content on iOS (seen on the iPhone run).
  const [pulled, setPulled] = useState(false);
  if (pulled && !refreshing) setPulled(false);
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
        <ScrollView
          contentContainerStyle={styles.grow}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={pulled && !!refreshing}
                onRefresh={() => {
                  setPulled(true);
                  onRefresh();
                }}
                tintColor={t.accent}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
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
 * A titled part of a screen. With `onToggle` its header is a disclosure — a
 * button whose accessibility state says expanded or not, and nothing else.
 */
export function Section({
  title,
  count,
  open = true,
  onToggle,
  children,
  testID,
}: {
  title: string;
  count?: string;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  const { gutter } = useLayout();
  const pad = { paddingHorizontal: gutter };
  const header = (
    <>
      <Txt variant="section">{title}</Txt>
      {count ? (
        <Txt variant="value" tone="subtle" style={styles.count}>
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
  return (
    <View testID={testID} style={{ borderBottomWidth: 1, borderBottomColor: t.hair }}>
      {onToggle ? (
        <Pressable
          testID={testID ? `${testID}-toggle` : undefined}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={onToggle}
          style={({ pressed }) => [styles.sectionHeader, pad, pressed && styles.pressed]}
        >
          {header}
        </Pressable>
      ) : (
        <View style={[styles.sectionHeader, pad]}>{header}</View>
      )}
      {open ? <View style={[styles.sectionBody, pad]}>{children}</View> : null}
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

/** The focus ring: 2px accent, offset 2, radius 2 — drawn outside the field so nothing shifts. */
function FocusRing({ focused, children }: { focused: boolean; children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.ring, { borderColor: focused ? t.accent : "transparent" }]}>{children}</View>;
}

export function Input({
  label,
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
      <Txt variant="label" tone="muted">
        {label}
      </Txt>
      <FocusRing focused={focused}>
        <View style={[styles.inputBox, { backgroundColor: t.s1, borderColor: bad ? t.negStrong : t.hair }]}>
          <TextInput
            accessibilityLabel={label}
            placeholderTextColor={t.inkSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            multiline={multiline}
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
              { color: t.ink, fontFamily },
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
  const look =
    busy || (disabled && kind === "primary")
      ? { bg: busy ? t.s1 : t.s2, border: busy ? t.hair : t.s2, ink: t.inkSubtle }
      : kind === "primary"
        ? { bg: t.accent, border: t.accent, ink: t.onAccent }
        : kind === "danger"
          ? { bg: "transparent", border: t.negStrong, ink: t.neg }
          : { bg: "transparent", border: t.hair2, ink: disabled ? t.inkSubtle : t.inkMuted };
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
          kind === "secondary" && styles.buttonSecondary,
          { backgroundColor: look.bg, borderColor: look.border },
          pressed && styles.pressed,
        ]}
      >
        {busy ? <ActivityIndicator size="small" color={t.inkSubtle} /> : null}
        <Text
          numberOfLines={2}
          style={[kind === "secondary" ? styles.buttonTextSecondary : styles.buttonText, { color: look.ink }]}
        >
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
      style={({ pressed }) => [styles.small, { borderColor: t.hair2 }, pressed && styles.pressed]}
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

/** One part of a screen failed; the rest renders as usual. */
export function SectionError({ onRetry, testID }: { onRetry: () => void; testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.sectionBody}>
      <Notice tone="neutral" onRetry={onRetry} testID={testID}>
        {t("soul_app.errors.section")}
      </Notice>
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
  const color = { accent: t.accent, neg: t.neg, pos: t.pos, muted: t.inkMuted, unknown: t.inkSubtle }[spec.tone];
  const border = spec.tone === "unknown" ? t.hair2 : color;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={raw ? `${label} ${raw}` : label}
      style={[styles.badge, { borderColor: border, borderStyle: spec.border }]}
    >
      <Text style={[styles.badgeText, { color }]}>{spec.glyph}</Text>
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
  const label = d.state === "known" && spec.tone !== "unknown" ? (lexiconLabel ?? d.label) : d.state === "missing" ? t("common.value.unrecorded") : t("common.value.unrecognized");
  return <Badge testID={testID} spec={spec} label={label} raw={spec.tone === "unknown" ? d.raw : null} />;
}

/** Words someone said: a statement, an appeal, a rejection reason. The only place the serif appears. */
export function Quote({ text, tone = "neutral", testID }: { text: string; tone?: "neutral" | "appeal" | "rejection"; testID?: string }) {
  const t = useTheme();
  const { compact } = useLayout();
  const line = tone === "rejection" ? t.negStrong : tone === "appeal" ? t.accent : t.hair2;
  return (
    <View style={[styles.quote, compact && styles.quoteCompact, { borderLeftColor: line }]}>
      <Text
        testID={testID}
        style={[styles.quoteText, compact && styles.quoteTextCompact, { fontFamily: quoteFamily(text), color: tone === "rejection" ? t.ink : t.inkMuted }]}
      >
        {text}
      </Text>
    </View>
  );
}

// ── loading ────────────────────────────────────────────────────────────

/** Thin hairline-coloured bars in the shape of what is coming. No pulse. */
export function Skeleton({ lines = 3, testID }: { lines?: number; testID?: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const widths = ["70%", "90%", "50%", "80%", "60%"] as const;
  return (
    <View testID={testID} accessible accessibilityLabel={tr("soul_app.common.loading")} style={styles.skeleton}>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={{ width: widths[i % widths.length], height: 12, backgroundColor: t.hair }} />
      ))}
    </View>
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
}

export const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  grow: { flexGrow: 1 },
  center: { textAlign: "center" },
  pressed: { opacity: 0.8 },
  noSpacing: { letterSpacing: 0 },
  block: { paddingHorizontal: GUTTER, paddingVertical: GUTTER },
  count: { marginLeft: space[3] },
  sectionHeader: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER, paddingVertical: space[4] },
  sectionBody: { paddingHorizontal: GUTTER, paddingBottom: 18 },
  empty: { alignItems: "center", gap: 9, paddingVertical: 18 },
  divider: { flexDirection: "row", alignItems: "center", gap: space[3] },
  field: { gap: space[2] },
  ring: { margin: -4, padding: 2, borderWidth: 2, borderRadius: radius.focus },
  inputBox: { flexDirection: "row", borderWidth: 1, minHeight: 48 },
  input: { flex: 1, minHeight: 46, paddingHorizontal: 13, fontSize: 15 },
  monoInput: { fontSize: 16, letterSpacing: 2.2 },
  multiline: { minHeight: 128, paddingVertical: 13, fontSize: 15, lineHeight: 26, textAlignVertical: "top" },
  reveal: { width: 52, alignItems: "center", justifyContent: "center", borderLeftWidth: 1 },
  revealRow: { minHeight: 60, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  iconRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  iconNudge: { marginTop: 3 },
  buttonWrap: { gap: 11 },
  button: {
    minHeight: 50,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  buttonSecondary: { minHeight: 46 },
  buttonText: { fontFamily: family.ui[600], fontSize: 15, lineHeight: 20, letterSpacing: 0.9, textAlign: "center" },
  buttonTextSecondary: { fontFamily: family.ui[500], fontSize: 14, lineHeight: 19, textAlign: "center" },
  notice: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderLeftWidth: 3, paddingVertical: 11, paddingHorizontal: 13 },
  small: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  screenError: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], paddingHorizontal: 28, paddingVertical: 52 },
  retry: { alignSelf: "stretch", marginTop: space[1] },
  errorCode: { fontSize: 11, opacity: 0.8 },
  rows: { gap: 9 },
  row: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  rowStacked: { flexDirection: "column", gap: 4 },
  rowLabel: { minWidth: 56, maxWidth: "45%" },
  badge: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: 28,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  badgeText: { fontFamily: family.ui[500], fontSize: 11.5, lineHeight: 16, letterSpacing: 0.9 },
  badgeRaw: { fontFamily: family.mono[400], fontSize: 10.5, lineHeight: 16, opacity: 0.85 },
  quote: { borderLeftWidth: 2, paddingLeft: 14, paddingVertical: 2 },
  quoteText: { fontSize: 16, lineHeight: 30 },
  quoteCompact: { paddingLeft: 12 },
  quoteTextCompact: { fontSize: 15.5, lineHeight: 29 },
  skeleton: { gap: 10, paddingVertical: space[4] },
});
