/**
 * The navigator's chrome, drawn by the app instead of the platform — v3: every title bar is
 * the identity band (the civilization's colour with 10% #111, `Theme.band`), as the life tab
 * draws it. A tab's root wears the short band (the Web's 116 band at phone width, round-7
 * `.queue-mobile .identity-band`): the meta line in mono, then the outline seal (38) and the
 * title at 20 / 600 in the interface face. Every other bar is one row on the same ground.
 * No ornament band, no texture, no civilization display face (v2's 匾, gone 2026-10-02).
 * Before sign-in, or for a civilization the app does not know, the band is the neutral one
 * and has no seal. The tab bar marks its current item with a 2px rule in the colour.
 */
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { pillarIsWide } from "@soulledger/core/domain/pillar";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AssistScreen } from "@soulledger/core/api/soul-assist";
import { useContext, type ReactNode } from "react";

import { AssistEntry, useAssist } from "./assist";
import { Emblem, Icon, type IconName } from "./emblems";
import { family, quoteFamily } from "./fonts";
import { useI18n } from "./i18n";
import { useCurrentHall } from "./screens/letters";
import { OutlineSeal } from "./seal";
import { SessionContext } from "./session";
import type { Theme } from "./theme";
import { ThemeContext, Txt, enumText, shade, useLayout, useTheme } from "./ui";

/**
 * The theme for what sits ON a plaque: every ink is onPlaque (>= 4.5 on every 匾色,
 * theme.test), the grounds are the plaque, hairlines are onPlaque at low alpha. So a
 * bar's own parts — a back chevron in `inkMuted`, a title in `ink` — need no second
 * code path to be read on it.
 */
export function onPlaqueTheme(t: Theme): Theme {
  const on = t.onPlaque;
  return { ...t, s0: t.band, s1: t.band, s2: shade(t.band, 0.12), ink: on, inkMuted: on, inkSubtle: on, hair: `${on}33`, hair2: `${on}59` };
}

/** The band's ground, from the status bar down, with whatever row the caller puts on it. */
export function PlaqueFrame({ children, testID = "plaque" }: { children: ReactNode; testID?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} style={{ backgroundColor: t.band, paddingTop: insets.top }}>
      <ThemeContext.Provider value={onPlaqueTheme(t)}>{children}</ThemeContext.Provider>
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
}

/**
 * The right end of a bar: 「问一问」 when the page has one, then its actions, else the account
 * icon, else an empty 44pt slot. Drawn on the plaque.
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
            style={({ pressed }) => [styles.icon, a.framed && { borderWidth: 1, borderColor: t.ink }, pressed && { backgroundColor: t.s2 }]}
          >
            <Icon name={a.icon} size={18} color={t.ink} strokeWidth={1.4} />
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

/** The bar row, drawn inside a PlaqueFrame (so its theme is `onPlaqueTheme`). */
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
          // 20 / 600 in the interface face, as the band's title; the pre-login app name keeps its serif.
          styles.barTitle,
          serif && { fontFamily: quoteFamily(title) },
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
  const meta = [enumText(enumLabel("souls.civilizations", me.civilization), tr), tr("soul_app.life.cycle", { cycle: String(me.account.cycle + 1) }), hall]
    .filter(Boolean)
    .join(" · ");
  return (
    <PlaqueFrame>
      <View style={styles.plaque}>
        <Txt testID="plaque-meta" numberOfLines={1} style={styles.plaqueMeta}>
          {meta}
        </Txt>
        <View style={styles.plaqueRow}>
          <OutlineSeal civ={t.civ} size={38} color={t.onPlaque} glyphs={me.tenant.seal_glyphs} label={tr("seal.aria", { court: hall })} testID="plaque-seal" />
          <Txt testID="plaque-title" accessibilityRole="header" numberOfLines={2} style={styles.plaqueTitle}>
            {title}
          </Txt>
          <BarEnd action={action} onAccount={onAccount} assist={assist} />
        </View>
      </View>
    </PlaqueFrame>
  );
}

const TAB_ICONS: Record<string, IconName> = { Life: "ledger", Applications: "cycle", Letters: "letter", Circle: "circle" };

/**
 * 补足 B11: the current tab is a 2px 匾色 rule on top and its label in ink 600; the others
 * ink3. C14: the same width rule as the web's pillar (`pillarIsWide`, from core) — when
 * any label is too long for one line, all four labels go to two lines at 11, with 4pt
 * sides; a label that still does not fit is cut, and read whole by its accessibility label.
 */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  // v3: the bar wears v3's neutrals; the current item's emblem and rule are the civilization's
  // colour. Its label stays ink 600: v3 sets it in the colour too, but every dark civilization
  // colour is under 4.5:1 on the dark surface (3.13–4.27), so as text it would fail AA.
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Handoff 2d (supersedes 1g rule 五): at >= 1.7x text the items become rows — same
  // component, same selected state — instead of dropping their labels.
  const { stack } = useLayout();
  const labels = state.routes.map((route) => descriptors[route.key].options.title ?? route.name);
  const wide = pillarIsWide(labels);
  return (
    <View
      testID="tab-bar"
      style={[
        stack ? styles.tabsStacked : styles.tabs,
        { backgroundColor: t.s1, borderTopColor: t.hair, paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      {state.routes.map((route, index) => {
        const selected = state.index === index;
        const { tabBarBadge } = descriptors[route.key].options;
        const label = labels[index];
        const color = selected ? t.ink : t.inkSubtle;
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
              pressed && { backgroundColor: t.s2 },
            ]}
          >
            <View
              testID={selected ? "tab-current-rule" : undefined}
              style={[stack ? styles.tabRuleSide : styles.tabRule, { backgroundColor: selected ? t.plaque : "transparent" }]}
            />
            <View style={styles.tabIcon}>
              {tabBarBadge ? <View testID={`tab-${route.name}-badge`} style={[styles.tabBadge, { backgroundColor: t.ink }]} /> : null}
              {selected ? (
                <Emblem civ={t.civ} size={24} stroke={t.plaque} strokeWidth={2.2} />
              ) : (
                <Icon name={TAB_ICONS[route.name] ?? "chevron"} size={18} color={t.inkSubtle} strokeWidth={1.2} />
              )}
            </View>
            <Txt
              testID={`tab-${route.name}-label`}
              variant="label"
              numberOfLines={2}
              style={[styles.tabLabel, wide && styles.tabLabelWide, { color, fontFamily: family.ui[selected ? 600 : 400] }]}
            >
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 4 },
  barCompact: { minHeight: 48, paddingHorizontal: 2 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, paddingHorizontal: 4 },
  /** 补足 A3: 20 / 28 — the simplified plaque's title. */
  barTitle: { fontSize: 20, lineHeight: 28, letterSpacing: 0 },
  /** 16 from the edge, as 1e draws it: the bar's 4 plus this. */
  titleStart: { paddingLeft: 12 },
  tabs: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 4, paddingVertical: 8 },
  tabWide: { justifyContent: "flex-start" },
  tabsStacked: { flexDirection: "column", borderTopWidth: 1 },
  tabRow: { minHeight: 80, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderBottomWidth: 1 },
  tabRuleSide: { position: "absolute", top: 0, bottom: 0, left: 0, width: 2 },
  tabRule: { position: "absolute", top: -1, left: "25%", right: "25%", height: 2 },
  tabIcon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  tabBadge: { position: "absolute", top: -4, right: -4, width: 8, height: 8 },
  /** B11: 12; C14 wide: 11, two lines. */
  tabLabel: { fontSize: 12, lineHeight: 16, letterSpacing: 0, textAlign: "center" },
  tabLabelWide: { fontSize: 11, lineHeight: 16 },
  /** v3 short band at phone width: the meta line, then the seal row. */
  plaque: { paddingTop: 12, paddingBottom: 12, paddingLeft: 16, paddingRight: 4, gap: 12 },
  plaqueRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  plaqueTitle: { flex: 1, minWidth: 0, fontFamily: family.ui[600], fontSize: 20, lineHeight: 28 },
  plaqueMeta: { fontFamily: family.mono[400], fontSize: 11, lineHeight: 16, letterSpacing: 0.6, paddingRight: 12 },
});
