/**
 * 指纹登录, the signed-in half (2026-11-15 便捷度研究 O5; the soul app's `screens/bio.tsx`): the switch on 我的 (with
 * the current password before it turns on), and 「下次用指纹登录？」, asked once per officer after a password sign-in
 * while the typed password is still in memory. The store is `deviceLogin.ts`; the sign-in page's half is in
 * `screens/login.tsx`; the foreground lock is `appLock.tsx`.
 */
import { answered, errorCode, errorStatus } from "@soulledger/core/api/errors";
import { platform } from "@soulledger/core/platform";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { BIO_ASKED_PREFIX, officerDevice } from "./deviceLogin";
import { Row } from "./kit";
import { useSession } from "./session";
import {
  Button,
  GONE_OPACITY,
  CredentialStoreError,
  Input,
  Notice,
  Sheet,
  SwitchMark,
  Txt,
  useBiometry,
  space,
  useI18n,
  useTheme,
  useToast,
  Press,
} from "./shared";

/**
 * What the phone has enrolled and `{{bio}}` (lower-case inside an English sentence). `read`: ask the phone when the
 * screen appears; without it, only what is already known -- this process's last read (a password sign-in reads it,
 * session.tsx) or, while 指纹登录 is on, what the phone said when it was turned on. No late state update then, which
 * is what the sign-in page, the lock and the question want.
 */
export function useBio(read = true): { ready: boolean; enrolled: boolean; word: string } {
  const bio = useBiometry(officerDevice.knownBiometry, read);
  return { ready: bio.ready, enrolled: bio.enrolled, word: bio.inside };
}

/** Why 「开启」 was refused, as a key. */
export function enableFailureKey(error: unknown): string {
  if (!answered(error)) return "officer_app.login.reasons.network";
  if (errorStatus(error) === 429) return "officer_app.login.reasons.locked";
  if (errorCode(error) === "wrong_password") return "officer_app.bio_login.wrong_password";
  return "officer_app.login.reasons.other";
}

/**
 * 我 › 账号安全 › 用指纹登录 (第五十批 C5): a switch for this phone only, two lines under it. On asks for the current
 * password, then the system; off asks nothing. The section's heading is the caller's (me.tsx).
 */
export function BioLoginBlock() {
  const { t } = useI18n();
  const toast = useToast();
  const bio = useBio();
  const [on, setOn] = useState(officerDevice.bioEnabled);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unavailable = !on && bio.ready && !bio.enrolled;

  const close = () => {
    setAsking(false);
    setPassword("");
    setError(null);
  };
  const press = async () => {
    if (busy || unavailable) return;
    if (!on) return asking ? close() : setAsking(true);
    setBusy(true);
    await officerDevice.revokeCredential();
    setOn(false);
    setBusy(false);
  };
  const enable = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await officerDevice.enableWithPassword(password);
      close();
      setOn(true);
    } catch (e) {
      if (e instanceof CredentialStoreError) {
        // Walked away from the system prompt (nothing to say), or the phone refused (say so).
        close();
        if (e.failure !== "cancelled") toast(t("officer_app.bio_login.toggle_failed"), "failure");
      } else {
        setError(t(enableFailureKey(e)));
      }
    } finally {
      setBusy(false);
    }
  };

  const title = t("officer_app.bio_login.row", { bio: bio.word });
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ opacity: unavailable ? GONE_OPACITY : 1 }}>
        <Row
          testID="me-bio-login"
          minHeight={56}
          title={title}
          lines={[unavailable ? t("officer_app.bio_login.row_unavailable") : t("officer_app.bio_login.row_sub", { bio: bio.word })]}
          onPress={unavailable ? undefined : () => void press()}
          right={<SwitchMark on={on} />}
        />
      </View>
      {asking && !on ? (
        <View testID="me-bio-enable" style={{ gap: space[3] }}>
          <Txt variant="body" tone="muted">
            {t("officer_app.bio_login.enable_body", { bio: bio.word })}
          </Txt>
          <Input
            testID="me-bio-password"
            label={t("officer_app.login.password")}
            value={password}
            onChangeText={setPassword}
            editable={!busy}
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
            onSubmitEditing={() => void enable()}
          />
          {error ? (
            <Notice tone="neg" testID="me-bio-error">
              {error}
            </Notice>
          ) : null}
          <Button testID="me-bio-enable-ok" title={t("officer_app.bio_login.enable_ok")} busy={busy} disabled={!password} onPress={() => void enable()} />
        </View>
      ) : null}
    </View>
  );
}

export const wasAsked = (username: string) => platform().persistent.get(BIO_ASKED_PREFIX + username) === "1";

/**
 * 「下次用指纹登录？」, once per officer on this phone: at the first page after a password sign-in, while the session
 * still holds the password just typed -- that is what 「开启」 uses. Either answer drops the password.
 */
export function BioAsk({ username }: { username: string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { heldPassword, dropPassword } = useSession();
  // The password sign-in read the phone before landing (session.tsx), so this is known on the first frame.
  const bio = useBio(false);
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  const due = !answered && heldPassword() !== null && bio.enrolled && !officerDevice.bioEnabled() && !wasAsked(username);
  // A password that is not going to be used is dropped at once.
  useEffect(() => {
    if (!due) dropPassword();
  }, [due, dropPassword]);

  const finish = () => {
    platform().persistent.set(BIO_ASKED_PREFIX + username, "1");
    dropPassword();
    setAnswered(true);
  };
  const turnOn = async () => {
    const password = heldPassword();
    if (busy) return;
    if (!password) return finish();
    setBusy(true);
    try {
      await officerDevice.enableWithPassword(password);
    } catch (e) {
      if (!(e instanceof CredentialStoreError)) toast(t(enableFailureKey(e)), "failure");
      else if (e.failure !== "cancelled") toast(t("officer_app.bio_login.toggle_failed"), "failure");
    }
    setBusy(false);
    finish();
  };
  return (
    <Sheet open={due} onClose={finish} edge={theme.hair} closeLabel={t("officer_app.bio_login.ask_later")}>
      <View testID="bio-ask" style={{ gap: space[4], padding: space[5] }}>
        <Txt variant="title" accessibilityRole="header">
          {t("officer_app.bio_login.ask_title", { bio: bio.word })}
        </Txt>
        <Txt variant="bodyLg">{t("officer_app.bio_login.ask_body", { bio: bio.word })}</Txt>
        <Txt variant="body" tone="muted">
          {t("officer_app.bio_login.ask_note")}
        </Txt>
        {/* 第五十批 C5: 「开启」 in ink, 「以后再说」 a ghost button under it. */}
        <Button testID="bio-ask-ok" title={t("officer_app.bio_login.enable_ok")} onPress={() => void turnOn()} busy={busy} />
        <Press testID="bio-ask-later" accessibilityRole="button" disabled={busy} onPress={finish} style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}>
          <Txt variant="bodyLg" tone="muted">
            {t("officer_app.bio_login.ask_later")}
          </Txt>
        </Press>
      </View>
    </Sheet>
  );
}
