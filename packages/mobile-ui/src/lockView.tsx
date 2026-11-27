/**
 * The foreground lock's page, one for both apps (Design 第五十批 C5): a mark in the middle (the soul app's brand mark;
 * the officer app's civilization seal at 64, 第五十二批 E2), the title, an optional line under it (the officer's
 * 「{name} · {hall}」, or the name alone when the hall is not known), the main button and the text link 「用密码登录」. The apps pass their own words; whether
 * the lock is on, what a cold start is and what 「输入密码」 does stay in each app's `appLock.tsx`. When the lock is up
 * is `useAppLock` below, one state machine for both: it was two copies, and the same defect was fixed in both
 * (d6f1e348f). A leaf: ui, the cold start and core only, so the officer app can import it.
 */
import { onSessionResume, onSessionSuspend } from "@soulledger/core/platform";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BackHandler, StyleSheet, View } from "react-native";

import { afterColdStart } from "./coldStartView";
import { Button, Txt, useTheme, Press } from "./ui";

export const LOCK_AFTER_MS = 5 * 60 * 1000;

type Phase = "off" | "cover" | "locked";

/**
 * When the lock is up. The cover goes up when the app LEAVES the foreground (the OS snapshots the app switcher then,
 * so nothing flashes) and comes down on return if the time away was under five minutes; longer, and the lock asks for
 * the face / finger. `enabled` is asked at each leaving; `coldStart` (decided once, by the caller) starts locked and
 * asks once; `prompt` is the reason the system shows with its check; `onLocked` hears each change of 「已锁定」.
 */
export function useAppLock({
  enabled,
  coldStart,
  prompt,
  onLocked,
}: {
  enabled: () => boolean;
  coldStart: boolean;
  prompt: string;
  onLocked?: (locked: boolean) => void;
}) {
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
      ok = (await LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: true })).success;
    } catch {
      ok = false;
    }
    setBusy(false);
    if (ok) setPhase("off");
    else setFailed(true);
  }, [prompt]);

  useEffect(() => {
    // Asks once, as on a return -- but only once the cold start is off the screen, so the system sheet opens over
    // 「已锁定」, not over the blank native splash (afterColdStart says why). Never synchronously in the effect body:
    // `unlock` sets state before its first await, and react-hooks/set-state-in-effect refuses that.
    if (!coldStart) return;
    return afterColdStart(() => void unlock());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cold start is asked about once, on mount
  }, []);

  useEffect(() => {
    const offSuspend = onSessionSuspend(() => {
      if (!enabled()) return;
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
  }, [unlock, enabled]);

  // Android's back key must not reach the screens under the lock (it would pop or close them unseen).
  useEffect(() => {
    if (phase !== "locked") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [phase]);

  return { phase, failed, busy, unlock };
}

export function LockView({
  locked,
  mark,
  title,
  who,
  failed,
  unlockLabel,
  onUnlock,
  passwordLabel,
  onPassword,
  busy,
}: {
  /** false: only the cover (the app is going to the background), no words or buttons. */
  locked: boolean;
  mark: ReactNode;
  title: string;
  who?: string;
  /** Said when the check did not pass. */
  failed?: string | null;
  unlockLabel: string;
  onUnlock: () => void;
  passwordLabel: string;
  onPassword: () => void;
  busy?: boolean;
}) {
  const theme = useTheme();
  return (
    <View testID={locked ? "app-lock" : "app-lock-cover"} accessibilityViewIsModal style={[styles.cover, { backgroundColor: theme.s0 }]}>
      {mark}
      {locked ? (
        <View style={styles.body}>
          <View style={styles.words}>
            <Txt variant="title" accessibilityRole="header" style={styles.center}>
              {title}
            </Txt>
            {who ? (
              <Txt testID="app-lock-who" tone="muted" style={styles.center}>
                {who}
              </Txt>
            ) : null}
          </View>
          {failed ? (
            <Txt testID="app-lock-failed" accessibilityRole="alert" style={styles.center}>
              {failed}
            </Txt>
          ) : null}
          <Button testID="app-lock-bio" title={unlockLabel} onPress={onUnlock} busy={busy} style={styles.button} />
          <Press testID="app-lock-use-password" accessibilityRole="link" disabled={busy} onPress={onPassword} style={styles.link}>
            <Txt variant="bodyLg" style={styles.underline}>
              {passwordLabel}
            </Txt>
          </Press>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 24 },
  body: { alignSelf: "stretch", alignItems: "stretch", gap: 16 },
  words: { gap: 8 },
  center: { textAlign: "center" },
  button: { alignSelf: "stretch" },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  underline: { textDecorationLine: "underline" },
});
