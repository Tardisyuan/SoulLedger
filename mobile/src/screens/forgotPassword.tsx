/**
 * 「忘记密码」 for a soul: the backend's email-code reset, in two steps.
 *
 *   1. The contact email on the soul's account → `POST /auth/reset-password/`.
 *   2. The six-digit code + a new password → `POST /auth/set-new-password/`.
 *
 * Then back to sign-in with a notice. Never signed in from here: the reset
 * answers `{detail}` and no tokens, and a soul that has just proved it holds a
 * mailbox signs in with the password it just chose, like everyone else.
 *
 * STEP 1 MUST NOT SAY WHETHER THE ADDRESS HAS AN ACCOUNT. The backend answers
 * 200 for an unknown address; a 400 (an address it will not take) is treated
 * the same, so the two cannot be told apart on this screen either — both show
 * the one conditional sentence and move on to step 2. Only what is not about
 * the address is said as itself: a rate limit (counted before any lookup), or
 * no network. A soul with no bound email therefore learns nothing here, which
 * is why both steps say what such a soul must do instead: ask its hall.
 *
 * Every refusal is told apart by its `code`, never by its sentence; a 429 with
 * `retry_after` holds the resend button at least that long.
 */
import {
  passwordResetErrorMessage,
  passwordResetRetryAfter,
  soulApi,
  soulErrorMessage,
  soulErrorStatus,
  type SoulErrorMessage,
} from "@soulledger/core/api/soul";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { family } from "../fonts";
import { useI18n } from "../i18n";
import { RESEND_AFTER_SECONDS, RESET_CODE, RESET_CODE_TTL_SECONDS, formatCountdown, isPlausibleEmail } from "../rules";
import { Block, Button, GUTTER, Input, Interp, Notice, Screen, Txt, useTheme } from "../ui";
import { NEUTRAL_ERRORS, newPasswordProblem } from "./auth";

/**
 * What a failed step-1 request says. `null` means "say what a 200 says": a 400
 * is about the address, and anything about the address is the neutral sentence.
 * A 429 carries `code: "rate_limited"`, which `soulErrorMessage` already names.
 */
export function resetRequestFailure(error: unknown): SoulErrorMessage | null {
  return soulErrorStatus(error) === 400 ? null : soulErrorMessage(error);
}

/** `Date.now()`, once a second — the two countdowns read it. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

type Sent = { email: string; at: number };
type CodeField = "code" | "new" | "confirm";

/**
 * Where a step-2 failure is shown; anything unlisted goes above the button.
 * Listed, not borrowed from the change-password screen's table: that one also
 * routes to an `old` field this screen does not have, and an error routed to a
 * field that is not rendered is an error nobody sees.
 */
const CODE_FIELD_OF: Record<string, CodeField> = {
  "soul_app.forgot_password.code_format": "code",
  "soul_app.forgot_password.code_wrong": "code",
  "soul_app.change_password.too_short": "new",
  "soul_app.errors.weak_password": "new",
  "soul_app.change_password.mismatch": "confirm",
};

export function ForgotPasswordScreen({ onDone }: { onDone: () => void }) {
  const [sent, setSent] = useState<Sent | null>(null);
  return sent ? (
    <CodeStep sent={sent} onResent={setSent} onChangeEmail={() => setSent(null)} onDone={onDone} />
  ) : (
    <EmailStep onSent={setSent} />
  );
}

/** A step-1 failure that is not about the address, and how long the server said to wait (seconds). */
type SendFailure = { message: SoulErrorMessage; retryAfter: number | null };

/** Sends a code to `email`; resolves to the send, or to a failure that is not about the address. */
async function sendCode(email: string): Promise<Sent | SendFailure> {
  try {
    await soulApi.requestPasswordReset(email);
  } catch (e) {
    const message = resetRequestFailure(e);
    if (message) return { message, retryAfter: passwordResetRetryAfter(e) };
  }
  return { email, at: Date.now() };
}

function EmailStep({ onSent }: { onSent: (sent: Sent) => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);

  const submit = async () => {
    const address = email.trim();
    if (!isPlausibleEmail(address)) return setInvalid(true);
    setInvalid(false);
    setBusy(true);
    setError(null);
    const outcome = await sendCode(address);
    setBusy(false);
    if ("message" in outcome) setError(outcome.message);
    else onSent(outcome);
  };

  return (
    <Screen>
      <Block last style={styles.stack}>
        <Txt tone="muted">{t("soul_app.forgot_password.email_intro")}</Txt>
        <Input
          testID="forgot-email"
          label={t("soul_app.forgot_password.email")}
          value={email}
          onChangeText={setEmail}
          editable={!busy}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          onSubmitEditing={submit}
          error={invalid ? t("soul_app.forgot_password.email_invalid") : null}
        />
        <Txt variant="caption" tone="subtle" testID="forgot-no-email">
          {t("soul_app.forgot_password.no_email")}
        </Txt>
        {error ? (
          <Notice
            tone={NEUTRAL_ERRORS.has(error.key) ? "neutral" : "neg"}
            testID="forgot-error"
            onRetry={error.key === "soul_app.errors.network" ? submit : undefined}
          >
            {t(error.key, error.params)}
          </Notice>
        ) : null}
        <Button
          testID="forgot-send"
          style={styles.submit}
          title={t(busy ? "soul_app.forgot_password.sending" : "soul_app.forgot_password.send")}
          onPress={submit}
          busy={busy}
        />
      </Block>
    </Screen>
  );
}

function CodeStep({
  sent,
  onResent,
  onChangeEmail,
  onDone,
}: {
  sent: Sent;
  onResent: (sent: Sent) => void;
  onChangeEmail: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const now = useClock();
  const [code, setCode] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);
  // When a refused resend was told it may try again (`retry_after`), epoch ms.
  const [resendAt, setResendAt] = useState<number | null>(null);

  // Clamped: right after a resend `sent.at` is newer than the last tick.
  const elapsed = Math.max(0, (now - sent.at) / 1000);
  const left = RESET_CODE_TTL_SECONDS - elapsed;
  // Our own pace, or the server's word when it refused a resend — whichever is later.
  const resendIn = Math.max(RESEND_AFTER_SECONDS - elapsed, resendAt === null ? 0 : (resendAt - now) / 1000);
  const expired = left <= 0;
  const field = error ? CODE_FIELD_OF[error.key] : undefined;
  const fieldError = (name: CodeField) => (error && field === name ? t(error.key, error.params) : null);

  const submit = async () => {
    if (!RESET_CODE.test(code)) return setError({ key: "soul_app.forgot_password.code_format" });
    const problem = newPasswordProblem(newPassword, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await soulApi.setNewPassword({ email: sent.email, code, new_password: newPassword });
    } catch (e) {
      setError(passwordResetErrorMessage(e));
      setBusy(false);
      return;
    }
    onDone();
  };

  const resend = async () => {
    setResending(true);
    setError(null);
    const outcome = await sendCode(sent.email);
    setResending(false);
    if ("message" in outcome) {
      if (outcome.retryAfter !== null) setResendAt(Date.now() + outcome.retryAfter * 1000);
      return setError(outcome.message);
    }
    setResendAt(null);
    setCode("");
    onResent(outcome);
  };

  const time = (
    <Txt variant="value" tone={expired ? "negInk" : "accent"} style={styles.inlineMono}>
      {formatCountdown(left)}
    </Txt>
  );

  return (
    <Screen>
      <Block last style={styles.stack}>
        <Notice tone="neutral" testID="forgot-sent">
          {t("soul_app.forgot_password.sent_neutral")}
        </Notice>
        <Txt variant="caption" tone="subtle" testID="forgot-no-email">
          {t("soul_app.forgot_password.no_email")}
        </Txt>
        <View
          testID="forgot-countdown"
          accessibilityRole={expired ? "alert" : undefined}
          style={[
            styles.countdown,
            expired
              ? { borderColor: theme.negStrong, backgroundColor: theme.negBg }
              : { borderColor: theme.accent, backgroundColor: theme.s1 },
          ]}
        >
          {expired ? (
            <Txt variant="label" tone="negInk" style={styles.noSpacing} testID="forgot-expired">
              {t("soul_app.forgot_password.expired")}
            </Txt>
          ) : (
            <Interp
              testID="forgot-expires-in"
              variant="label"
              tone="muted"
              style={styles.noSpacing}
              text={t("soul_app.forgot_password.expires_in")}
              parts={{ time }}
            />
          )}
        </View>
        <View style={styles.fields}>
          <Input
            testID="forgot-code"
            label={t("soul_app.forgot_password.code")}
            hint={t("soul_app.forgot_password.code_hint")}
            value={code}
            onChangeText={setCode}
            editable={!busy}
            mono
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            error={fieldError("code")}
          />
          <Input
            testID="forgot-new-password"
            label={t("soul_app.change_password.new_password")}
            hint={t("soul_app.change_password.new_hint")}
            value={newPassword}
            onChangeText={setNew}
            editable={!busy}
            secureTextEntry
            error={fieldError("new")}
          />
          <Input
            testID="forgot-confirm-password"
            label={t("soul_app.change_password.confirm_password")}
            value={confirm}
            onChangeText={setConfirm}
            editable={!busy}
            secureTextEntry
            error={fieldError("confirm")}
          />
        </View>
        {error && !field ? (
          <Notice
            tone={NEUTRAL_ERRORS.has(error.key) ? "neutral" : "neg"}
            testID="forgot-error"
            onRetry={error.key === "soul_app.errors.network" ? submit : undefined}
          >
            {t(error.key, error.params)}
          </Notice>
        ) : null}
        <Button
          testID="forgot-submit"
          style={styles.submit}
          title={t(busy ? "soul_app.change_password.submitting" : "soul_app.forgot_password.submit")}
          onPress={submit}
          busy={busy}
        />
        <Button
          testID="forgot-resend"
          kind="secondary"
          title={t("soul_app.forgot_password.resend")}
          onPress={resend}
          busy={resending}
          disabled={resendIn > 0 || busy}
          reason={
            resendIn > 0
              ? t("soul_app.forgot_password.resend_in", { time: formatCountdown(resendIn) })
              : undefined
          }
          reasonTestID="forgot-resend-in"
        />
        <Button
          testID="forgot-change-email"
          kind="secondary"
          title={t("soul_app.forgot_password.change_email")}
          onPress={onChangeEmail}
          disabled={busy || resending}
        />
      </Block>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 18, paddingHorizontal: GUTTER + 8 },
  fields: { gap: 16 },
  submit: { marginTop: 6 },
  countdown: { borderWidth: 1, borderLeftWidth: 3, paddingVertical: 12, paddingHorizontal: 14 },
  inlineMono: { fontSize: 13, fontFamily: family.mono[500] },
  noSpacing: { letterSpacing: 0 },
});
