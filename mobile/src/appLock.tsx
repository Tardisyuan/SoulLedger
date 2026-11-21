/**
 * 切回 App 时也要验证 (Design 第二十八批 S2). When the switch is on (`appLockOn`: under 设置 › 账号安全 › 面容登录, only
 * while that is on; on by default since 2026-11-15, off only when the soul turned it off) and the app comes back after at least five minutes in the background, a screen written like the
 * 面容 sign-in page -- title 「已锁定」 -- covers everything until the system recognises the face / finger. If it does
 * not, the way out is the sign-in page's own: 「输入密码」 signs out, and the sign-in page asks for the password.
 *
 * No flash of the screen underneath: the cover goes up when the app LEAVES the foreground (the OS snapshots the app
 * switcher then too), and comes down on return if the time away was short. The time is fixed at five minutes; there
 * is no option. A cold start that restores the stored session is locked too (F-ACCT-05, flow walk 2026-11-12): it
 * never passes the sign-in page -- `boot()` trades the stored refresh token straight for the home page -- so swiping
 * the app away and reopening it used to walk past the lock. A session the soul has just signed into is not locked.
 */
import { onSessionResume, onSessionSuspend } from "@soulledger/core/platform";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";

import { BrandMark } from "./brandMarkView";
import { appLockOn } from "./deviceLogin";
import { useI18n } from "./i18n";
import { LockView } from "./lockView";
import { takeRestoredSession, useSession } from "./session";
import { useTheme } from "./ui";
import { useBiometry } from "./useBiometry";

export const LOCK_AFTER_MS = 5 * 60 * 1000;

type Phase = "off" | "cover" | "locked";

/**
 * `coldStart`: the caller may decide it (the welcome waits on the same answer, so both read it at once); left out,
 * the lock reads it here. `onLocked` hears each change of 「已锁定」 up or down.
 */
export function AppLock({ coldStart: given, onLocked }: { coldStart?: boolean; onLocked?: (locked: boolean) => void } = {}) {
  const theme = useTheme();
  const { t } = useI18n();
  const { signOut } = useSession();
  const bio = useBiometry();
  const [coldStart] = useState(() => given ?? (takeRestoredSession() && appLockOn()));
  const [phase, setPhase] = useState<Phase>(coldStart ? "locked" : "off");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const leftAt = useRef<number | null>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
    onLocked?.(phase === "locked");
  }, [phase, onLocked]);

  const unlock = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    let ok = false;
    try {
      // The reason the system shows with its check, in the app's language (review 2026-11-01).
      ok = (await LocalAuthentication.authenticateAsync({ promptMessage: t("soul_app.biometric.prompt_unlock"), disableDeviceFallback: true })).success;
    } catch {
      ok = false;
    }
    setBusy(false);
    if (ok) setPhase("off");
    else setFailed(true);
  }, [t]);

  useEffect(() => {
    // Asks once, as on a return. From a timer callback, not the effect body: `unlock` sets state before its
    // first await, and react-hooks/set-state-in-effect refuses that synchronously in an effect.
    if (!coldStart) return;
    const id = setTimeout(() => void unlock(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cold start is asked about once, on mount
  }, []);

  useEffect(() => {
    const offSuspend = onSessionSuspend(() => {
      if (!appLockOn()) return;
      // A lock that is up stays up: leaving while LOCKED must not become the brief-switch cover, which a return
      // within five minutes takes down unasked (state-machine audit 2026-11-20).
      if (phaseRef.current === "locked") return;
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
  // 第五十批 C5: the page is the officer app's too (lockView.tsx); the words and the mark are this app's.
  return (
    <LockView
      locked={phase === "locked"}
      mark={<BrandMark size={66} color={theme.ink} />}
      title={t("soul_app.lock.title")}
      failed={failed ? t("soul_app.bio.failed", { bio: bio.word }) : null}
      unlockLabel={t(failed ? "soul_app.bio.retry" : "soul_app.bio.button", { bio: bio.word })}
      onUnlock={() => void unlock()}
      passwordLabel={t("soul_app.login.use_password")}
      onPassword={signOut}
      busy={busy}
    />
  );
}
