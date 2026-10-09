/**
 * Sign-in: username + password, no hall. If the server cannot tell which hall (409 `hall_required`)
 * a 「选殿」 step follows and the sign-in is sent again with the chosen `tenant_code`; if the account
 * has two-step verification, a code step follows (`mfa_required` + `pending_token`).
 */
import { useState } from "react";
import { Linking, View } from "react-native";

import { OFFICER_BRAND } from "../brand";
import { ActionButton, Row } from "../kit";
import { forgotPasswordUrl, loginFailureKey } from "../rules";
import { useSession, type Hall } from "../session";
import { BrandMark, Button, Input, Notice, Screen, Txt, space, useI18n } from "../shared";

type Step = { name: "credentials" } | { name: "hall"; halls: Hall[] } | { name: "mfa"; pendingToken: string; recovery: boolean };

export function LoginScreen() {
  const { t } = useI18n();
  const { signIn, verifyMfa } = useSession();
  const [step, setStep] = useState<Step>({ name: "credentials" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = (work: Promise<unknown>, kind: "login" | "mfa") => {
    setBusy(true);
    setFailure(null);
    return work
      .catch((e: unknown) => setFailure(t(loginFailureKey(e, kind))))
      .finally(() => setBusy(false));
  };

  const submit = (tenantCode?: string) =>
    run(
      signIn(username.trim(), password, tenantCode).then((result) => {
        if (result.kind === "hall") setStep({ name: "hall", halls: result.halls });
        else if (result.kind === "mfa") setStep({ name: "mfa", pendingToken: result.pendingToken, recovery: false });
        // "done": the session state changed and this screen is gone.
      }),
      "login"
    );

  const verify = () => {
    if (step.name !== "mfa") return;
    void run(
      verifyMfa({
        pendingToken: step.pendingToken,
        ...(step.recovery ? { recoveryCode: code.trim() } : { code: code.trim() }),
        remember,
      }),
      "mfa"
    );
  };

  return (
    <Screen testID="login" edges={["left", "right", "top", "bottom"]}>
      <View style={{ padding: space[5], gap: space[5] }}>
        <View style={{ alignItems: "center", gap: space[3], paddingTop: space[5] }}>
          <BrandMark testID="login-mark" size={64} color={OFFICER_BRAND.mark} />
          <Txt variant="display">{t("officer_app.name")}</Txt>
        </View>

        {failure ? (
          <Notice tone="neg" testID="login-failure">{`! ${failure}`}</Notice>
        ) : null}

        {step.name === "credentials" ? (
          <View style={{ gap: space[4] }}>
            <Input testID="login-username" label={t("officer_app.login.username")} value={username} onChangeText={setUsername} textContentType="username" autoComplete="username" />
            <Input
              testID="login-password"
              label={t("officer_app.login.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
            />
            <Button testID="login-submit" title={t("officer_app.login.submit")} busy={busy} disabled={!username.trim() || !password} onPress={() => void submit()} />
            {/* 忘记密码 opens the desk's request page in the browser; the app does nothing more. */}
            <ActionButton
              testID="login-forgot"
              kind="outline"
              title={`${t("officer_app.login.forgot_password")} ↗`}
              onPress={() => void Linking.openURL(forgotPasswordUrl()).catch(() => {})}
            />
          </View>
        ) : null}

        {step.name === "hall" ? (
          <View testID="login-halls" style={{ gap: space[3] }}>
            <Txt variant="title">{t("officer_app.login.hall_title")}</Txt>
            <Txt variant="body" tone="muted">{t("officer_app.login.hall_body")}</Txt>
            <View>
              {step.halls.map((hall) => (
                <Row key={hall.code} testID={`hall-${hall.code}`} minHeight={64} strong title={hall.display_name} lines={[hall.code]} onPress={busy ? undefined : () => void submit(hall.code)} />
              ))}
            </View>
            <ActionButton kind="outline" title={t("soul_app.common.cancel")} onPress={() => { setStep({ name: "credentials" }); setFailure(null); }} />
          </View>
        ) : null}

        {step.name === "mfa" ? (
          <View testID="login-mfa" style={{ gap: space[4] }}>
            <Txt variant="title">{t("officer_app.mfa.title")}</Txt>
            <Txt variant="body" tone="muted">{t(step.recovery ? "officer_app.mfa.recovery_body" : "officer_app.mfa.body")}</Txt>
            <Input
              testID="mfa-code"
              label={t(step.recovery ? "officer_app.mfa.recovery_label" : "officer_app.mfa.code_label")}
              value={code}
              onChangeText={setCode}
              mono
              keyboardType={step.recovery ? "default" : "number-pad"}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
            />
            <ActionButton
              testID="mfa-remember"
              kind="outline"
              title={`${remember ? "✓" : "○"} ${t("officer_app.mfa.remember")}`}
              onPress={() => setRemember((v) => !v)}
            />
            <Button testID="mfa-submit" title={t("officer_app.mfa.submit")} busy={busy} disabled={!code.trim()} onPress={verify} />
            <ActionButton
              testID="mfa-toggle"
              kind="outline"
              title={t(step.recovery ? "officer_app.mfa.use_code" : "officer_app.mfa.use_recovery")}
              onPress={() => {
                setCode("");
                setFailure(null);
                setStep({ ...step, recovery: !step.recovery });
              }}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
