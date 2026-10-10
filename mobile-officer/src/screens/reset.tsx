/**
 * 设置新密码, reached from the desk page's "open in the officer app" link (`soulledger-officer://reset?...`,
 * see links.ts). Two new-password fields; one request, `officer-reset/confirm/`, carrying the link's uid and
 * token. The refusals are told apart by their code and shown where they belong: a weak password reason by
 * reason under the field (like 修改密码), a dead link as its own state with a way back to 忘记密码.
 *
 * The credential comes in as a prop and goes out with the screen: it is not rendered, logged, stored or put
 * anywhere that outlives this component. A success (the server has signed every device out) or a dead link
 * retires it, so a re-delivered copy of the same link does not reopen this form.
 */
import { authApi } from "@soulledger/core/api/auth";
import { useState } from "react";
import { View } from "react-native";

import { ActionButton } from "../kit";
import { retireResetLink, type ResetLink } from "../links";
import { resetFailure, type ResetFailure } from "../rules";
import { AccountFrame } from "./account";
import { Button, FieldError, Input, Notice, Txt, space, useI18n } from "../shared";

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordScreen({
  credential,
  onClose,
  onDone,
  onRequestAgain,
}: {
  credential: ResetLink;
  /** Leave without resetting. */
  onClose: () => void;
  /** The password was reset and every device is signed out; the caller shows the sign-in page. */
  onDone: () => void;
  /** Offered with a dead link when the caller can start 忘记密码 (only while signed out). */
  onRequestAgain?: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const [fail, setFail] = useState<ResetFailure | null>(null);

  const submit = () => {
    setFail(null);
    if (password.length < MIN_PASSWORD_LENGTH) return setLocal(t("profile.password_too_short"));
    if (password !== confirm) return setLocal(t("profile.password_mismatch"));
    setLocal(null);
    setBusy(true);
    authApi
      .confirmOfficerReset({ uid: credential.uid, token: credential.token, new_password: password })
      .then(
        () => {
          retireResetLink(credential);
          onDone();
        },
        (e: unknown) => {
          const failure = resetFailure(e);
          if (failure.kind === "invalid") retireResetLink(credential);
          setFail(failure);
          setBusy(false);
        }
      );
  };

  if (fail?.kind === "invalid") {
    return (
      <AccountFrame testID="reset-screen" onBack={onClose}>
        <Txt variant="title">{t("auth.reset_title")}</Txt>
        <View testID="reset-invalid" style={{ gap: space[3] }}>
          <Notice tone="neg">{`! ${t("auth.reset_invalid")}`}</Notice>
          <Txt variant="body" tone="muted">{t("auth.reset_invalid_body")}</Txt>
        </View>
        {onRequestAgain ? <ActionButton testID="reset-request-again" kind="outline" title={t("auth.reset_request_again")} onPress={onRequestAgain} /> : null}
      </AccountFrame>
    );
  }

  const weak = fail?.kind === "weak" ? (fail.reasons.length ? fail.reasons : ["auth.reset_weak"]) : [];
  const notice =
    fail?.kind === "network" ? "officer_app.login.reasons.network" : fail?.kind === "rate" ? "auth.rate_limited" : fail?.kind === "other" ? "auth.forgot_failed" : null;
  return (
    <AccountFrame testID="reset-screen" onBack={onClose}>
      <Txt variant="title">{t("auth.reset_title")}</Txt>
      <Txt variant="body" tone="muted">{t("auth.reset_subtitle")}</Txt>
      {notice ? <Notice tone="neg" testID="reset-failure">{`! ${t(notice)}`}</Notice> : null}
      <Input
        testID="reset-new"
        label={t("profile.new_password")}
        value={password}
        onChangeText={setPassword}
        invalid={weak.length > 0}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
      />
      {weak.map((key) => <FieldError key={key} testID="reset-new-error" text={t(key)} />)}
      <Input
        testID="reset-confirm"
        label={t("profile.confirm_password")}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
      />
      {local ? <FieldError testID="reset-local-error" text={local} /> : null}
      <Button testID="reset-submit" title={t("auth.reset_submit")} busy={busy} disabled={!password || !confirm} onPress={submit} />
    </AccountFrame>
  );
}
