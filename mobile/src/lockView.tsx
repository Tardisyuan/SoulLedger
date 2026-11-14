/**
 * The foreground lock's page, one for both apps (Design 第五十批 C5): a mark in the middle (the soul app's brand mark;
 * the officer app's hall seal at 64, which counts as a seal), the title, an optional line under it (the officer's
 * 「{name} · {hall}」), the main button and the text link 「用密码登录」. The apps pass their own words; when to lock
 * and what unlocking does stay in each app's `appLock.tsx`. A leaf: ui only, so the officer app can import it.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button, Txt, useTheme } from "./ui";

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
          <Pressable testID="app-lock-use-password" accessibilityRole="link" disabled={busy} onPress={onPassword} style={styles.link}>
            <Txt variant="bodyLg" style={styles.underline}>
              {passwordLabel}
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
  words: { gap: 8 },
  center: { textAlign: "center" },
  button: { alignSelf: "stretch" },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  underline: { textDecorationLine: "underline" },
});
