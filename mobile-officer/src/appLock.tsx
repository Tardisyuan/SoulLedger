/**
 * 切回 App 时要验证 (2026-11-15 便捷度研究 O7; the soul app's `mobile/src/appLock.tsx`, ported). On exactly while
 * 指纹登录 is on (`officerDevice.appLockOn`): fingerprint sign-in lifts the "idle 24 h → password" rule, so whoever
 * picks up an unlocked officer phone must not walk past the officer either. After five minutes in the background, and
 * on a cold start that resumed the stored session, a cover asks for the fingerprint before anything shows. If it does
 * not pass, 「输入密码」 signs out the way the server would (unsent replies and drafts stay for the same officer).
 *
 * The cover goes up when the app LEAVES the foreground (the OS snapshots the app switcher then), so nothing flashes.
 * Decisions still ask `deviceCheck` on their own; this lock is in addition.
 */
import { onSessionResume, onSessionSuspend } from "@soulledger/core/platform";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";

import { OFFICER_BRAND } from "./brand";
import { useBio } from "./bioLogin";
import { officerDevice } from "./deviceLogin";
import { takeRestoredSession, useSession } from "./session";
import { BrandMark, Button, Txt, useI18n, useTheme } from "./shared";

export const LOCK_AFTER_MS = 5 * 60 * 1000;

type Phase = "off" | "cover" | "locked";

export function AppLock() {
  const theme = useTheme();
  const { t } = useI18n();
  const { signOut } = useSession();
  const bio = useBio(false);
  const [coldStart] = useState(() => takeRestoredSession() && officerDevice.appLockOn());
  const [phase, setPhase] = useState<Phase>(coldStart ? "locked" : "off");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const leftAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    let ok = false;
    try {
      ok = (await LocalAuthentication.authenticateAsync({ promptMessage: t("officer_app.bio_login.prompt_unlock"), disableDeviceFallback: true })).success;
    } catch {
      ok = false;
    }
    setBusy(false);
    if (ok) setPhase("off");
    else setFailed(true);
  }, [t]);

  useEffect(() => {
    // Asked once, from a timer: `unlock` sets state before its first await.
    if (!coldStart) return;
    const id = setTimeout(() => void unlock(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cold start is asked about once, on mount
  }, []);

  useEffect(() => {
    const offSuspend = onSessionSuspend(() => {
      if (!officerDevice.appLockOn()) return;
      leftAt.current = Date.now();
      setPhase("cover");
    });
    const offResume = onSessionResume(() => {
      const at = leftAt.current;
      leftAt.current = null;
      if (at === null) return;
      if (Date.now() - at < LOCK_AFTER_MS) return setPhase("off");
      setPhase("locked");
      void unlock();
    });
    return () => {
      offSuspend();
      offResume();
    };
  }, [unlock]);

  // Android's back key must not reach the screens under the lock.
  useEffect(() => {
    if (phase !== "locked") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [phase]);

  if (phase === "off") return null;
  return (
    <View testID={phase === "locked" ? "app-lock" : "app-lock-cover"} accessibilityViewIsModal style={[styles.cover, { backgroundColor: theme.s0 }]}>
      <BrandMark size={66} color={OFFICER_BRAND.mark} />
      {phase === "locked" ? (
        <View style={styles.body}>
          <Txt variant="title" accessibilityRole="header" style={styles.center}>
            {t("officer_app.bio_login.lock_title")}
          </Txt>
          {failed ? (
            <Txt testID="app-lock-failed" accessibilityRole="alert" style={styles.center}>
              {t("officer_app.bio_login.failed", { bio: bio.word })}
            </Txt>
          ) : null}
          <Button testID="app-lock-bio" title={t("officer_app.bio_login.button", { bio: bio.word })} onPress={() => void unlock()} busy={busy} />
          <Pressable testID="app-lock-use-password" accessibilityRole="link" disabled={busy} onPress={() => signOut({ keepUnsent: true })} style={styles.link}>
            <Txt variant="bodyLg" style={styles.underline}>
              {t("officer_app.bio_login.use_password")}
            </Txt>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 24 },
  body: { alignSelf: "stretch", alignItems: "stretch", gap: 16 },
  center: { textAlign: "center" },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  underline: { textDecorationLine: "underline" },
});
