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
import { BackHandler } from "react-native";

import { OFFICER_BRAND } from "./brand";
import { useBio } from "./bioLogin";
import { DossierSeal, civOf } from "./dossierSeal";
import { officerDevice } from "./deviceLogin";
import { hallLabel } from "./rules";
import { takeRestoredSession, useSession } from "./session";
import { BrandMark, LockView, useI18n } from "./shared";

export const LOCK_AFTER_MS = 5 * 60 * 1000;

type Phase = "off" | "cover" | "locked";

export function AppLock() {
  const { t } = useI18n();
  const { state, signOut } = useSession();
  const bio = useBio(false);
  const [coldStart] = useState(() => takeRestoredSession() && officerDevice.appLockOn());
  const [phase, setPhase] = useState<Phase>(coldStart ? "locked" : "off");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const leftAt = useRef<number | null>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

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
  const user = state.status === "signedIn" ? state.user : null;
  // 第五十批 C5: the soul app's lock page (lockView.tsx) with a seal at 64 -- one of the four places a civilization's
  // colour goes. 第五十二批 E2: the civilization's seal, not a hall's (地府's reads 「地府之印」): drawing 「第一殿」 for a
  // hall the page does not know would name the wrong hall. A civilization that is not known: the brand mark.
  const seal = <DossierSeal testID="app-lock-seal" civilization={user?.tenant?.civilization} civLevel size={64} label={t("officer_app.seal.a11y")} />;
  const name = user ? user.display_name || user.username : "";
  const hall = user ? hallLabel(t, user.tenant) : undefined;
  return (
    <LockView
      locked={phase === "locked"}
      mark={civOf(user?.tenant?.civilization) ? seal : <BrandMark size={66} color={OFFICER_BRAND.mark} />}
      title={t("officer_app.bio_login.lock_title")}
      // The name alone when the hall is not known: no dangling 「 · 」.
      who={!user ? undefined : hall ? t("officer_app.bio_login.lock_who", { name, hall }) : name}
      failed={failed ? t("officer_app.bio_login.failed", { bio: bio.word }) : null}
      unlockLabel={t("officer_app.bio_login.unlock", { bio: bio.word })}
      onUnlock={() => void unlock()}
      passwordLabel={t("officer_app.bio_login.use_password")}
      onPassword={() => signOut({ keepUnsent: true })}
      busy={busy}
    />
  );
}
