/**
 * 联系邮箱 (Design 第四十批 S-b): add or change the address the 「忘记密码」 code goes to. Three steps on one page:
 *   ① the current password (and, with two-step on, the six digits) — signed in is not the same as being the soul;
 *   ② the new address — the code goes to IT, not to the old one (the soul changing it often has lost the old one);
 *   ③ the code → done; the server tells the old address.
 * A hall that does this at the counter answers `email_in_person` at any step: the page says where to go instead.
 */
import {
  passwordResetAttemptsLeft,
  passwordResetErrorMessage,
  soulApi,
  soulErrorCode,
  soulErrorMessage,
  soulMfaFailure,
} from "@soulledger/core/api/soul";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import { stateOfFailure, type StepState } from "../mfa";
import { Button, Input, Notice, Screen, Skeleton, Txt, useLayout, useRemote } from "../ui";
import { DigitField, StepNotice } from "./mfaParts";

type Step = "verify" | "email" | "code";

export function ContactEmailScreen() {
  const { t } = useI18n();
  const { gutter } = useLayout();
  const toast = useToast();
  const navigation = useNavigation();
  const status = useRemote(soulApi.contactEmail);
  const [step, setStep] = useState<Step>("verify");
  const [password, setPassword] = useState("");
  const [digits, setDigits] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [inPerson, setInPerson] = useState(false);
  // One message at a time, under the step it belongs to.
  const [error, setError] = useState<string | null>(null);
  const [mfaState, setMfaState] = useState<StepState>({ kind: "idle" });

  /** Refusals every step shares: the hall does it in person, or the page sat past the 10-minute window. */
  const common = (e: unknown): boolean => {
    const c = soulErrorCode(e);
    if (c === "email_in_person") {
      setInPerson(true);
      return true;
    }
    if (c === "proof_required") {
      setStep("verify");
      return true;
    }
    return false;
  };

  const run = async (work: () => Promise<void>, refused: (e: unknown) => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      if (!common(e)) refused(e);
    } finally {
      setBusy(false);
    }
  };

  const verify = () =>
    run(
      async () => {
        setMfaState({ kind: "idle" });
        await soulApi.contactEmailVerify(password, status.data?.mfa_enabled ? digits : undefined);
        setPassword("");
        setDigits("");
        setStep("email");
      },
      (e) => {
        const f = soulMfaFailure(e);
        if (f.code === "wrong_password") setError(t("soul_app.mfa.wrong_password"));
        else if (f.code === "rate_limited") setError(t("soul_app.errors.rate_limited"));
        else if (["wrong", "expired", "locked", "network"].includes(f.code)) setMfaState(stateOfFailure(f));
        else setError(t(soulErrorMessage(e).key, soulErrorMessage(e).params));
      }
    );

  const send = () =>
    run(
      async () => {
        await soulApi.contactEmailStart(email.trim());
        setCode("");
        setStep("code");
      },
      (e) => {
        const c = soulErrorCode(e);
        // A malformed address is DRF's `{email: [...]}`, no code.
        if (c === null && soulErrorMessage(e).key === "soul_app.errors.validation") setError(t("soul_app.forgot_password.email_invalid"));
        else setError(t(passwordResetErrorMessage(e).key, passwordResetErrorMessage(e).params));
      }
    );

  const confirm = () =>
    run(
      async () => {
        await soulApi.contactEmailConfirm(code);
        toast(t("soul_app.settings.email_done"));
        navigation.goBack();
      },
      (e) => {
        if (soulErrorCode(e) === "email_taken") return setError(t("soul_app.settings.email_taken"));
        const left = passwordResetAttemptsLeft(e);
        const head = t(passwordResetErrorMessage(e).key, passwordResetErrorMessage(e).params);
        setError(left !== null ? `${head} ${t("soul_app.forgot_password.err_wrong_left", { n: String(left) })}` : head);
      }
    );

  if (!status.data) {
    return (
      <Screen testID="contact-email">
        <View style={[styles.page, { paddingHorizontal: gutter }]}>
          {status.error ? (
            <Notice tone="neg" onRetry={() => void status.reload()} testID="contact-email-error">
              {t(soulErrorMessage(status.error).key, soulErrorMessage(status.error).params)}
            </Notice>
          ) : (
            <Skeleton lines={3} testID="contact-email-loading" />
          )}
        </View>
      </Screen>
    );
  }
  if (inPerson || !status.data.can_change) {
    return (
      <Screen testID="contact-email">
        <View style={[styles.page, { paddingHorizontal: gutter }]}>
          <Notice tone="neutral" testID="contact-email-in-person">
            {t("soul_app.settings.email_in_person")}
          </Notice>
        </View>
      </Screen>
    );
  }

  return (
    <Screen testID="contact-email">
      <View style={[styles.page, { paddingHorizontal: gutter }]}>
        <Txt variant="caption" tone="subtle">
          {t("soul_app.settings.email_hint")}
        </Txt>
        {step === "verify" ? (
          <>
            <Input
              testID="contact-email-password"
              label={t("soul_app.login.password")}
              error={error}
              value={password}
              onChangeText={(next) => {
                setPassword(next);
                setError(null);
              }}
              editable={!busy}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
            />
            {status.data.mfa_enabled ? (
              <DigitField
                testID="contact-email-mfa"
                label={t("soul_app.mfa.login.code_label")}
                value={digits}
                onChange={setDigits}
                locked={busy || mfaState.kind === "locked"}
                invalid={mfaState.kind === "wrong"}
              />
            ) : null}
            <StepNotice state={mfaState} />
            <Button
              testID="contact-email-next"
              title={t("mfa.setup.next")}
              busy={busy}
              disabled={!password || (status.data.mfa_enabled && digits.length !== 6)}
              onPress={() => void verify()}
            />
          </>
        ) : step === "email" ? (
          <>
            <Input
              testID="contact-email-new"
              label={t("soul_app.settings.email_new")}
              error={error}
              value={email}
              onChangeText={(next) => {
                setEmail(next);
                setError(null);
              }}
              editable={!busy}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              autoComplete="email"
            />
            <Button testID="contact-email-send" title={t("soul_app.forgot_password.send")} busy={busy} disabled={!email.trim()} onPress={() => void send()} />
          </>
        ) : (
          <>
            <Txt testID="contact-email-sent" variant="body">
              {t("soul_app.settings.email_code_sent", { email: email.trim() })}
            </Txt>
            <DigitField testID="contact-email-code" label={t("soul_app.forgot_password.code")} value={code} onChange={setCode} locked={busy} invalid={!!error} />
            {error ? (
              <Txt testID="contact-email-code-error" variant="body" tone="negInk">
                {error}
              </Txt>
            ) : null}
            <Button testID="contact-email-confirm" title={t("common.confirm")} busy={busy} disabled={code.length !== 6} onPress={() => void confirm()} />
            <Button testID="contact-email-resend" kind="secondary" title={t("soul_app.forgot_password.resend")} disabled={busy} onPress={() => void send()} />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingVertical: 16, gap: 16 },
});
