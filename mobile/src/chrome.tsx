/**
 * The navigator's chrome, drawn by the app instead of the platform: a 52pt
 * title bar with a hairline under it, and a three-item tab bar whose selected
 * item is the civilization's emblem in its mark colour with a 2px rule on top.
 */
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Emblem, Icon, type IconName } from "./emblems";
import { useI18n } from "./i18n";
import { Txt, useLayout, useTheme } from "./ui";

export function AppHeader({
  title,
  onBack,
  onAccount,
}: {
  title: string;
  onBack?: () => void;
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
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: t.s0, borderBottomWidth: 1, borderBottomColor: t.hair }}>
      <View style={[styles.bar, compact && styles.barCompact]}>
        {onBack ? (
          <Pressable testID="header-back" accessibilityRole="button" accessibilityLabel={tr("common.back")} onPress={onBack} hitSlop={6} style={styles.icon}>
            <Icon name="back" size={17} color={t.inkMuted} strokeWidth={1.4} />
          </Pressable>
        ) : (
          <View style={styles.icon} />
        )}
        <Txt
          accessibilityRole="header"
          variant="nav"
          numberOfLines={2}
          style={[styles.title, { textAlign: onBack ? "left" : "center" }]}
        >
          {title}
        </Txt>
        {onAccount ? (
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

const TAB_ICONS: Record<string, IconName> = { Life: "ledger", PastLives: "lock", Applications: "cycle" };

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
        const label = descriptors[route.key].options.title ?? route.name;
        const color = selected ? t.mark : t.inkSubtle;
        return (
          <Pressable
            key={route.key}
            testID={`tab-${route.name}`}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
            style={stack ? [styles.tabRow, { borderBottomColor: t.hair }] : styles.tab}
          >
            <View style={[stack ? styles.tabRuleSide : styles.tabRule, { backgroundColor: selected ? t.mark : "transparent" }]} />
            <View style={styles.tabIcon}>
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
  tabs: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 5, paddingVertical: 6 },
  tabsStacked: { flexDirection: "column", borderTopWidth: 1 },
  tabRow: { minHeight: 80, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderBottomWidth: 1 },
  tabRuleSide: { position: "absolute", top: 0, bottom: 0, left: 0, width: 2 },
  tabRule: { position: "absolute", top: -1, left: 0, right: 0, height: 2 },
  tabIcon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  tabLabel: { fontSize: 11, letterSpacing: 0.6, textAlign: "center" },
});
