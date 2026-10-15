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
import { resetFailure, splitCommonReasons, type ResetFailure } from "../rules";
import { AccountFrame } from "./account";
import { Button, FieldError, Input, Notice, PasswordMatch, PasswordRules, Txt, space, useI18n, usePasswordForm } from "../shared";

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
  const [fail, setFail] = useState<ResetFailure | null>(null);

  const { fields, holdScroller, holdSection, newJudged, confirmJudged, common: commonRejected, check, rejectCommon } = usePasswordForm({ next: password, confirm });

  const submit = () => {
    setFail(null);
    // The checklist under the box says what is missing; nothing is sent until it is all met.
    if (!check()) return;
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
          // Too common / too like the name: said in the checklist, not as a line under the field.
          if (failure.kind === "weak" && splitCommonReasons(failure.reasons).common) rejectCommon();
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
          <Notice tone="neg">{t("auth.reset_invalid")}</Notice>
          <Txt variant="body" tone="muted">{t("auth.reset_invalid_body")}</Txt>
        </View>
        {onRequestAgain ? <ActionButton testID="reset-request-again" kind="outline" title={t("auth.reset_request_again")} onPress={onRequestAgain} /> : null}
      </AccountFrame>
    );
  }

  const weakCommon = fail?.kind === "weak" ? splitCommonReasons(fail.reasons) : null;
  const weak = fail?.kind === "weak" ? (weakCommon!.rest.length ? weakCommon!.rest : fail.reasons.length ? [] : ["auth.reset_weak"]) : [];
  const notice =
    fail?.kind === "network" ? "officer_app.login.reasons.network" : fail?.kind === "rate" ? "auth.rate_limited" : fail?.kind === "other" ? "auth.forgot_failed" : null;
  return (
    <AccountFrame testID="reset-screen" onBack={onClose} scrollRef={holdScroller}>
      <Txt variant="title">{t("auth.reset_title")}</Txt>
      <Txt variant="body" tone="muted">{t("auth.reset_subtitle")}</Txt>
      {notice ? <Notice tone="neg" testID="reset-failure">{t(notice)}</Notice> : null}
      <View ref={holdSection} collapsable={false} style={{ gap: space[3] }}>
        <Input
          testID="reset-new"
          label={t("profile.new_password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
          {...fields.next}
          invalid={fields.next.invalid || weak.length > 0}
        />
        {weak.map((key) => <FieldError key={key} testID="reset-new-error" text={t(key)} />)}
        <PasswordRules next={password} judged={newJudged} common={commonRejected} />
      </View>
      <View style={{ gap: space[3] }}>
        <Input
          testID="reset-confirm"
          label={t("profile.confirm_password")}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
          {...fields.confirm}
        />
        <PasswordMatch next={password} confirm={confirm} judged={confirmJudged} />
      </View>
      <Button testID="reset-submit" title={t("auth.reset_submit")} busy={busy} onPress={submit} />
    </AccountFrame>
  );
}
