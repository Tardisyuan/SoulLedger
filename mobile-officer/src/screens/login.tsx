/**
 * Sign-in: username + password, no hall. If the server cannot tell which hall (409 `hall_required`)
 * a 「选殿」 step follows and the sign-in is sent again with the chosen `tenant_code`; if the account
 * has two-step verification, a code step follows (`mfa_required` + `pending_token`).
 *
 * 指纹登录 (2026-11-15 O5): when the remembered officer turned it on on this phone, 「用指纹登录」 comes first (and opens
 * by itself on the first sign-in page of the process); the password stays below it. A credential the server no longer
 * takes (password changed, device signed out, turned off elsewhere) is dropped here and the page says so.
 */
import { mfaDigits } from "@soulledger/core/domain/mfa";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useBio } from "../bioLogin";
import { OFFICER_BRAND } from "../brand";
import { autoPromptDue, officerDevice, spendAutoPrompt } from "../deviceLogin";
import { ActionButton, Row } from "../kit";
import { MFA_TIMED_OUT, loginFailureKey } from "../rules";
import { ForgotPassword } from "./account";
import { forgetLastLogin, readLastLogin, useSession, type Hall } from "../session";
import { BrandMark, Button, Input, Notice, Screen, SmallButton, Txt, space, useI18n } from "../shared";

type Step = { name: "credentials" } | { name: "forgot" } | { name: "hall"; halls: Hall[] } | { name: "mfa"; pendingToken: string; recovery: boolean };

/** Why the sign-in page opens as it does after a reset link: `reset_done` says so; `forgot` starts at 忘记密码 (the link was dead). */
export type LoginHint = "reset_done" | "forgot";

/** 「zh***g」: enough to recognise one's own account, not enough to read it off someone else's phone. */
export function maskUsername(name: string): string {
  const head = name.length >= 5 ? 2 : 1;
  const tail = name.length >= 3 ? 1 : 0;
  return `${name.slice(0, head)}***${tail ? name.slice(-tail) : ""}`;
}

export function LoginScreen({ hint }: { hint?: LoginHint | null } = {}) {
  const { t } = useI18n();
  const { signIn, signInWithCredential, verifyMfa } = useSession();
  // What the phone said when 指纹登录 was turned on: no read here, so the page has no late update.
  const bio = useBio(false);
  const [step, setStep] = useState<Step>(hint === "forgot" ? { name: "forgot" } : { name: "credentials" });
  // The last officer on this phone (survives sign-out, 401, cold start): their username, password box focused.
  const [known, setKnown] = useState(readLastLogin);
  const [username, setUsername] = useState(() => known?.username ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // 指纹登录 is on for the remembered officer (the credential belongs to them; session.tsx `land`).
  const [bioOn, setBioOn] = useState(() => !!known && officerDevice.bioEnabled());

  const bioSignIn = async () => {
    if (!known || busy) return;
    setBusy(true);
    setFailure(null);
    const read = await officerDevice.readCredential();
    if (read.status !== "ok") {
      setBusy(false);
      if (read.status === "cancelled") return;
      // The phone's enrolled fingers changed: the key is gone for good.
      if (read.status === "invalidated") {
        officerDevice.clearCredential();
        setBioOn(false);
      }
      const key = { invalidated: "officer_app.bio_login.expired", locked: "officer_app.bio_login.locked", failed: "officer_app.bio_login.failed" }[read.status];
      setFailure(t(key, { bio: bio.word }));
      return;
    }
    try {
      const result = await signInWithCredential(known.username, read.credential);
      if (result.kind === "mfa") setStep({ name: "mfa", pendingToken: result.pendingToken, recovery: false });
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === "device_login_revoked" || code === "device_login_invalid") {
        officerDevice.clearCredential();
        setBioOn(false);
        setFailure(t("officer_app.bio_login.expired", { bio: bio.word }));
      } else {
        setFailure(t(loginFailureKey(e, "login")));
      }
    } finally {
      setBusy(false);
    }
  };

  // The first sign-in page of the process asks by itself (a timer: `bioSignIn` sets state before its first await).
  useEffect(() => {
    if (!bioOn || !autoPromptDue() || hint) return;
    spendAutoPrompt();
    const id = setTimeout(() => void bioSignIn(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  const run = (work: Promise<unknown>, kind: "login" | "mfa", recovery = false) => {
    setBusy(true);
    setFailure(null);
    return work
      .catch((e: unknown) => {
        const key = loginFailureKey(e, kind, recovery);
        setFailure(t(key));
        // The pending sign-in ran out: no code will pass any more, so back to the password.
        if (key === MFA_TIMED_OUT) {
          setCode("");
          setStep({ name: "credentials" });
        }
      })
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
      "mfa",
      step.recovery
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
          <Notice tone="neg" testID="login-failure">{failure}</Notice>
        ) : null}

        {step.name === "credentials" ? (
          <View style={{ gap: space[4] }}>
            {hint === "reset_done" && !failure ? (
              <Notice tone="neutral" testID="login-reset-done">{`${t("auth.reset_done")}\n${t("auth.reset_done_body")}`}</Notice>
            ) : null}
            {known ? (
              <Row
                testID="login-known"
                minHeight={56}
                title={known.display_name ? `${known.display_name} · ${maskUsername(known.username)}` : maskUsername(known.username)}
                right={
                  <SmallButton
                    testID="login-switch"
                    title={t("soul_app.login.switch")}
                    onPress={() => {
                      forgetLastLogin();
                      // 「换一个账号」 takes the fingerprint sign-in with it, on the server too (audit §1 principle 2).
                      if (bioOn) void officerDevice.revokeCredential();
                      setBioOn(false);
                      setKnown(null);
                      setUsername("");
                      setPassword("");
                      setFailure(null);
                    }}
                  />
                }
              />
            ) : (
              <Input testID="login-username" label={t("officer_app.login.username")} value={username} onChangeText={setUsername} textContentType="username" autoComplete="username" keyboardType="ascii-capable" autoCapitalize="none" autoCorrect={false} />
            )}
            {bioOn ? (
              <Button testID="login-bio" title={t("officer_app.bio_login.button", { bio: bio.word })} busy={busy} onPress={() => void bioSignIn()} />
            ) : null}
            <Input
              testID="login-password"
              label={t("officer_app.login.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              autoFocus={!!known && !bioOn}
              secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
            />
            <Button testID="login-submit" kind={bioOn ? "secondary" : "primary"} title={t("officer_app.login.submit")} busy={busy} disabled={!username.trim() || !password} onPress={() => void submit()} />
            <ActionButton
              testID="login-forgot"
              kind="outline"
              title={t("officer_app.login.forgot_password")}
              onPress={() => {
                setFailure(null);
                setStep({ name: "forgot" });
              }}
            />
          </View>
        ) : null}

        {step.name === "forgot" ? <ForgotPassword initial={username} onBack={() => setStep({ name: "credentials" })} /> : null}

        {step.name === "hall" ? (
          <View testID="login-halls" style={{ gap: space[3] }}>
            <Txt variant="title">{t("officer_app.login.hall_title")}</Txt>
            <Txt variant="body" tone="muted">{t("officer_app.login.hall_body")}</Txt>
            <View>
              {step.halls.map((hall) => (
                <Row key={hall.code} testID={`hall-${hall.code}`} minHeight={64} strong title={hall.display_name} lines={[{ one: hall.code }]} onPress={busy ? undefined : () => void submit(hall.code)} />
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
              // The six-digit code takes digits only and stops at six; a recovery code is typed as is.
              onChangeText={(v) => setCode(step.recovery ? v : mfaDigits(v))}
              maxLength={step.recovery ? undefined : 6}
              mono
              keyboardType={step.recovery ? "ascii-capable" : "number-pad"}
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
