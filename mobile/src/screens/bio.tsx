/**
 * 面容 / 指纹登录, the signed-in half (第二十批 §一.4): the question asked once after the first sign-in, the row under
 * 设置 › 账号安全, and the sheet that asks for the password before it is turned on. The sign-in page's half is in
 * `auth.tsx`; the storage and the system calls are `deviceLogin.ts`; the decisions are `loginRules.ts`.
 */
import { soulErrorMessage, soulMfaFailure } from "@soulledger/core/api/soul";
import { platform } from "@soulledger/core/platform";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { APP_LOCK_KEY, CredentialStoreError, bioEnabled, enableWithPassword, markAsked, revokeCredential, wasAsked } from "../deviceLogin";
import { useToast } from "../feedback";
import { family } from "../fonts";
import { useI18n } from "../i18n";
import { shouldAskBio } from "../loginRules";
import { stateOfFailure, type StepState } from "../mfa";
import { useSession } from "../session";
import { useBiometry } from "../useBiometry";
import { Button, Input, SwitchMark, Txt, useLayout, useTheme } from "../ui";
import { ButtonPair, MfaSheet, StepNotice } from "./mfaParts";

function SheetTitle({ children }: { children: string }) {
  return (
    <Txt accessibilityRole="header" style={styles.sheetTitle}>
      {children}
    </Txt>
  );
}

/** 「换一个账号？」: the sign-in page's confirmation. `id` is the grouped code, `bio` the word. */
export function SwitchAccountSheet({ open, id, bio, onCancel, onConfirm }: { open: boolean; id: string; bio: string; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  return (
    <MfaSheet testID="switch-sheet" open={open} onClose={onCancel} closeLabel={t("soul_app.common.cancel")}>
      <SheetTitle>{t("soul_app.login.switch_title")}</SheetTitle>
      <Txt variant="bodyLg">{t("soul_app.login.switch_body", { id, bio })}</Txt>
      <ButtonPair>
        <Button testID="switch-cancel" kind="secondary" title={t("soul_app.common.cancel")} onPress={onCancel} style={styles.fill} />
        <Button testID="switch-confirm" title={t("soul_app.login.switch_ok")} onPress={onConfirm} style={styles.fill} />
      </ButtonPair>
    </MfaSheet>
  );
}

/** 设置里「开启面容登录」: the current password first (being signed in is not being the owner), then the system verifies. */
export function EnableBioSheet({ open, word, onClose, onEnabled }: { open: boolean; word: string; onClose: () => void; onEnabled: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<StepState>({ kind: "idle" });
  const field = useRef<TextInput>(null);
  const close = () => {
    setPassword("");
    setState({ kind: "idle" });
    onClose();
  };
  const next = async () => {
    if (!password || busy || state.kind === "rate_limited") return;
    setBusy(true);
    setState({ kind: "idle" });
    try {
      await enableWithPassword(password);
      close();
      onEnabled();
    } catch (e) {
      if (e instanceof CredentialStoreError) {
        // The soul walked away from the system prompt (nothing to say) or the phone refused (say so).
        close();
        if (e.failure !== "cancelled") toast(t("soul_app.settings.toggle_failed"), "failure");
      } else {
        setState(stateOfFailure(soulMfaFailure(e)));
        field.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <MfaSheet testID="bio-enable-sheet" open={open} onClose={close} closeLabel={t("soul_app.common.cancel")}>
      <SheetTitle>{t("soul_app.bio.enable_title", { bio: word })}</SheetTitle>
      <Txt variant="bodyLg">{t("soul_app.bio.enable_body", { bio: word })}</Txt>
      <Input
        testID="bio-password"
        inputRef={field}
        label={t("soul_app.login.password")}
        value={password}
        onChangeText={setPassword}
        editable={!busy}
        invalid={state.kind === "wrong"}
        secureTextEntry
        secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
        autoComplete="current-password"
        onSubmitEditing={() => void next()}
      />
      <StepNotice state={state} password />
      <ButtonPair>
        <Button testID="bio-enable-cancel" kind="secondary" title={t("soul_app.common.cancel")} onPress={close} disabled={busy} style={styles.fill} />
        <Button testID="bio-enable-next" title={t("soul_app.bio.enable_next")} onPress={() => void next()} busy={busy} disabled={!password || state.kind === "rate_limited"} style={styles.fill} />
      </ButtonPair>
    </MfaSheet>
  );
}

/**
 * 切回 App 时也要验证 (S2): the second switch of the 面容 / 指纹 login. Usable only while that is on; turning that off
 * turns this off (`clearCredential` drops the key). Default off. The lock itself is `appLock.tsx`.
 */
function AppLockRow({ enabled, word }: { enabled: boolean; word: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  // The phone's own record is the truth (turning 面容 login off removes the key); this only repaints after a press.
  const [, repaint] = useState(0);
  const on = enabled && platform().persistent.get(APP_LOCK_KEY) === "1";
  const press = () => {
    if (!enabled) return;
    if (on) platform().persistent.remove(APP_LOCK_KEY);
    else platform().persistent.set(APP_LOCK_KEY, "1");
    repaint((n) => n + 1);
  };
  return (
    <Pressable
      testID="app-lock-row"
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !enabled }}
      disabled={!enabled}
      onPress={press}
      style={[styles.row, { paddingHorizontal: gutter, borderBottomColor: theme.hair }, !enabled && styles.dim]}
    >
      <View style={styles.fill}>
        <Txt variant="bodyLg">{t("soul_app.biometric.app_lock")}</Txt>
        <Txt testID="app-lock-sub" variant="caption" tone="muted">
          {t("soul_app.biometric.app_lock_hint", { bio: word })}
        </Txt>
      </View>
      <SwitchMark on={on} large />
    </Pressable>
  );
}

/** The third row of 账号安全: a switch, for this phone only. Off needs no password. */
export function BioRow() {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  const bio = useBiometry();
  const [on, setOn] = useState(bioEnabled);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const unavailable = !on && bio.ready && !bio.enrolled;
  const press = async () => {
    if (busy || unavailable) return;
    if (!on) return setAsking(true);
    setBusy(true);
    await revokeCredential();
    setOn(false);
    setBusy(false);
  };
  return (
    <>
      <Pressable
        testID="bio-row"
        accessibilityRole="switch"
        accessibilityState={{ checked: on, disabled: unavailable }}
        disabled={unavailable}
        onPress={() => void press()}
        style={[styles.row, { paddingHorizontal: gutter, borderBottomColor: theme.hair }, unavailable && styles.dim]}
      >
        <View style={styles.fill}>
          <Txt variant="bodyLg">{t("soul_app.bio.row", { bio: bio.word })}</Txt>
          <Txt testID="bio-row-sub" variant="caption" tone="muted">
            {t(unavailable ? "soul_app.bio.row_unavailable" : "soul_app.bio.row_sub")}
          </Txt>
        </View>
        <Txt testID="bio-row-state" variant="bodyLg" tone={on ? "ink" : "muted"} style={on ? styles.on : undefined}>
          {t(on ? "soul_app.bio.on" : "soul_app.bio.off")}
        </Txt>
        <SwitchMark on={on} large />
      </Pressable>
      <AppLockRow enabled={on} word={bio.word} />
      <EnableBioSheet open={asking} word={bio.word} onClose={() => setAsking(false)} onEnabled={() => setOn(true)} />
    </>
  );
}

/**
 * 「下次用面容登录？」, once: at the first home page after a sign-in (or the password change that follows a first
 * sign-in) the session still holds the password that was just typed, and that is what 「开启」 uses. Saying 「以后再说」
 * ends the question for this soul code. The password is dropped here either way.
 */
export function BioAsk({ soulCode, welcomePending }: { soulCode: string; welcomePending: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const { heldPassword, dropPassword } = useSession();
  const bio = useBiometry();
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  // Due once the phone has said what it has enrolled, until the soul answers. A password that is not going to be
  // used is dropped at once -- but not while the welcome holds the question back: it is still going to be used.
  const due = bio.ready && !answered && shouldAskBio({ hasPassword: heldPassword() !== null, enrolled: bio.enrolled, enabled: bioEnabled(), asked: wasAsked(soulCode), welcomePending });
  useEffect(() => {
    if (bio.ready && !due && !welcomePending) dropPassword();
  }, [bio.ready, due, welcomePending, dropPassword]);

  const finish = () => {
    markAsked(soulCode);
    dropPassword();
    setAnswered(true);
  };
  const turnOn = async () => {
    const password = heldPassword();
    if (busy) return;
    if (!password) return finish();
    setBusy(true);
    try {
      await enableWithPassword(password);
    } catch (e) {
      if (e instanceof CredentialStoreError) {
        if (e.failure !== "cancelled") toast(t("soul_app.settings.toggle_failed"), "failure");
      } else {
        toast(t(soulErrorMessage(e).key, soulErrorMessage(e).params), "failure");
      }
    }
    setBusy(false);
    finish();
  };
  return (
    <MfaSheet testID="bio-ask" open={due} onClose={finish} closeLabel={t("soul_app.bio.ask_later")}>
      <SheetTitle>{t("soul_app.bio.ask_title", { bio: bio.word })}</SheetTitle>
      <Txt variant="bodyLg">{t("soul_app.bio.ask_body", { bio: bio.word })}</Txt>
      <Txt variant="body" tone="muted">
        {t("soul_app.bio.ask_note")}
      </Txt>
      <ButtonPair>
        <Button testID="bio-ask-later" kind="secondary" title={t("soul_app.bio.ask_later")} onPress={finish} disabled={busy} style={styles.fill} />
        <Button testID="bio-ask-ok" title={t("soul_app.bio.ask_ok")} onPress={() => void turnOn()} busy={busy} style={styles.fill} />
      </ButtonPair>
    </MfaSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheetTitle: { fontFamily: family.ui[600], fontSize: 20, lineHeight: 28 },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  dim: { opacity: 0.6 },
  on: { fontFamily: family.ui[600] },
});
