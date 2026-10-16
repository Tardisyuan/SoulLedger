/**
 * Account screens that are not a tab: the frame they share (a back row and the Android back key),
 * 忘记密码 (shown by the sign-in screen) and 修改密码 (from 我的).
 *
 * 忘记密码 only SENDS the request (`officer-reset/request/`, always the same 200 whatever the
 * identifier, so nothing here may say whether an account exists). The mailed link lands on the desk,
 * where the new password is chosen: the app has no universal-link domain to receive it.
 *
 * 修改密码 signs every OTHER device out and keeps this one: `authApi.changePassword` sends this device's
 * refresh token and push token (the others' push registrations go with their sessions) and stores the new pair it gets back. Its refusals are one line per reason, by the
 * server's reason code, under the field they are about; the password is never echoed.
 */
import { authApi } from "@soulledger/core/api/auth";
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { BackHandler, Linking, Pressable, View, type ScrollView } from "react-native";

import { ActionButton } from "../kit";
import { registeredToken } from "../push";
import { adminHelpUrl, forgotFailureKey, passwordFailure, splitCommonReasons } from "../rules";
import { passwordMinLength } from "@soulledger/core/domain/passwordRules";

import { useSession } from "../session";
import { Button, FieldError, Icon, Input, Notice, PasswordMatch, PasswordRules, Screen, Txt, space, useI18n, usePasswordForm, useTheme, useToast } from "../shared";

/** A back row over a screen. `locked`: leaving is not allowed now (the Android back key is swallowed too). */
export function AccountFrame({
  testID,
  onBack,
  locked,
  scrollRef,
  children,
}: {
  testID: string;
  onBack: () => void;
  locked?: boolean;
  /** For a form that scrolls its new-password block to the top when it is focused. */
  scrollRef?: Ref<ScrollView>;
  children: ReactNode;
}) {
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
      <Screen edges={["left", "right"]} belowHeader scrollRef={scrollRef}>
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
      {failure ? <Notice tone="neg" testID="forgot-failure">{failure}</Notice> : null}
      <Input testID="forgot-identifier" label={t("auth.forgot_email_label")} value={identifier} onChangeText={setIdentifier} textContentType="username" autoComplete="username" autoCapitalize="none" autoCorrect={false} />
      <Button testID="forgot-submit" title={t("auth.forgot_email_submit")} busy={busy} disabled={!identifier.trim()} onPress={submit} />
      <ActionButton testID="forgot-back" kind="outline" title={t("auth.back_to_login")} onPress={onBack} />
    </View>
  );
}

/**
 * `required`: the password must be changed before anything else (first sign-in, an administrator's reset, aged out).
 * The screen then has no way back -- only the change or signing out -- and says why in one line above the form.
 */
export function ChangePasswordScreen({ onBack, required }: { onBack: () => void; required?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const { state, signOut, setPasswordChangeRequired } = useSession();
  const minLength = passwordMinLength(state.status === "signedIn" ? state.user.role : undefined);
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<(ReturnType<typeof passwordFailure> & { common?: boolean }) | null>(null);
  const { fields, holdScroller, holdSection, newJudged, confirmJudged, common: commonRejected, check, rejectCommon } = usePasswordForm({ old: oldPassword, next: newPassword, confirm, minLength });

  const submit = () => {
    setFail(null);
    // The checklist under the box says what is missing; nothing is sent until it is all met.
    if (!check()) return;
    setBusy(true);
    authApi
      .changePassword(oldPassword, newPassword, registeredToken())
      .then(
        () => {
          // The server signed every other device out; `changePassword` stored this device's new token pair.
          toast(t("profile.password_changed_others_out"), "success");
          if (required) setPasswordChangeRequired(false);
          onBack();
        },
        (e: unknown) => {
          const failure = passwordFailure(e);
          // Too common / too like the name: said in the checklist, not as a line under the field.
          const { common, rest } = splitCommonReasons(failure.next);
          if (common) rejectCommon();
          setFail({ ...failure, next: rest, common });
        }
      )
      .finally(() => setBusy(false));
  };

  const none = fail && !fail.network && !fail.common && !fail.old.length && !fail.next.length && !fail.other.length;
  return (
    <AccountFrame testID="password-screen" onBack={onBack} locked={required} scrollRef={holdScroller}>
      <Txt variant="title">{t("profile.change_password")}</Txt>
      {required ? <Notice tone="neutral" testID="password-must-change"><Txt variant="caption">{t("profile.password_must_change")}</Txt></Notice> : null}
      {fail?.network ? <Notice tone="neg" testID="password-failure">{t("officer_app.login.reasons.network")}</Notice> : null}
      {none ? <Notice tone="neg" testID="password-failure">{t("profile.password_change_failed")}</Notice> : null}
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
        {...fields.old}
      />
      {fail?.old.map((key) => <FieldError key={key} testID="password-old-error" text={t(key)} />)}
      <View ref={holdSection} collapsable={false} style={{ gap: space[3] }}>
        <Input
          testID="password-new"
          label={t("profile.new_password")}
          value={newPassword}
          onChangeText={setNew}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
          {...fields.next}
          invalid={fields.next.invalid || !!fail?.next.length}
        />
        {fail?.next.map((key) => <FieldError key={key} testID="password-new-error" text={t(key)} />)}
        <PasswordRules next={newPassword} old={oldPassword} judged={newJudged} common={commonRejected} minLength={minLength} />
      </View>
      <View style={{ gap: space[3] }}>
        <Input
          testID="password-confirm"
          label={t("profile.confirm_password")}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
          {...fields.confirm}
        />
        <PasswordMatch next={newPassword} confirm={confirm} judged={confirmJudged} />
      </View>
      <Button testID="password-submit" title={t("common.save")} busy={busy} onPress={submit} />
      {required ? <ActionButton testID="password-signout" kind="outline" title={t("officer_app.me.logout")} onPress={signOut} /> : null}
    </AccountFrame>
  );
}

/** `User.display_name` is `CharField(max_length=100)` (backend/apps/authentication/models.py); the server refuses longer. */
export const DISPLAY_NAME_MAX = 100;

/** 我的 › 姓名: one field, `PATCH /auth/profile/ {display_name}`. Blank is refused here and by the server. */
export function DisplayNameScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { state, setDisplayName } = useSession();
  const [name, setName] = useState(state.status === "signedIn" ? state.user.display_name : "");
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    setBusy(true);
    authApi
      .updateProfile({ display_name: trimmed })
      .then(
        (r) => {
          setDisplayName(r.data.display_name);
          toast(t("profile.profile_updated"), "success");
          onBack();
        },
        () => toast(t("profile.profile_update_failed"), "failure")
      )
      .finally(() => setBusy(false));
  };

  return (
    <AccountFrame testID="name-screen" onBack={onBack}>
      <Txt variant="title">{t("officer_app.me.name")}</Txt>
      <Input
        testID="name-input"
        label={t("officer_app.me.name")}
        value={name}
        onChangeText={setName}
        maxLength={DISPLAY_NAME_MAX}
        autoCorrect={false}
        error={empty ? t("officer_app.me.name_empty") : null}
      />
      <Button testID="name-submit" title={t("common.save")} busy={busy} onPress={submit} />
    </AccountFrame>
  );
}
