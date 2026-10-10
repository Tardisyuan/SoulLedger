/**
 * Account screens that are not a tab: the frame they share (a back row and the Android back key),
 * 忘记密码 (shown by the sign-in screen) and 修改密码 (from 我的).
 *
 * 忘记密码 only SENDS the request (`officer-reset/request/`, always the same 200 whatever the
 * identifier, so nothing here may say whether an account exists). The mailed link lands on the desk,
 * where the new password is chosen: the app has no universal-link domain to receive it.
 *
 * 修改密码 signs every OTHER device out and keeps this one: `authApi.changePassword` sends this device's
 * refresh token and stores the new pair it gets back. Its refusals are one line per reason, by the
 * server's reason code, under the field they are about; the password is never echoed.
 */
import { authApi } from "@soulledger/core/api/auth";
import { useEffect, useState, type ReactNode } from "react";
import { BackHandler, Linking, Pressable, View } from "react-native";

import { ActionButton } from "../kit";
import { adminHelpUrl, forgotFailureKey, passwordFailure } from "../rules";
import { Button, FieldError, Icon, Input, Notice, Screen, Txt, space, useI18n, useTheme, useToast } from "../shared";

/** A back row over a screen. `locked`: leaving is not allowed now (the Android back key is swallowed too). */
export function AccountFrame({ testID, onBack, locked, children }: { testID: string; onBack: () => void; locked?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const theme = useTheme();
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!locked) onBack();
      return true;
    });
    return () => sub.remove();
  }, [locked, onBack]);
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: theme.s0 }}>
      {locked ? null : (
        <Pressable
          testID={`${testID}-back`}
          accessibilityRole="button"
          accessibilityLabel={t("officer_app.back")}
          onPress={onBack}
          style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[5], borderBottomWidth: 1, borderBottomColor: theme.hair }}
        >
          <Icon name="back" size={16} color={theme.ink} />
          <Txt variant="nav">{t("officer_app.back")}</Txt>
        </Pressable>
      )}
      <Screen edges={["left", "right"]}>
        <View style={{ padding: space[5], gap: space[4] }}>{children}</View>
      </Screen>
    </View>
  );
}

/** The sign-in screen's 忘记密码 step: a username or e-mail in, one neutral sentence out. */
export function ForgotPassword({ initial, onBack }: { initial: string; onBack: () => void }) {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = () => {
    setBusy(true);
    setFailure(null);
    authApi
      .requestOfficerReset(identifier.trim())
      .then(
        () => setSent(true),
        (e: unknown) => setFailure(t(forgotFailureKey(e)))
      )
      .finally(() => setBusy(false));
  };

  if (sent) {
    return (
      <View testID="forgot-sent" style={{ gap: space[4] }}>
        <Txt variant="title">{t("auth.forgot_password")}</Txt>
        <Notice tone="neutral">
          <Txt variant="caption">{t("auth.forgot_email_sent")}</Txt>
        </Notice>
        <Txt variant="body" tone="muted">{t("auth.forgot_email_sent_body")}</Txt>
        <ActionButton testID="forgot-admin" kind="outline" title={`${t("auth.forgot_notify_admin")} ↗︎`} onPress={() => void Linking.openURL(adminHelpUrl()).catch(() => {})} />
        <ActionButton testID="forgot-back" kind="outline" title={t("auth.back_to_login")} onPress={onBack} />
      </View>
    );
  }
  return (
    <View testID="forgot-form" style={{ gap: space[4] }}>
      <Txt variant="title">{t("auth.forgot_password")}</Txt>
      <Txt variant="body" tone="muted">{t("auth.forgot_email_desc")}</Txt>
      {failure ? <Notice tone="neg" testID="forgot-failure">{`! ${failure}`}</Notice> : null}
      <Input testID="forgot-identifier" label={t("auth.forgot_email_label")} value={identifier} onChangeText={setIdentifier} textContentType="username" autoComplete="username" autoCapitalize="none" autoCorrect={false} />
      <Button testID="forgot-submit" title={t("auth.forgot_email_submit")} busy={busy} disabled={!identifier.trim()} onPress={submit} />
      <ActionButton testID="forgot-back" kind="outline" title={t("auth.back_to_login")} onPress={onBack} />
    </View>
  );
}

const MIN_PASSWORD_LENGTH = 8;

export function ChangePasswordScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const [fail, setFail] = useState<ReturnType<typeof passwordFailure> | null>(null);

  const submit = () => {
    setFail(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setLocal(t("profile.password_too_short"));
    if (newPassword !== confirm) return setLocal(t("profile.password_mismatch"));
    setLocal(null);
    setBusy(true);
    authApi
      .changePassword(oldPassword, newPassword)
      .then(
        () => {
          // The server signed every other device out; `changePassword` stored this device's new token pair.
          toast(t("profile.password_changed_others_out"), "success");
          onBack();
        },
        (e: unknown) => setFail(passwordFailure(e))
      )
      .finally(() => setBusy(false));
  };

  const none = fail && !fail.network && !fail.old.length && !fail.next.length && !fail.other.length;
  return (
    <AccountFrame testID="password-screen" onBack={onBack}>
      <Txt variant="title">{t("profile.change_password")}</Txt>
      {fail?.network ? <Notice tone="neg" testID="password-failure">{`! ${t("officer_app.login.reasons.network")}`}</Notice> : null}
      {none ? <Notice tone="neg" testID="password-failure">{`! ${t("profile.password_change_failed")}`}</Notice> : null}
      {fail?.other.length ? (
        <View testID="password-failure" style={{ gap: space[1] }}>
          {fail.other.map((line) => <FieldError key={line} text={line} />)}
        </View>
      ) : null}
      <Input
        testID="password-old"
        label={t("profile.old_password")}
        value={oldPassword}
        onChangeText={setOld}
        invalid={!!fail?.old.length}
        secureTextEntry
        textContentType="password"
        autoComplete="current-password"
        secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
      />
      {fail?.old.map((key) => <FieldError key={key} testID="password-old-error" text={t(key)} />)}
      <Input
        testID="password-new"
        label={t("profile.new_password")}
        value={newPassword}
        onChangeText={setNew}
        invalid={!!fail?.next.length}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
      />
      {fail?.next.map((key) => <FieldError key={key} testID="password-new-error" text={t(key)} />)}
      <Input
        testID="password-confirm"
        label={t("profile.confirm_password")}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
      />
      {local ? <FieldError testID="password-local-error" text={local} /> : null}
      <Button testID="password-submit" title={t("common.save")} busy={busy} disabled={!oldPassword || !newPassword || !confirm} onPress={submit} />
    </AccountFrame>
  );
}
