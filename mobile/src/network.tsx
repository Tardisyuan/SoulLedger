/**
 * Offline (用户拍板 2026-09-30; 补足 C15「App 离线是页顶一条常驻提示，不挡内容」).
 *
 * The app keeps no local copy of anything, so the bar says only that the phone is
 * offline and offers a retry — never "showing what was last synced", which the canvas
 * draws for an app that caches. It sits above every screen, pushes them down rather than
 * covering them, and goes by itself when the network is back.
 *
 * Offline = the OS says there is no network (`isConnected === false`). A network the OS
 * cannot yet vouch for (`undefined`) is not offline, and neither is "connected but the
 * server fails": that is each screen's own error, with its own retry.
 *
 * Coming back online — or a tap on the bar's retry that finds the network — bumps `back`;
 * `useReloadOnRefocus` (ui.tsx) reloads on it, so the screens behind the bar refetch
 * without the soul pulling each one.
 */
import * as Network from "expo-network";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { useI18n } from "./i18n";
import { space } from "./theme";
import { GUTTER, SmallButton, Txt, useTheme } from "./ui";

interface Online {
  offline: boolean;
  /** Counts returns to the network; 0 until the first. */
  back: number;
}

const OnlineContext = createContext<Online>({ offline: false, back: 0 });

export function useOnline(): Online {
  return useContext(OnlineContext);
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<Online>({ offline: false, back: 0 });
  const wasOffline = useRef(false);
  const apply = useCallback((state: Network.NetworkState) => {
    const offline = state.isConnected === false;
    const returned = wasOffline.current && !offline;
    wasOffline.current = offline;
    setOnline((prev) => (prev.offline === offline && !returned ? prev : { offline, back: prev.back + (returned ? 1 : 0) }));
  }, []);
  const check = useCallback(() => Network.getNetworkStateAsync().then(apply, () => {}), [apply]);

  useEffect(() => {
    void check();
    const sub = Network.addNetworkStateListener(apply);
    return () => sub.remove();
  }, [apply, check]);

  // The bar takes the status-bar inset, so the screens under it must not take it again: a
  // native SafeAreaView measures itself and sees that alone; the headers read the context.
  const insets = useSafeAreaInsets();
  const below = useMemo(() => (online.offline ? { ...insets, top: 0 } : insets), [insets, online.offline]);
  // One tree shape online and offline: a provider that came and went would remount every
  // screen under it — their state lost, their data fetched again.
  return (
    <OnlineContext.Provider value={online}>
      <View style={styles.fill}>
        {online.offline ? <OfflineBar onRetry={() => void check()} /> : null}
        <View style={styles.fill}>
          <SafeAreaInsetsContext.Provider value={below}>{children}</SafeAreaInsetsContext.Provider>
        </View>
      </View>
    </OnlineContext.Provider>
  );
}

function OfflineBar({ onRetry }: { onRetry: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View testID="offline-inset" style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: t.s0 }}>
      <View
        testID="offline-bar"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        // GUTTER at render, not in StyleSheet.create: ui.tsx imports this module (useOnline).
        style={[styles.bar, { borderColor: t.inkSubtle, marginHorizontal: GUTTER }]}
      >
        <Txt testID="offline-text" variant="body" style={styles.fill}>
          {tr("soul_app.errors.offline")}
        </Txt>
        <SmallButton testID="offline-retry" title={tr("soul_app.common.retry")} onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    marginVertical: space[2],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderWidth: 1,
  },
});
