import Constants from "expo-constants";
import { useEffect, useState, type ReactNode } from "react";
import { AppState, Linking, Platform, useColorScheme } from "react-native";

import { fetchVersionPolicy, isBelowMinimum, type VersionApp, type VersionPolicy } from "./appVersion";
import { useI18n } from "./i18n";
import { themeFor } from "./theme";
import { Block, Button, Screen, ThemeContext, Txt } from "./ui";

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
        <UpdateRequired storeUrl={policy.storeUrl} />
      </ThemeContext.Provider>
    );
  }
  return <>{children}</>;
}

export function UpdateRequired({ storeUrl }: { storeUrl: string }) {
  const { t } = useI18n();
  return (
    <Screen testID="update-required" scroll={false} edges={["top", "left", "right", "bottom"]}>
      <Block last>
        <Txt variant="title">{t("soul_app.update_required.title")}</Txt>
        <Txt variant="body" tone="muted">
          {t("soul_app.update_required.body")}
        </Txt>
        {storeUrl ? (
          <Button testID="update-open-store" title={t("soul_app.update_required.button")} onPress={() => void Linking.openURL(storeUrl).catch(() => {})} />
        ) : null}
      </Block>
    </Screen>
  );
}
