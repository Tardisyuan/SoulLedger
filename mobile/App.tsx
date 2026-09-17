import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "./src/i18n";
import { RootNavigator } from "./src/navigation";
import { hydratePersistentStore, installMobilePlatform } from "./src/platform";
import { SessionProvider } from "./src/session";

// Installed at module load, before any core module can read a store.
installMobilePlatform();

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    hydratePersistentStore().finally(() => setReady(true));
  }, []);
  if (!ready) return null;
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
