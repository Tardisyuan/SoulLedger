/**
 * 「忘记密码」 for a soul: the backend's email-code reset, in two steps
 * (第三类 F 组画布:393 宽,卷宗版式,方角,3px 封皮线,整条流程不用衬线).
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
 * no network.
 *
 * WHERE AN ERROR GOES (the canvas's table of seven). About one field — a wrong
 * code, a weak password, two passwords that differ — under that field, text
 * only. About the whole attempt — expired, tries used up, rate-limited,
 * offline — a banner at the top of the form. Every refusal is told apart by its
 * `code`, never by its sentence.
 *
 * NO 「选择要重设的账号」 STEP. The canvas draws one for an address bound to
 * several soul accounts, shown only after the code is verified. It cannot
 * happen: live e-mail addresses are unique (`unique_user_email_among_live_rows`,
 * authentication 0016), and `reset_password_request` only issues a code when
 * exactly one soul account has the address. The backend checks
 * `ambiguous_email` after the code, so it discloses nothing before it; the App
 * says 「ask your hall」 if it ever comes.
 */
import {
  passwordResetAttemptsLeft,
  passwordResetErrorMessage,
  passwordResetRetryAfter,
  soulApi,
  soulErrorMessage,
  soulErrorStatus,
  type SoulErrorMessage,
} from "@soulledger/core/api/soul";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { family } from "../fonts";
import { useI18n } from "../i18n";
import { RESEND_AFTER_SECONDS, RESET_CODE, RESET_CODE_TTL_SECONDS, formatCountdown, isPlausibleEmail } from "../rules";
import { Button, GUTTER, Input, Screen, Txt, useTheme } from "../ui";
import { MIN_PASSWORD_LENGTH } from "./auth";

/**
 * What a failed step-1 request says. `null` means "say what a 200 says": a 400
 * is about the address, and anything about the address is the neutral sentence.
 */
export function resetRequestFailure(error: unknown): SoulErrorMessage | null {
  return soulErrorStatus(error) === 400 ? null : soulErrorMessage(error);
}

/** `s***@example.com`: the first character and the domain, as the canvas shows the address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * The strength bar: four segments. Length ≥ 8, letters and digits both, length
 * ≥ 12, and a character that is neither. A hint, not a rule — the server's
 * validators decide (`err_weak_*` says which rules they are).
 */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  return [
    password.length >= MIN_PASSWORD_LENGTH,
    /[A-Za-z]/.test(password) && /\d/.test(password),
    password.length >= 12,
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
}

/** Epoch ms `seconds` from now: when a `retry_after` runs out. */
const secondsFromNow = (seconds: number) => Date.now() + seconds * 1000;

/** `Date.now()`, once a second — the countdowns read it. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

type Sent = { email: string; at: number };
type Stage = { kind: "email" } | { kind: "noEmail" } | { kind: "code"; sent: Sent };

export function ForgotPasswordScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [stage, setStage] = useState<Stage>({ kind: "email" });
  if (stage.kind === "noEmail") return <NoEmail onBack={onCancel} />;
  if (stage.kind === "code") {
    return <CodeStep sent={stage.sent} onResent={(sent) => setStage({ kind: "code", sent })} onDone={onDone} />;
  }
  return <EmailStep onSent={(sent) => setStage({ kind: "code", sent })} onNoEmail={() => setStage({ kind: "noEmail" })} />;
}

// ── pieces ─────────────────────────────────────────────────────────────

/** kicker (mono 11, .14em) + h1 (28/36, 600), closed by the 3px ink cover rule. */
function Head({ kicker, title }: { kicker: string; title: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.head, { borderBottomColor: theme.ink }]}>
      <Txt tone="subtle" style={styles.kicker}>
        {kicker}
      </Txt>
      <Txt accessibilityRole="header" style={styles.h1}>
        {title}
      </Txt>
    </View>
  );
}

/**
 * An error about the whole attempt, at the top of the form: `! title` in the
 * demerit colour, a sentence, and at most one action (≥ 44, 1px ink frame).
 */
export type Banner = { title: string; body?: string; action?: { label: string; onPress: () => void; testID?: string } };

export function ErrorBanner({ banner, testID }: { banner: Banner; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[styles.banner, { borderColor: theme.neg, backgroundColor: theme.s2, borderLeftColor: theme.neg }]}
    >
      <Txt testID={testID ? `${testID}-title` : undefined} style={[styles.bannerTitle, { color: theme.neg }]}>
        {`! ${banner.title}`}
      </Txt>
      {banner.body ? (
        <Txt testID={testID ? `${testID}-body` : undefined} variant="caption" tone="muted">
          {banner.body}
        </Txt>
      ) : null}
      {banner.action ? (
        <Pressable
          testID={banner.action.testID}
          accessibilityRole="button"
          onPress={banner.action.onPress}
          style={({ pressed }) => [styles.action, { borderColor: theme.ink }, pressed && styles.pressed]}
        >
          <Txt style={styles.actionText}>{banner.action.label}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** An error about one field, under it: text only, indented 2. */
function FieldProblem({ title, body, testID }: { title: string; body?: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} accessibilityRole="alert" style={styles.fieldProblem}>
      <Txt variant="caption" style={{ color: theme.neg }}>{`! ${title}`}</Txt>
      {body ? (
        <Txt variant="caption" style={{ color: theme.neg }}>
          {body}
        </Txt>
      ) : null}
    </View>
  );
}

// ── step 1 ─────────────────────────────────────────────────────────────

/** Sends a code to `email`; resolves to the send, or to a failure that is not about the address. */
async function sendCode(email: string): Promise<Sent | { error: unknown }> {
  try {
    await soulApi.requestPasswordReset(email);
  } catch (e) {
    if (resetRequestFailure(e)) return { error: e };
  }
  return { email, at: Date.now() };
}

/** Rate limit and offline are the only step-1 failures there are to say; both are banners. */
function useAttemptBanner() {
  const { t } = useI18n();
  const now = useClock();
  const [until, setUntil] = useState<number | null>(null);
  const [failure, setFailure] = useState<{ key: string; retry?: () => void } | null>(null);
  const waitLeft = until === null ? 0 : Math.ceil((until - now) / 1000);
  const blocked = waitLeft > 0;

  const take = (error: unknown, retry: () => void): SoulErrorMessage => {
    const message = passwordResetErrorMessage(error);
    const wait = passwordResetRetryAfter(error);
    setUntil(wait === null ? null : secondsFromNow(wait));
    setFailure({ key: message.key, retry });
    return message;
  };
  const clear = () => {
    setFailure(null);
    setUntil(null);
  };

  let banner: Banner | null = null;
  if (failure?.key === "soul_app.errors.rate_limited") {
    banner = {
      title: t("soul_app.forgot_password.err_rate_title"),
      body: blocked
        ? t("soul_app.forgot_password.err_rate_body", { n: String(waitLeft) })
        : t("soul_app.forgot_password.err_rate_later"),
    };
  } else if (failure?.key === "soul_app.errors.network") {
    banner = {
      title: t("soul_app.forgot_password.err_offline_title"),
      body: t("soul_app.forgot_password.err_offline_body"),
      action: failure.retry ? { label: t("soul_app.common.retry"), onPress: failure.retry, testID: "forgot-retry" } : undefined,
    };
  } else if (failure) {
    banner = { title: t(failure.key) };
  }
  return { banner, blocked, take, clear };
}

function EmailStep({ onSent, onNoEmail }: { onSent: (sent: Sent) => void; onNoEmail: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const attempt = useAttemptBanner();

  const submit = async () => {
    const address = email.trim();
    if (!isPlausibleEmail(address)) return setInvalid(true);
    setInvalid(false);
    setBusy(true);
    attempt.clear();
    const outcome = await sendCode(address);
    setBusy(false);
    if ("error" in outcome) attempt.take(outcome.error, submit);
    else onSent(outcome);
  };

  return (
    <Screen>
      <View style={styles.page}>
        <Head kicker={t("soul_app.forgot_password.step1_kicker")} title={t("soul_app.forgot_password.step1_title")} />
        {attempt.banner ? <ErrorBanner testID="forgot-error" banner={attempt.banner} /> : null}
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
          invalid={invalid}
        />
        {invalid ? <FieldProblem title={t("soul_app.forgot_password.email_invalid")} /> : null}
        <Button
          testID="forgot-send"
          title={t(busy ? "soul_app.forgot_password.sending" : "soul_app.forgot_password.send")}
          onPress={submit}
          busy={busy}
          disabled={attempt.blocked}
          style={styles.primary}
        />
        <Pressable testID="forgot-no-email" accessibilityRole="link" onPress={onNoEmail} style={styles.link}>
          <Txt variant="caption" style={[styles.underline, { color: theme.inkMuted }]}>
            {t("soul_app.forgot_password.no_email_link")}
          </Txt>
        </Pressable>
      </View>
    </Screen>
  );
}

// ── 1b · no bound email ────────────────────────────────────────────────

function NoEmail({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const steps = ["soul_app.forgot_password.no_email_step_1", "soul_app.forgot_password.no_email_step_2"];
  return (
    <Screen>
      <View style={styles.page} testID="forgot-no-email-page">
        <Head kicker={t("soul_app.forgot_password.no_email_kicker")} title={t("soul_app.forgot_password.no_email_title")} />
        <Txt>{t("soul_app.forgot_password.no_email_body")}</Txt>
        <View style={[styles.list, { borderTopColor: theme.ink }]}>
          {steps.map((key, i) => (
            <View key={key} style={[styles.listRow, { borderBottomColor: theme.hair }]}>
              <Txt variant="value" tone="subtle" style={styles.listNo}>
                {String(i + 1)}
              </Txt>
              <Txt style={styles.shrink}>{t(key)}</Txt>
            </View>
          ))}
        </View>
        <Txt variant="caption" tone="subtle">
          {t("soul_app.forgot_password.no_email_note")}
        </Txt>
        <Button testID="forgot-back-to-login" kind="secondary" title={t("soul_app.forgot_password.back_to_login")} onPress={onBack} />
      </View>
    </Screen>
  );
}

// ── step 2 ─────────────────────────────────────────────────────────────

type FieldName = "code" | "new" | "confirm";
type Problem = { field: FieldName; title: string; body?: string };

/** Six cells over one hidden input: 52 high, mono 22. The input keeps the testID and the one-time-code autofill. */
function CodeCells({
  value,
  onChange,
  bad,
  editable,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  bad: boolean;
  editable: boolean;
  label: string;
}) {
  const theme = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable accessible={false} onPress={() => input.current?.focus()} style={styles.cells}>
      {Array.from({ length: 6 }, (_, i) => {
        const active = focused && i === Math.min(value.length, 5);
        return (
          <View
            key={i}
            style={[
              styles.cell,
              { backgroundColor: theme.s1, borderColor: bad ? theme.neg : active ? theme.ink : theme.hair },
              bad && { borderBottomWidth: 3 },
              active && !bad && { borderWidth: 2 },
            ]}
          >
            <Txt style={styles.cellText}>{value[i] ?? ""}</Txt>
          </View>
        );
      })}
      <TextInput
        ref={input}
        testID="forgot-code"
        accessibilityLabel={label}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, "").slice(0, 6))}
        editable={editable}
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        caretHidden
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

function StrengthBar({ password }: { password: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  const score = passwordStrength(password);
  const lit = score < 2 ? theme.neg : score < 4 ? theme.inkMuted : theme.pos;
  const level = score < 2 ? "weak" : score < 4 ? "fair" : "strong";
  return (
    <View style={styles.strength}>
      <View style={styles.segments} testID="forgot-strength" accessibilityValue={{ min: 0, max: 4, now: score }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.segment, { backgroundColor: i < score ? lit : theme.hair }]} />
        ))}
      </View>
      {password ? (
        <Txt variant="caption" tone="subtle">
          {t("soul_app.forgot_password.strength", { level: t(`soul_app.forgot_password.strength_${level}`) })}
        </Txt>
      ) : null}
    </View>
  );
}

function CodeStep({ sent, onResent, onDone }: { sent: Sent; onResent: (sent: Sent) => void; onDone: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const now = useClock();
  const [code, setCode] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // An attempt-level refusal that is not rate / offline: expired, used up, or anything unmapped.
  const [refusal, setRefusal] = useState<"expired" | "exhausted" | { key: string } | null>(null);
  const attempt = useAttemptBanner();
  // When a refused resend was told it may try again (`retry_after`), epoch ms.
  const [resendAt, setResendAt] = useState<number | null>(null);

  // Clamped: right after a resend `sent.at` is newer than the last tick.
  const elapsed = Math.max(0, (now - sent.at) / 1000);
  const left = RESET_CODE_TTL_SECONDS - elapsed;
  const resendIn = Math.max(RESEND_AFTER_SECONDS - elapsed, resendAt === null ? 0 : (resendAt - now) / 1000);
  const expired = left <= 0 || refusal === "expired";

  const fieldProblem = (name: FieldName) =>
    problem && problem.field === name ? (
      <FieldProblem testID={`forgot-${name}-error`} title={problem.title} body={problem.body} />
    ) : null;

  const clearAll = () => {
    setProblem(null);
    setRefusal(null);
    attempt.clear();
  };

  const submit = async () => {
    clearAll();
    if (!RESET_CODE.test(code)) return setProblem({ field: "code", title: t("soul_app.forgot_password.code_format") });
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return setProblem({
        field: "new",
        title: t("soul_app.forgot_password.err_weak_title"),
        body: t("soul_app.forgot_password.err_weak_body"),
      });
    }
    if (newPassword !== confirm) return setProblem({ field: "confirm", title: t("soul_app.forgot_password.err_mismatch_title") });
    setBusy(true);
    try {
      await soulApi.setNewPassword({ email: sent.email, code, new_password: newPassword });
    } catch (e) {
      setBusy(false);
      const { key } = passwordResetErrorMessage(e);
      const attemptsLeft = passwordResetAttemptsLeft(e);
      if (key === "soul_app.forgot_password.err_wrong_title" && attemptsLeft !== 0) {
        setProblem({
          field: "code",
          title: t(key),
          body: attemptsLeft === null ? undefined : t("soul_app.forgot_password.err_wrong_left", { n: String(attemptsLeft) }),
        });
      } else if (key === "soul_app.forgot_password.err_wrong_title" || key === "soul_app.forgot_password.err_exhausted_title") {
        // `attempts_left: 0` means the next check is refused whatever it is: say so now.
        setRefusal("exhausted");
      } else if (key === "soul_app.forgot_password.err_expired_title") {
        setRefusal("expired");
      } else if (key === "soul_app.errors.weak_password") {
        setProblem({
          field: "new",
          title: t("soul_app.forgot_password.err_weak_title"),
          body: t("soul_app.forgot_password.err_weak_body"),
        });
      } else if (key === "soul_app.errors.rate_limited" || key === "soul_app.errors.network") {
        attempt.take(e, submit);
      } else {
        setRefusal({ key });
      }
      return;
    }
    onDone();
  };

  const resend = async () => {
    setResending(true);
    clearAll();
    const outcome = await sendCode(sent.email);
    setResending(false);
    if ("error" in outcome) {
      const wait = passwordResetRetryAfter(outcome.error);
      if (wait !== null) setResendAt(secondsFromNow(wait));
      attempt.take(outcome.error, resend);
      return;
    }
    setResendAt(null);
    setCode("");
    onResent(outcome);
  };

  const resendAction = { label: t("soul_app.forgot_password.resend"), onPress: resend, testID: "forgot-banner-resend" };
  let banner: Banner | null = attempt.banner;
  if (!banner && refusal === "exhausted") {
    banner = {
      title: t("soul_app.forgot_password.err_exhausted_title"),
      body: t("soul_app.forgot_password.err_exhausted_body"),
      action: resendIn > 0 ? undefined : resendAction,
    };
  } else if (!banner && expired) {
    banner = {
      title: t("soul_app.forgot_password.err_expired_title"),
      body: t("soul_app.forgot_password.err_expired_body"),
      action: resendIn > 0 ? undefined : resendAction,
    };
  } else if (!banner && refusal && typeof refusal === "object") {
    banner = { title: t(refusal.key) };
  }
  const bannerID = refusal === "exhausted" ? "forgot-exhausted" : !attempt.banner && expired ? "forgot-expired" : "forgot-error";

  const countdown = expired ? null : (
    <Txt testID="forgot-expires-in" variant="value" tone="subtle" style={styles.countdown}>
      {t("soul_app.forgot_password.expires_left", { time: formatCountdown(left) })}
    </Txt>
  );

  return (
    <Screen>
      <View style={styles.page}>
        <Head kicker={t("soul_app.forgot_password.step2_kicker")} title={t("soul_app.forgot_password.step2_title")} />
        {banner ? <ErrorBanner testID={bannerID} banner={banner} /> : null}
        <View
          testID="forgot-sent"
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          style={[styles.status, { borderColor: theme.hair2, backgroundColor: theme.s2, borderLeftColor: theme.ink }]}
        >
          <Txt testID="forgot-sent-title" style={styles.strong}>
            {t("soul_app.forgot_password.sent_neutral")}
          </Txt>
          <Txt variant="caption" tone="muted">
            {t("soul_app.forgot_password.sent_to", { email: maskEmail(sent.email) })}
          </Txt>
        </View>

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Txt variant="label" tone="muted">
              {t("soul_app.forgot_password.code")}
            </Txt>
            {countdown}
          </View>
          <CodeCells
            value={code}
            onChange={setCode}
            bad={problem?.field === "code"}
            editable={!busy}
            label={t("soul_app.forgot_password.code")}
          />
          {fieldProblem("code")}
        </View>

        <View style={styles.field}>
          <Input
            testID="forgot-new-password"
            label={t("soul_app.change_password.new_password")}
            value={newPassword}
            onChangeText={setNew}
            editable={!busy}
            secureTextEntry
            secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
            invalid={problem?.field === "new"}
          />
          <StrengthBar password={newPassword} />
          {fieldProblem("new")}
        </View>

        <View style={styles.field}>
          <Input
            testID="forgot-confirm-password"
            label={t("soul_app.change_password.confirm_password")}
            value={confirm}
            onChangeText={setConfirm}
            editable={!busy}
            secureTextEntry
            invalid={problem?.field === "confirm"}
          />
          {fieldProblem("confirm")}
        </View>

        <Button
          testID="forgot-submit"
          title={t(busy ? "soul_app.change_password.submitting" : "soul_app.forgot_password.submit")}
          onPress={submit}
          busy={busy}
          disabled={attempt.blocked}
          style={styles.primary}
        />
        <Pressable
          testID="forgot-resend"
          accessibilityRole="button"
          accessibilityState={{ disabled: resendIn > 0 || busy || resending, busy: resending }}
          disabled={resendIn > 0 || busy || resending}
          onPress={resend}
          style={styles.link}
        >
          <Txt
            testID={resendIn > 0 ? "forgot-resend-in" : undefined}
            variant="caption"
            style={resendIn > 0 ? { color: theme.inkSubtle } : [styles.underline, { color: theme.inkMuted }]}
          >
            {resendIn > 0
              ? t("soul_app.forgot_password.resend_wait", { n: String(Math.ceil(resendIn)) })
              : t("soul_app.forgot_password.resend")}
          </Txt>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { gap: 18, paddingHorizontal: GUTTER, paddingTop: 22, paddingBottom: 34 },
  head: { gap: 6, paddingBottom: 14, borderBottomWidth: 3 },
  kicker: { fontFamily: family.mono[400], fontSize: 11, lineHeight: 16, letterSpacing: 1.5 },
  h1: { fontFamily: family.ui[600], fontSize: 28, lineHeight: 36 },
  strong: { fontFamily: family.ui[600], fontSize: 14, lineHeight: 20 },
  banner: { gap: 6, borderWidth: 1, borderLeftWidth: 3, paddingVertical: 10, paddingHorizontal: 12 },
  bannerTitle: { fontFamily: family.ui[600], fontSize: 14, lineHeight: 20 },
  action: { alignSelf: "flex-start", minHeight: 44, borderWidth: 1, justifyContent: "center", paddingHorizontal: 14, marginTop: 4 },
  actionText: { fontFamily: family.ui[500], fontSize: 14, lineHeight: 19 },
  pressed: { opacity: 0.8 },
  fieldProblem: { marginLeft: 2, gap: 2 },
  status: { gap: 4, borderWidth: 1, borderLeftWidth: 3, paddingVertical: 10, paddingHorizontal: 12 },
  field: { gap: 7 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  countdown: { fontSize: 12 },
  cells: { flexDirection: "row", gap: 6 },
  cell: { flex: 1, height: 52, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cellText: { fontFamily: family.mono[500], fontSize: 22, lineHeight: 28 },
  hiddenInput: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02, color: "transparent" },
  strength: { gap: 6 },
  segments: { flexDirection: "row", gap: 4 },
  segment: { flex: 1, height: 4 },
  primary: { marginTop: 4 },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  underline: { textDecorationLine: "underline" },
  list: { borderTopWidth: 1 },
  listRow: { flexDirection: "row", gap: 0, paddingVertical: 10, borderBottomWidth: 1 },
  listNo: { width: 28 },
  shrink: { flexShrink: 1 },
});
