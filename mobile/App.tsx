import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { FONT_ASSETS } from "./src/fonts";
import { I18nProvider } from "./src/i18n";
import { soulLinks } from "./src/links";
import { RootNavigator } from "./src/navigation";
import { hydratePersistentStore, installMobilePlatform } from "./src/platform";
import { installNotificationHandler } from "./src/push";
import { SessionProvider } from "./src/session";

// Installed at module load, before any core module can read a store.
installMobilePlatform();
installNotificationHandler();
soulLinks.install();
// The native splash (the ground alone) stays until the cold start draws the same ground over it (src/coldStart.tsx).
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  // A font that fails to load falls back to the system face; it must not keep the app blank.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  useEffect(() => {
    hydratePersistentStore().finally(() => setHydrated(true));
    soulLinks.readOpening();
  }, []);
  if (!hydrated || !(fontsLoaded || fontError)) return null;
  // Gesture Handler and @gorhom/bottom-sheet (v2 motion) need this root; on its own it changes nothing.
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <I18nProvider>
          <SessionProvider>
            <StatusBar style="auto" />
            <RootNavigator />
          </SessionProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
