/**
 * The navigator's chrome, drawn by the app instead of the platform: a 52pt
 * title bar with a hairline under it, and a three-item tab bar whose selected
 * item is the civilization's emblem in its mark colour with a 2px rule on top.
 */
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Emblem, Icon, type IconName } from "./emblems";
import { quoteFamily } from "./fonts";
import { useI18n } from "./i18n";
import { Txt, useLayout, useTheme } from "./ui";

/** A title-bar action in the account icon's place (the 书信 tab's "new" / search, handoff chat 1b / 1e). */
export interface HeaderAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID: string;
  /** iOS "new": a 44pt square framed in the accent. */
  framed?: boolean;
}

export function AppHeader({
  title,
  onBack,
  onAccount,
  action,
  serif,
}: {
  title: string;
  /** The app name on the pre-login bar, set in the serif (product decision 2026-09-26). */
  serif?: boolean;
  onBack?: () => void;
  /** One, or several side by side (朋友圈 1a: find people, my page). */
  action?: HeaderAction | HeaderAction[];
  /**
   * The person icon, top right, on all three tabs. Round 1 had it open the
   * sign-out sheet; since round 4 it opens the settings page (language,
   * notifications, sign out) — same place, a destination instead of an action.
   */
  onAccount?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  const { compact } = useLayout();
  // Chat handoff 1e (Material): on Android the title sits at the left, with nothing held
  // open for a back key it does not have, and back is an arrow. iOS: centred, chevron.
  const android = Platform.OS === "android";
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: t.s0, borderBottomWidth: 1, borderBottomColor: t.hair }}>
      <View testID="header-bar" style={[styles.bar, compact && styles.barCompact]}>
        {onBack ? (
          <Pressable testID="header-back" accessibilityRole="button" accessibilityLabel={tr("common.back")} onPress={onBack} hitSlop={6} style={styles.icon}>
            <Icon name={android ? "arrow" : "back"} size={android ? 20 : 17} color={t.inkMuted} strokeWidth={1.4} />
          </Pressable>
        ) : android ? null : (
          // iOS centres the title: as wide on the left as the actions are on the right.
          <View style={[styles.icon, { width: 44 * (Array.isArray(action) ? action.length : 1) }]} />
        )}
        <Txt
          accessibilityRole="header"
          variant="nav"
          numberOfLines={2}
          style={[
            styles.title,
            android && !onBack && styles.titleStart,
            { textAlign: onBack || android ? "left" : "center" },
            serif && { fontFamily: quoteFamily(title) },
          ]}
        >
          {title}
        </Txt>
        {action ? (
          (Array.isArray(action) ? action : [action]).map((a) => (
            <Pressable
              key={a.testID}
              testID={a.testID}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              onPress={a.onPress}
              style={({ pressed }) => [styles.icon, a.framed && { borderWidth: 1, borderColor: t.accent }, pressed && { backgroundColor: t.s1 }]}
            >
              <Icon name={a.icon} size={18} color={a.framed ? t.accent : t.inkMuted} strokeWidth={1.4} />
            </Pressable>
          ))
        ) : onAccount ? (
          <Pressable testID="header-account" accessibilityRole="button" accessibilityLabel={tr("soul_app.settings.title")} onPress={onAccount} style={styles.icon}>
            <Icon name="person" size={18} color={t.inkSubtle} strokeWidth={1.2} />
          </Pressable>
        ) : (
          <View style={styles.icon} />
        )}
      </View>
    </View>
  );
}

const TAB_ICONS: Record<string, IconName> = { Life: "ledger", Applications: "cycle", Letters: "letter", Circle: "circle" };

/**
 * Chat handoff 1e: the selected tab is a 2px mark rule on top on iOS, and the
 * whole cell tinted with the accent on Android — no pill, no corner either way.
 */
const ANDROID_TABS = Platform.OS === "android";

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Handoff 2d (supersedes 1g rule 五): at ≥ 1.7× text the three items become three
  // rows — same component, same selected state — instead of dropping their labels.
  const { stack } = useLayout();
  return (
    <View
      style={[
        stack ? styles.tabsStacked : styles.tabs,
        { backgroundColor: t.s1, borderTopColor: t.hair, paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      {state.routes.map((route, index) => {
        const selected = state.index === index;
        const { title, tabBarBadge } = descriptors[route.key].options;
        const label = title ?? route.name;
        const color = selected ? t.mark : t.inkSubtle;
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
            style={[
              stack ? [styles.tabRow, { borderBottomColor: t.hair }] : styles.tab,
              ANDROID_TABS && selected && { backgroundColor: `${t.accent}1F` },
            ]}
          >
            <View
              style={[
                stack ? styles.tabRuleSide : styles.tabRule,
                { backgroundColor: selected && !ANDROID_TABS ? t.mark : "transparent" },
              ]}
            />
            <View style={styles.tabIcon}>
              {tabBarBadge ? <View testID={`tab-${route.name}-badge`} style={[styles.tabBadge, { backgroundColor: t.mark }]} /> : null}
              {selected ? (
                <Emblem civ={t.civ} size={24} stroke={t.mark} strokeWidth={2.2} />
              ) : (
                <Icon name={TAB_ICONS[route.name] ?? "chevron"} size={18} color={t.inkSubtle} strokeWidth={1.2} />
              )}
            </View>
            <Txt variant="label" numberOfLines={2} style={[styles.tabLabel, { color }]}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 6 },
  barCompact: { minHeight: 46, paddingHorizontal: 2 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, paddingHorizontal: 4 },
  /** 16 from the edge, as 1e draws it: the bar's 6 plus this. */
  titleStart: { paddingLeft: 10 },
  tabs: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 5, paddingVertical: 6 },
  tabsStacked: { flexDirection: "column", borderTopWidth: 1 },
  tabRow: { minHeight: 80, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderBottomWidth: 1 },
  tabRuleSide: { position: "absolute", top: 0, bottom: 0, left: 0, width: 2 },
  tabRule: { position: "absolute", top: -1, left: 0, right: 0, height: 2 },
  tabIcon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  tabBadge: { position: "absolute", top: -4, right: -5, width: 7, height: 7 },
  tabLabel: { fontSize: 11, letterSpacing: 0.6, textAlign: "center" },
});
