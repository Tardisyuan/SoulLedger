/**
 * The navigator's chrome, drawn by the app instead of the platform — v4 (V4Batch07 05 App): no band. Every
 * title bar is the page's own ground with the header light (`GlowTop`) and the civilization's pattern behind
 * it. A tab's root wears the big title: the outline seal (38) in the civilization's colour, the title in the
 * serif at 30/38 and its sub line (civilization · life · hall) in --sub. Every other bar is one row, title 20.
 * Before sign-in, or for a civilization the app does not know, the light is grey and there is no seal.
 * 第三十批: every page's top is a 2px line in the civilization's colour (`Topline`); the tab bar is four single
 * characters, each over its small label.
 */
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { pillarIsWide } from "@soulledger/core/domain/pillar";
import { thisLifeLabel } from "@soulledger/core/domain/lifeLabel";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AssistScreen } from "@soulledger/core/api/soul-assist";
import { createContext, useContext, useState, type ReactNode } from "react";

import { AssistEntry, useAssist } from "./assist";
import { BandPattern, GlowTop, Icon, type IconName } from "./emblems";
import { family, quoteFamily, titleFamily } from "./fonts";
import { useI18n } from "./i18n";
import { useCurrentHall } from "./useCurrentHall";
import { OutlineSeal } from "./seal";
import { SessionContext } from "./session";
import { radius, type Theme } from "./theme";
import { MAX_FONT_SCALE, Topline, Txt, enumText, useLayout, useTheme } from "./ui";

/**
 * The page's theme, for what a bar's control opens away from the bar. Since v4 the bar is on the page's own
 * ground, so it is the same theme; kept so a sheet opened from a bar never depends on where the bar is drawn
 * (the 书信 ⋯ menu was once band-coloured, its 举报 / 拉黑 red on 匾色, 2026-11-02).
 */
const PageThemeContext = createContext<Theme | null>(null);
export function usePageTheme(): Theme {
  const t = useTheme();
  return useContext(PageThemeContext) ?? t;
}

/**
 * The top of a page, from the status bar down, with whatever row the caller puts on it. v4 (V4Batch07 05 App)
 * draws no band: the page's own ground with the header light (`GlowTop`, the civilization's glow) and its pattern
 * behind the title, so what sits here is read in the page's own inks. (v3's solid `band` under onPlaque, gone
 * 2026-11-06.) The neutral skin's glow is a grey and it has no pattern.
 */
export function PlaqueFrame({ children, testID = "plaque" }: { children: ReactNode; testID?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  return (
    <View testID={testID} onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={[styles.frame, { backgroundColor: t.s0, paddingTop: insets.top }]}>
      {height ? (
        <>
          <GlowTop testID={`${testID}-glow`} color={t.glow} scheme={t.scheme} width={width} height={height} />
          <BandPattern civ={t.civ} color={t.glow} width={width} height={height} ringBase={height} />
        </>
      ) : null}
      <Topline />
      <PageThemeContext.Provider value={t}>{children}</PageThemeContext.Provider>
    </View>
  );
}

/** A title-bar action in the account icon's place (the 书信 tab's "new" / search, handoff chat 1b / 1e). */
export interface HeaderAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID: string;
  /** iOS "new": a 44pt square framed in onPlaque. */
  framed?: boolean;
  /** A word instead of the icon (朋友圈 「互动」, 第四十批 S-a); `label` stays the accessible name. */
  text?: string;
  /** A count on the action's top right (unread 互动); absent or empty: none. */
  badge?: string;
}

/**
 * The right end of a bar: 「问一问」 when the page has one, then its actions, else the account
 * icon, else an empty 44pt slot.
 */
function BarEnd({ action, onAccount, assist }: { action?: HeaderAction | HeaderAction[]; onAccount?: () => void; assist?: AssistScreen }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const entry = assist ? <AssistEntry screen={assist} /> : null;
  if (action)
    return (
      <>
        {entry}
        {(Array.isArray(action) ? action : [action]).map((a) => (
          <Pressable
            key={a.testID}
            testID={a.testID}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={a.onPress}
            style={({ pressed }) => [styles.icon, a.text ? styles.textAction : null, a.framed && { borderWidth: 1, borderColor: t.ink }, pressed && { backgroundColor: t.s2 }]}
          >
            {a.text ? (
              <Txt variant="label" tone="ink">
                {a.text}
              </Txt>
            ) : (
              <Icon name={a.icon} size={18} color={t.ink} strokeWidth={1.4} />
            )}
            {a.badge ? (
              <View testID={`${a.testID}-badge`} style={[styles.actionBadge, { backgroundColor: t.ink }]}>
                <Txt variant="label" style={[styles.actionBadgeText, { color: t.s0 }]}>
                  {a.badge}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        ))}
      </>
    );
  if (onAccount)
    return (
      <>
        {entry}
        <Pressable
          testID="header-account"
          accessibilityRole="button"
          accessibilityLabel={tr("soul_app.settings.title")}
          onPress={onAccount}
          style={({ pressed }) => [styles.icon, pressed && { backgroundColor: t.s2 }]}
        >
          <Icon name="person" size={18} color={t.ink} strokeWidth={1.2} />
        </Pressable>
      </>
    );
  return (
    <>
      {entry}
      <View style={styles.icon} />
    </>
  );
}

interface BarProps {
  title: string;
  /** 「问一问」 (canvas 1b): this page's id for the assistant; the entry sits left of the account icon or the actions. */
  assist?: AssistScreen;
  /** The app name on the pre-login bar, set in the serif (product decision 2026-09-26). */
  serif?: boolean;
  onBack?: () => void;
  /** One, or several side by side (朋友圈 1a: find people, my page). */
  action?: HeaderAction | HeaderAction[];
  /**
   * The person icon, top right, on the tabs. Round 1 had it open the sign-out sheet;
   * since round 4 it opens the settings page (language, notifications, sign out).
   */
  onAccount?: () => void;
}

/** The bar row, drawn inside a PlaqueFrame, in the page's inks. */
function Bar({ title, serif, onBack, action, onAccount, assist }: BarProps) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { compact } = useLayout();
  // Chat handoff 1e (Material): on Android the title sits at the left, with nothing held
  // open for a back key it does not have, and back is an arrow. iOS: centred, chevron.
  const android = Platform.OS === "android";
  const assistant = useAssist();
  const rightCount = (Array.isArray(action) ? action.length : 1) + (assist && assistant?.visible ? 1 : 0);
  return (
    <View testID="header-bar" style={[styles.bar, compact && styles.barCompact]}>
      {onBack ? (
        <Pressable testID="header-back" accessibilityRole="button" accessibilityLabel={tr("common.back")} onPress={onBack} hitSlop={6} style={styles.icon}>
          <Icon name={android ? "arrow" : "back"} size={android ? 20 : 17} color={t.inkMuted} strokeWidth={1.4} />
        </Pressable>
      ) : android ? null : (
        // iOS centres the title: as wide on the left as the actions are on the right.
        <View style={[styles.icon, { width: 44 * rightCount }]} />
      )}
      <Txt
        accessibilityRole="header"
        variant="nav"
        numberOfLines={2}
        style={[
          styles.title,
          android && !onBack && styles.titleStart,
          { textAlign: onBack || android ? "left" : "center" },
          // 20 / 600 in v3's title serif (Noto Serif SC 600), as the band's title; the pre-login app
          // name keeps its quote serif (product decision 2026-09-26).
          styles.barTitle,
          { fontFamily: serif ? quoteFamily(title) : titleFamily(title) },
        ]}
      >
        {title}
      </Txt>
      <BarEnd action={action} onAccount={onAccount} assist={assist} />
    </View>
  );
}

/** Every title bar that is not a tab's root: one row on the band. */
export function AppHeader(props: BarProps) {
  return (
    <PlaqueFrame testID="header">
      <Bar {...props} />
    </PlaqueFrame>
  );
}

/**
 * A tab's root: the short identity band — the meta line (civilization · life · hall, mono 11,
 * as the life tab's band), then the seal, the title and the bar's own end. The title takes two
 * lines before it is cut. Neutral (an unrecognised civilization) or no session: one row.
 */
export function PlaqueHeader({
  title,
  onAccount,
  action,
  assist,
}: {
  title: string;
  onAccount?: () => void;
  action?: HeaderAction | HeaderAction[];
  assist?: AssistScreen;
}) {
  const t = useTheme();
  const { t: tr, enumLabel } = useI18n();
  const hall = useCurrentHall();
  const session = useContext(SessionContext);
  const me = session?.state.status === "signedIn" ? session.state.profile : null;
  if (t.civ === "neutral" || !me) return <AppHeader title={title} onAccount={onAccount} action={action} assist={assist} />;
  const meta = [enumText(enumLabel("souls.civilizations", me.civilization), tr), thisLifeLabel(tr, me.civilization, me.account.cycle + 1) ?? tr("soul_app.life.cycle", { cycle: String(me.account.cycle + 1) }), hall]
    .filter(Boolean)
    .join(" · ");
  return (
    <PlaqueFrame>
      <View style={styles.plaque}>
        <View style={styles.plaqueRow}>
          <OutlineSeal civ={t.civ} size={38} color={t.plaque} glyphs={me.tenant.seal_glyphs} label={tr("seal.aria", { court: hall })} testID="plaque-seal" />
          <View style={styles.plaqueText}>
            {/* v4 大标题: the title in the serif at 30/38, the line under it in --sub 13 (「第三世 · 地府」). */}
            <Txt testID="plaque-title" accessibilityRole="header" variant="display" numberOfLines={2} style={{ fontFamily: titleFamily(title) }}>
              {title}
            </Txt>
            <Txt testID="plaque-meta" variant="caption" tone="muted" numberOfLines={1}>
              {meta}
            </Txt>
          </View>
          <BarEnd action={action} onAccount={onAccount} assist={assist} />
        </View>
      </View>
    </PlaqueFrame>
  );
}

/**
 * The tab glyph's size: one character (a Han glyph, en's single letter) is the 18 title serif; a word (egy's Ankh /
 * Mesut / Shemes / Shemsu, up to 6 letters; Design egy batch 31) is 12 on the same 22 line, so it neither wraps nor
 * is cut and the bar does not jump. Exported for the test.
 */
export const tabGlyphSize = (glyph: string): number => (Array.from(glyph).length > 1 ? 12 : 18);

/** 第三十批 底栏: each tab is one character (世 / 信 / 圈 / 生) over its small label. Literal keys: messages.test harvests them. */
const TAB_GLYPHS: Record<string, string> = {
  Life: "soul_app.tabs.glyph_life",
  Applications: "soul_app.tabs.glyph_rebirth",
  Letters: "soul_app.tabs.glyph_letters",
  Circle: "soul_app.tabs.glyph_circle",
};

const STACKED_TAB_LABEL_SCALE = 1.5;

/**
 * 第三十批 底栏 (step 1 灵魂端): the four items as one character in the title serif (18/22) over an 11 label, on
 * the page's ground under a hairline. The current item is ink with a 14×2 rule in the civilization's colour under
 * its character (the focus is one of the four places that colour may go); the rest are --faint-text. The
 * character is hidden from screen readers: the tab is named by its label. C14: when any label is too long for one
 * line (`pillarIsWide`, the web's pillar rule) all of them may take two lines; a label that still does not fit is
 * cut and read whole by its accessibility label. At >= 1.7x text (handoff 2d) the items become rows, as before.
 * (v4's floating capsule, opaque at the page's foot since 用户 2026-11-06, went with this.)
 */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  const { stack } = useLayout();
  const labels = state.routes.map((route) => descriptors[route.key].options.title ?? route.name);
  const wide = pillarIsWide(labels);
  return (
    <View testID="tab-bar-ground" style={[styles.tabGround, { backgroundColor: t.s0, borderTopColor: t.hair, paddingBottom: Math.max(insets.bottom - 12, 8) }]}>
      <View testID="tab-bar" style={stack ? [styles.tabsStacked, { borderColor: t.hair2 }] : styles.tabs}>
        {state.routes.map((route, index) => {
          const selected = state.index === index;
          const { tabBarBadge } = descriptors[route.key].options;
          const label = labels[index];
          const color = selected ? t.ink : t.faintText;
          const glyph = TAB_GLYPHS[route.name] ? tr(TAB_GLYPHS[route.name]) : label.slice(0, 1);
          return (
            <Pressable
              key={route.key}
              testID={`tab-${route.name}`}
              accessibilityRole="tab"
              accessibilityLabel={tabBarBadge ? `${label}, ${tabBarBadge}` : label}
              accessibilityState={{ selected }}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              style={({ pressed }) => [
                stack ? [styles.tabRow, { borderBottomColor: t.hair }] : [styles.tab, wide && styles.tabWide],
                !selected && pressed && { backgroundColor: t.s2 },
              ]}
            >
              <View style={styles.tabGlyphBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Txt testID={`tab-${route.name}-glyph`} maxFontSizeMultiplier={STACKED_TAB_LABEL_SCALE} style={[styles.tabGlyph, { fontSize: tabGlyphSize(glyph), color, fontFamily: titleFamily(glyph) }]}>
                  {glyph}
                </Txt>
                {selected ? <View testID="tab-current-mark" style={[styles.tabCurrent, { backgroundColor: t.plaque }]} /> : null}
                {tabBarBadge ? <View testID={`tab-${route.name}-badge`} style={[styles.tabBadge, { backgroundColor: t.ink }]} /> : null}
              </View>
              <Txt
                testID={`tab-${route.name}-label`}
                variant="label"
                numberOfLines={wide || stack ? 2 : 1}
                // Stacked, four rows share the screen with the page: the label stops at 1.5x (11 → 16.5pt)
                // instead of the app's 2.35 cap.
                maxFontSizeMultiplier={stack ? STACKED_TAB_LABEL_SCALE : MAX_FONT_SCALE}
                style={[styles.tabLabel, { color, fontFamily: family.ui[selected ? 600 : 400] }]}
              >
                {label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 4 },
  barCompact: { minHeight: 48, paddingHorizontal: 2 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  textAction: { width: undefined, minWidth: 44, paddingHorizontal: 8 },
  actionBadge: { position: "absolute", top: 4, right: 0, minWidth: 16, height: 16, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  actionBadgeText: { fontSize: 10, lineHeight: 14, letterSpacing: 0 },
  title: { flex: 1, paddingHorizontal: 4 },
  /** 补足 A3: 20 / 28 — the simplified plaque's title. */
  barTitle: { fontSize: 20, lineHeight: 28, letterSpacing: 0 },
  /** 16 from the edge, as 1e draws it: the bar's 4 plus this. */
  titleStart: { paddingLeft: 12 },
  frame: { overflow: "hidden" },
  /** 第三十批 底栏: the page's ground under a hairline, the four items 56 high. */
  tabGround: { paddingHorizontal: 8, paddingTop: 4, borderTopWidth: 1 },
  tabs: { flexDirection: "row", minHeight: 56 },
  tab: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 2, borderRadius: radius.control },
  tabWide: { justifyContent: "flex-start", paddingTop: 4 },
  tabsStacked: { flexDirection: "column", borderWidth: 1, borderRadius: radius.dialog, overflow: "hidden" },
  tabRow: { minHeight: 48, paddingVertical: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderBottomWidth: 1 },
  tabGlyphBox: { alignItems: "center" },
  /** v4's title serif: 18 / 22. */
  tabGlyph: { fontSize: 18, lineHeight: 22, letterSpacing: 0 },
  /** The current item's 14 × 2 rule, 3 under its character. */
  tabCurrent: { position: "absolute", bottom: -3, width: 14, height: 2, borderRadius: 1 },
  tabBadge: { position: "absolute", top: -2, right: -8, width: 8, height: 8, borderRadius: radius.pill },
  /** v4: 11 / 14 under a 22 icon. */
  tabLabel: { fontSize: 11, lineHeight: 14, letterSpacing: 0, textAlign: "center" },
  /** v4 page header: the seal, then the big title over its sub line. */
  plaque: { paddingTop: 12, paddingBottom: 16, paddingLeft: 16, paddingRight: 4 },
  plaqueRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  plaqueText: { flex: 1, minWidth: 0 },
});
