import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { FONT_ASSETS } from "./src/fonts";
import { I18nProvider } from "./src/i18n";
import { RootNavigator } from "./src/navigation";
import { hydratePersistentStore, installMobilePlatform } from "./src/platform";
import { installNotificationHandler } from "./src/push";
import { SessionProvider } from "./src/session";

// Installed at module load, before any core module can read a store.
installMobilePlatform();
installNotificationHandler();

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  // A font that fails to load falls back to the system face; it must not keep the app blank.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  useEffect(() => {
    hydratePersistentStore().finally(() => setHydrated(true));
  }, []);
  if (!hydrated || !(fontsLoaded || fontError)) return null;
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <StatusBar style="auto" />
          <RootNavigator />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
