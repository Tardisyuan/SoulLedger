import { soulErrorMessage, type SoulErrorMessage } from "@soulledger/core/api/soul";
import { useState } from "react";

import { formatDateTime, useI18n } from "../i18n";
import { useSession } from "../session";
import { Body, Button, Card, ErrorText, Heading, Input, Screen } from "../ui";

export function LoginScreen() {
  const { t } = useI18n();
  const { state, signIn } = useSession();
  const [soulCode, setSoulCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(state.status === "signedOut" ? (state.notice ?? null) : null);

  const submit = async () => {
    if (!soulCode.trim() || !password) {
      setError({ key: "soul_app.login.required" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(soulCode.trim(), password);
    } catch (e) {
      setError(soulErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Heading>{t("soul_app.login.title")}</Heading>
        <Body muted>{t("soul_app.login.subtitle")}</Body>
        <Input
          testID="login-soul-code"
          label={t("soul_app.login.soul_code")}
          value={soulCode}
          onChangeText={setSoulCode}
          autoCapitalize="characters"
        />
        <Input
          testID="login-password"
          label={t("soul_app.login.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          onSubmitEditing={submit}
        />
        <ErrorText testID="login-error" error={error} />
        <Button
          testID="login-submit"
          title={t(busy ? "soul_app.login.submitting" : "soul_app.login.submit")}
          onPress={submit}
          disabled={busy}
        />
      </Card>
    </Screen>
  );
}

export const MIN_PASSWORD_LENGTH = 8;

export function ChangePasswordScreen() {
  const { t, locale } = useI18n();
  const { state, changePassword, signOut } = useSession();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);
  const expiresAt = state.status === "mustChangePassword" ? formatDateTime(state.expiresAt, locale) : null;

  const submit = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setError({ key: "soul_app.change_password.too_short" });
    if (newPassword !== confirm) return setError({ key: "soul_app.change_password.mismatch" });
    setBusy(true);
    setError(null);
    try {
      await changePassword(oldPassword, newPassword);
    } catch (e) {
      setError(soulErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Heading>{t("soul_app.change_password.title")}</Heading>
        <Body muted>{t("soul_app.change_password.intro")}</Body>
        {expiresAt ? <Body muted>{t("soul_app.change_password.expires_at", { date: expiresAt })}</Body> : null}
        <Input
          testID="old-password"
          label={t("soul_app.change_password.old_password")}
          value={oldPassword}
          onChangeText={setOld}
          secureTextEntry
        />
        <Input
          testID="new-password"
          label={t("soul_app.change_password.new_password")}
          value={newPassword}
          onChangeText={setNew}
          secureTextEntry
        />
        <Input
          testID="confirm-password"
          label={t("soul_app.change_password.confirm_password")}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
        />
        <ErrorText testID="change-password-error" error={error} />
        <Button
          testID="change-password-submit"
          title={t(busy ? "soul_app.change_password.submitting" : "soul_app.change_password.submit")}
          onPress={submit}
          disabled={busy}
        />
        <Button kind="secondary" title={t("soul_app.change_password.back_to_login")} onPress={signOut} />
      </Card>
    </Screen>
  );
}
