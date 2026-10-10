import Constants from "expo-constants";
import { useEffect, useState, type ReactNode } from "react";
import { AppState, Linking, Platform, StyleSheet, View, useColorScheme } from "react-native";

import { fetchVersionPolicy, isBelowMinimum, type VersionApp, type VersionPolicy } from "./appVersion";
import { BrandMark } from "./brandMarkView";
import { useI18n } from "./i18n";
import { space, themeFor } from "./theme";
import { Button, Screen, ThemeContext, Txt, useTheme } from "./ui";

/**
 * Checks at start and every return to the foreground. A failed check leaves the last answer in place
 * (see appVersion.ts: failure never blocks), so a user who was let in is not locked out by a flaky link.
 */
export function useVersionPolicy(app: VersionApp): VersionPolicy | null {
  const [policy, setPolicy] = useState<VersionPolicy | null>(null);
  useEffect(() => {
    const platform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;
    if (!platform) return;
    let alive = true;
    const check = () => {
      void fetchVersionPolicy(app, platform).then((next) => {
        if (alive && next) setPolicy(next);
      });
    };
    check();
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => {
      alive = false;
      sub.remove();
    };
  }, [app]);
  return policy;
}

/** Sits above the session and the login gate: a signed-out user is held back too. */
export function VersionGate({ app, children }: { app: VersionApp; children: ReactNode }) {
  const policy = useVersionPolicy(app);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  if (policy && isBelowMinimum(Constants.expoConfig?.version, policy.minSupported)) {
    return (
      <ThemeContext.Provider value={themeFor(null, scheme)}>
        <UpdateRequired app={app} storeUrl={policy.storeUrl} min={policy.minSupported} />
      </ThemeContext.Provider>
    );
  }
  return <>{children}</>;
}

/**
 * The whole screen, no way out: mark, title, body, one button (only when the backend named a store
 * link), the running version in small type at the foot. The officer app's body names both versions.
 */
export function UpdateRequired({ app, storeUrl, min }: { app: VersionApp; storeUrl: string; min: string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const version = Constants.expoConfig?.version ?? "";
  return (
    <Screen testID="update-required" scroll={false} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.body}>
        <BrandMark testID="update-mark" size={96} color={theme.ink} />
        <Txt variant="title" style={styles.center}>
          {t("soul_app.update_required.title")}
        </Txt>
        <Txt variant="body" tone="muted" style={styles.center}>
          {app === "officer" ? t("officer_app.update_required.body", { version, min }) : t("soul_app.update_required.body")}
        </Txt>
        {storeUrl ? (
          <Button
            testID="update-open-store"
            title={t("soul_app.update_required.button")}
            onPress={() => void Linking.openURL(storeUrl).catch(() => {})}
            style={styles.button}
          />
        ) : null}
      </View>
      <Txt testID="update-version" variant="caption" tone="subtle" style={styles.center}>
        {t("soul_app.update_required.version", { version })}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], paddingHorizontal: space[6] },
  center: { textAlign: "center" },
  button: { alignSelf: "stretch", marginTop: space[2] },
});
