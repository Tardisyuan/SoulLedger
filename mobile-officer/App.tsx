import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ColdStart } from "./src/coldStart";
import { officerLinks } from "./src/links";
import { PrefsProvider, usePrefs } from "./src/prefs";
import { installNotificationHandler } from "./src/push";
import { LoginScreen } from "./src/screens/login";
import { SessionProvider, useSession } from "./src/session";
import {
  FONT_ASSETS,
  I18nProvider,
  NetworkProvider,
  ThemeContext,
  ToastProvider,
  hydratePersistentStore,
  installMobilePlatform,
  themeFor,
  type ColorScheme,
} from "./src/shared";
import { Shell } from "./src/shell";

// Installed at module load, before any core module can read a store.
installMobilePlatform();
installNotificationHandler();
officerLinks.install();
// The native splash (the paper ground alone) stays until the cold start draws the same ground over it.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  useEffect(() => {
    hydratePersistentStore().finally(() => setHydrated(true));
    officerLinks.readOpening();
  }, []);
  if (!hydrated || !(fontsLoaded || fontError)) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <I18nProvider>
          <PrefsProvider>
            <SessionProvider>
              <Themed />
            </SessionProvider>
          </PrefsProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The hall's theme once signed in -- its civilization colour on the band, the primary button and the
 * current tab, the shared neutrals everywhere else -- and the neutral skin before. Paper (light) is
 * the default; the system's dark, or the choice made in 我的, switches it.
 */
function Themed() {
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const { themeChoice } = usePrefs();
  const { state } = useSession();
  const scheme: ColorScheme = themeChoice === "system" ? system : themeChoice;
  const theme = themeFor(state.status === "signedIn" ? state.user.tenant?.civilization : null, scheme);
  return (
    <ThemeContext.Provider value={theme}>
      <BottomSheetModalProvider>
        <ToastProvider>
          <NetworkProvider>
            <StatusBar style={scheme === "dark" ? "light" : "dark"} />
            {state.status === "signedIn" ? <Shell /> : <LoginScreen />}
            <ColdStart booting={state.status === "booting"} />
          </NetworkProvider>
        </ToastProvider>
      </BottomSheetModalProvider>
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
