/**
 * 切回 App 时也要验证 (Design 第二十八批 S2). When the switch is on (`appLockOn`: set under 设置 › 账号安全 › 面容登录, only
 * while that is on) and the app comes back after at least five minutes in the background, a screen written like the
 * 面容 sign-in page -- title 「已锁定」 -- covers everything until the system recognises the face / finger. If it does
 * not, the way out is the sign-in page's own: 「输入密码」 signs out, and the sign-in page asks for the password.
 *
 * No flash of the screen underneath: the cover goes up when the app LEAVES the foreground (the OS snapshots the app
 * switcher then too), and comes down on return if the time away was short. A cold start is never locked -- the
 * sign-in page already asks for the face. The time is fixed at five minutes; there is no option.
 */
import { onSessionResume, onSessionSuspend } from "@soulledger/core/platform";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";

import { BrandMark } from "./brandMarkView";
import { appLockOn } from "./deviceLogin";
import { useI18n } from "./i18n";
import { useSession } from "./session";
import { Button, Txt, useTheme } from "./ui";
import { useBiometry } from "./useBiometry";

export const LOCK_AFTER_MS = 5 * 60 * 1000;

/** The reason the system shows with its check. A system string, like the sign-in one (Design 第二十批 §四.4). */
const PROMPT = "用来解锁灵魂簿。";

type Phase = "off" | "cover" | "locked";

export function AppLock() {
  const theme = useTheme();
  const { t } = useI18n();
  const { signOut } = useSession();
  const bio = useBiometry();
  const [phase, setPhase] = useState<Phase>("off");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const leftAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    let ok = false;
    try {
      ok = (await LocalAuthentication.authenticateAsync({ promptMessage: PROMPT, disableDeviceFallback: true })).success;
    } catch {
      ok = false;
    }
    setBusy(false);
    if (ok) setPhase("off");
    else setFailed(true);
  }, []);

  useEffect(() => {
    const offSuspend = onSessionSuspend(() => {
      if (!appLockOn()) return;
      leftAt.current = Date.now();
      setPhase("cover");
    });
    const offResume = onSessionResume(() => {
      const at = leftAt.current;
      leftAt.current = null;
      if (at === null) return;
      if (Date.now() - at < LOCK_AFTER_MS) return setPhase("off");
      setPhase("locked");
      void unlock(); // asks once as the lock comes up
    });
    return () => {
      offSuspend();
      offResume();
    };
  }, [unlock]);

  // Android's back key must not reach the screens under the lock (it would pop or close them unseen).
  useEffect(() => {
    if (phase !== "locked") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [phase]);

  if (phase === "off") return null;
  return (
    <View testID={phase === "locked" ? "app-lock" : "app-lock-cover"} accessibilityViewIsModal style={[styles.cover, { backgroundColor: theme.s0 }]}>
      <BrandMark size={66} color={theme.ink} />
      {phase === "locked" ? (
        <View style={styles.body}>
          <Txt variant="title" accessibilityRole="header" style={styles.center}>
            {t("soul_app.lock.title")}
          </Txt>
          {failed ? (
            <Txt testID="app-lock-failed" accessibilityRole="alert" style={styles.failed}>
              {t("soul_app.bio.failed", { bio: bio.word })}
            </Txt>
          ) : null}
          <Button
            testID="app-lock-bio"
            title={t(failed ? "soul_app.bio.retry" : "soul_app.bio.button", { bio: bio.word })}
            onPress={() => void unlock()}
            busy={busy}
            style={styles.button}
          />
          <Pressable testID="app-lock-use-password" accessibilityRole="link" disabled={busy} onPress={signOut} style={styles.link}>
            <Txt variant="bodyLg" style={styles.underline}>
              {t("soul_app.login.use_password")}
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
  failed: { textAlign: "center" },
  button: { alignSelf: "stretch" },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  underline: { textDecorationLine: "underline" },
});
