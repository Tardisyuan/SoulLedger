import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@soulledger/core/config/locale";
import { soulDeviceLoginFailure, soulErrorMessage, type SoulErrorMessage } from "@soulledger/core/api/soul";
import { formatSoulCode } from "@soulledger/core/domain/soulCode";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { BrandMark } from "../brandMarkView";
import { useToast } from "../feedback";
import { family } from "../fonts";
import { useI18n } from "../i18n";
import { expiryOf, formatStamp } from "../rules";
import { useSession, type MfaChallenge } from "../session";
import { clearCredential, bioEnabled, forgetAccount, isColdStart, readCredential, rememberedAccount, revokeCredential, spendAutoPrompt } from "../deviceLogin";
import { LAPSE_KEYS, canSubmitLogin, lapseOfReason, shouldAutoPrompt, type Lapse } from "../loginRules";
import { forgetDevice } from "../mfa";
import { SoulCodeField, SoulCodeText } from "../soulCodeView";
import { Block, Button, GUTTER, Interp, Input, Notice, Screen, SmallButton, Txt, useLayout, useTheme } from "../ui";
import { useBiometry } from "../useBiometry";
import { SwitchAccountSheet } from "./bio";
import { LoginSecondStep } from "./loginMfa";

/** Refusals are the user's to fix (red); a rate limit or a dead network is not (neutral). */
export const NEUTRAL_ERRORS = new Set(["soul_app.errors.rate_limited", "soul_app.errors.network"]);

export function LanguageSwitch() {
  const t = useTheme();
  const { locale, setLocale } = useI18n();
  // Handoff 2d: at ≥ 1.7× text the three languages become three rows.
  const { stack } = useLayout();
  return (
    <View style={stack ? styles.languagesStacked : styles.languages}>
      {SUPPORTED_LOCALES.map((l) => {
        const on = l === locale;
        return (
          <Pressable
            key={l}
            testID={`locale-${l}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => setLocale(l)}
            style={[styles.language, { borderColor: on ? t.ink : "transparent" }]}
          >
            <Txt variant="label" tone={on ? "ink" : "subtle"} style={styles.languageText}>
              {LOCALE_LABELS[l]}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export type LoginParams = { passwordReset?: boolean; scanned?: string; at?: number } | undefined;

/** 「没有连上」: a refusal the soul did not cause, and the one the typed text survives (第二十批 §四). */
function NetworkNotice({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View testID="login-error" accessibilityRole="alert" style={[styles.network, { borderColor: theme.neg, backgroundColor: theme.s0 }]}>
      <View style={styles.fill}>
        <Txt testID="login-network-title" style={[styles.noticeTitle, { color: theme.negInk }]}>
          {t("soul_app.mfa.login.network")}
        </Txt>
        <Txt testID="login-network-body" variant="caption" tone="muted">
          {t("soul_app.login.network_body")}
        </Txt>
      </View>
      <SmallButton testID="login-retry" title={t("soul_app.common.retry")} onPress={onRetry} />
    </View>
  );
}

/** ◇ + a title and a sentence: the credential on this phone no longer works. Neutral, not an error. */
function LapsedNotice({ lapse, bio }: { lapse: Lapse; bio: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  const keys = LAPSE_KEYS[lapse];
  return (
    <View testID="login-lapsed" accessibilityRole="text" accessibilityLiveRegion="polite" style={[styles.lapsed, { borderColor: theme.inkSubtle, backgroundColor: theme.s0 }]}>
      <Txt accessibilityElementsHidden importantForAccessibility="no">
        ◇
      </Txt>
      <View style={styles.fill}>
        <Txt testID="login-lapsed-title" style={styles.noticeTitle}>
          {t(keys.title, { bio })}
        </Txt>
        <Txt testID="login-lapsed-body" variant="caption" tone="muted">
          {t(keys.body, { bio })}
        </Txt>
      </View>
    </View>
  );
}

export function LoginScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const navigation = useNavigation<NavigationProp<{ Login: LoginParams; ForgotPassword: undefined; ScanCode: undefined }>>();
  // Set by the 「忘记密码」 flow on its way back here. It says the reset worked; it does not sign in.
  const params = useRoute<RouteProp<{ Login: LoginParams }, "Login">>().params;
  const reset = params?.passwordReset === true;
  const { state, signIn, deviceSignIn } = useSession();
  const bio = useBiometry();
  // The account this phone remembers (null: a first visit, or 「换一个账号」), and whether its 面容 / 指纹 is on.
  const [account, setAccount] = useState(rememberedAccount);
  const [bioActive, setBioActive] = useState(bioEnabled);
  const known = account !== null;
  const [soulCode, setSoulCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [lapse, setLapse] = useState<Lapse | null>(null);
  // The password box instead of the 面容 button: 「输入密码」 was tapped, or the system said no.
  const [wantPassword, setWantPassword] = useState(false);
  const [bioFailed, setBioFailed] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Set when the password was right and the account has two-step verification on: the screen shows the second step.
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [error, setError] = useState<SoulErrorMessage | null>(state.status === "signedOut" ? (state.notice ?? null) : null);
  const passwordRef = useRef<TextInput>(null);
  const code = account?.code ?? soulCode;
  const bioScreen = known && bioActive && !wantPassword && !bioFailed;
  // `popTo("Login")` returns to THIS screen, not a fresh one: an earlier failed
  // sign-in's error (which hid the notice) and the old password are still here.
  // Each arrival carries a new params object, so a second reset clears them too.
  // Adjusted during render (react.dev "storing information from previous renders"),
  // not in an effect, so the stale error is never painted over the notice.
  const [arrival, setArrival] = useState(params);
  if (arrival !== params) {
    setArrival(params);
    if (params?.passwordReset) {
      setError(null);
      setPassword("");
    }
    // The scanner went back with a code: it is the number now, and the cursor belongs in the password.
    if (params?.scanned && params.at !== arrival?.at) {
      setSoulCode(params.scanned);
      setScanned(true);
      setError(null);
    }
  }
  useEffect(() => {
    if (scanned) passwordRef.current?.focus();
  }, [scanned, params?.at]);

  /** The phone's credential is no good: forget it and say why; the number stays, the password box takes over. */
  const lapseTo = (why: Lapse, forCode: string) => {
    clearCredential();
    if (why === "reborn") forgetDevice(forCode);
    setBioActive(false);
    setBioFailed(false);
    setWantPassword(false);
    setLapse(why);
    setError(null);
    setBusy(false);
  };

  const enter = async (next: Promise<MfaChallenge | null>) => {
    const challenged = await next;
    if (challenged) {
      setChallenge(challenged);
      setPassword("");
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!canSubmitLogin(code, password, busy)) return;
    setBusy(true);
    setError(null);
    setLapse(null);
    try {
      await enter(signIn(code, password));
    } catch (e) {
      setError(soulErrorMessage(e));
      setBusy(false);
    }
  };

  const signInWithBio = async () => {
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    const read = await readCredential();
    if (read.status === "cancelled") return setBusy(false);
    if (read.status === "invalidated") return lapseTo("bio_changed", account.code);
    if (read.status === "failed") {
      setBusy(false);
      setBioFailed(true);
      return;
    }
    try {
      await enter(deviceSignIn(account.code, read.credential));
    } catch (e) {
      const failure = soulDeviceLoginFailure(e);
      if (failure.code === "revoked") lapseTo(lapseOfReason(failure.reason), account.code);
      else if (failure.code === "invalid") lapseTo("bio_changed", account.code);
      else {
        setError(failure.code === "rate_limited" ? { key: "soul_app.errors.rate_limited" } : soulErrorMessage(e));
        setBusy(false);
      }
    }
  };

  // The first sign-in page of a process opens the system prompt by itself, once (§一.4 C3).
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoDone.current) return;
    autoDone.current = true;
    const cold = isColdStart();
    spendAutoPrompt();
    // On the next tick: the sign-in sets state, and an effect body does not.
    if (account && shouldAutoPrompt({ enabled: bioActive, coldStart: cold, cancelled: false, lapsed: lapse })) void Promise.resolve().then(signInWithBio);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cold start is decided once, when the page first appears
  }, []);

  const switchAccount = async () => {
    setSwitching(false);
    if (bioEnabled()) await revokeCredential();
    forgetAccount();
    setAccount(null);
    setBioActive(false);
    setSoulCode("");
    setPassword("");
    setLapse(null);
    setError(null);
    setBioFailed(false);
    setWantPassword(false);
    setScanned(false);
  };

  if (challenge) {
    return (
      <Screen scroll={false} edges={["top", "left", "right", "bottom"]} testID="login-mfa">
        <LoginSecondStep
          challenge={challenge}
          // A timed-out step goes back to the password with the soul code kept; "another account" clears it too.
          onRestart={() => {
            setChallenge(null);
            setError(null);
          }}
          onChangeAccount={() => {
            setChallenge(null);
            setError(null);
            setSoulCode("");
          }}
        />
      </Screen>
    );
  }

  const network = error?.key === "soul_app.errors.network";
  const canSubmit = canSubmitLogin(code, password, busy);
  const forgot = (
    <Pressable testID="login-forgot" accessibilityRole="link" disabled={busy} onPress={() => navigation.navigate("ForgotPassword")} style={styles.forgot}>
      <Txt variant="label" tone="muted" style={[styles.noSpacing, styles.underline]}>
        {t("soul_app.forgot_password.link")}
      </Txt>
    </Pressable>
  );
  return (
    <Screen edges={["top", "left", "right", "bottom"]}>
      <View style={styles.brand}>
        <BrandMark testID="login-mark" size={66} color={theme.ink} />
        <Txt variant="display" style={styles.appName}>
          {t("soul_app.app_name")}
        </Txt>
        <Txt variant="value" tone="subtle" style={styles.wordmark}>
          SOULLEDGER
        </Txt>
      </View>
      <View style={[styles.login, { borderTopColor: theme.hair }]}>
        <Txt variant="title" accessibilityRole="header">
          {t("soul_app.login.title")}
        </Txt>
        {known ? null : (
          <Txt tone="muted" style={styles.lead}>
            {t("soul_app.login.subtitle")}
          </Txt>
        )}
        {reset && !error ? (
          // 第三类 F 组 屏 3:1px 墨框,左侧 3px 功色;粗体一句,小字一句。
          <View
            testID="login-reset-notice"
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            style={[styles.gapTop, styles.resetNotice, { borderColor: theme.ink, borderLeftColor: theme.pos }]}
          >
            <Txt testID="login-reset-title" style={styles.resetTitle}>
              {t("soul_app.forgot_password.success_title")}
            </Txt>
            <Txt testID="login-reset-body" variant="caption" tone="muted">
              {t("soul_app.forgot_password.success_body")}
            </Txt>
          </View>
        ) : null}
        {network ? (
          <View style={styles.gapTop}>
            <NetworkNotice onRetry={() => void (bioScreen ? signInWithBio() : submit())} />
          </View>
        ) : error ? (
          <View style={styles.gapTop}>
            <Notice tone={NEUTRAL_ERRORS.has(error.key) ? "neutral" : "neg"} testID="login-error">
              {t(error.key, error.params)}
            </Notice>
          </View>
        ) : null}
        {lapse ? (
          <View style={styles.gapTop}>
            <LapsedNotice lapse={lapse} bio={bio.word} />
          </View>
        ) : null}
        {bioFailed ? (
          <Txt testID="login-bio-failed" accessibilityRole="alert" style={[styles.gapTop, styles.noticeTitle]}>
            {t("soul_app.bio.failed", { bio: bio.word })}
          </Txt>
        ) : null}
        <View style={[styles.fields, busy && styles.dimmed]}>
          {account ? (
            <View testID="login-known" style={[styles.card, { borderColor: theme.hair, backgroundColor: theme.s0 }]}>
              <View style={styles.fill}>
                <Txt testID="login-known-name" style={styles.knownName}>
                  {account.name}
                </Txt>
                <SoulCodeText testID="login-known-code" code={account.code} />
              </View>
              <Pressable testID="login-switch" accessibilityRole="button" disabled={busy} onPress={() => setSwitching(true)} style={styles.switch}>
                <Txt variant="bodyLg" style={styles.underline}>
                  {t("soul_app.login.switch")}
                </Txt>
              </Pressable>
            </View>
          ) : (
            <SoulCodeField
              value={soulCode}
              onChange={(next) => {
                setSoulCode(next);
                setScanned(false);
              }}
              onComplete={() => passwordRef.current?.focus()}
              onScan={() => navigation.navigate("ScanCode")}
              editable={!busy}
              scanned={scanned}
            />
          )}
          {bioScreen ? null : (
            <Input
              testID="login-password"
              inputRef={passwordRef}
              label={t("soul_app.login.password")}
              labelAside={known ? undefined : forgot}
              value={password}
              onChangeText={setPassword}
              editable={!busy}
              secureTextEntry
              secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
              autoComplete="current-password"
              textContentType="password"
              autoFocus={known}
              onSubmitEditing={submit}
            />
          )}
        </View>
        {bioScreen ? (
          <Button
            testID="login-bio"
            style={styles.submit}
            title={t(busy ? "soul_app.login.sending" : "soul_app.bio.button", { bio: bio.word })}
            onPress={() => void signInWithBio()}
            busy={busy}
          />
        ) : (
          <Button
            testID="login-submit"
            style={styles.submit}
            title={t(busy ? "soul_app.login.sending" : "soul_app.login.submit")}
            onPress={submit}
            busy={busy}
            disabled={!canSubmit && !busy}
          />
        )}
        {bioFailed ? (
          <Button testID="login-bio-retry" kind="secondary" style={styles.retry} title={t("soul_app.bio.retry", { bio: bio.word })} onPress={() => void signInWithBio()} disabled={busy} />
        ) : null}
        {bioScreen ? (
          <Pressable testID="login-use-password" accessibilityRole="link" disabled={busy} onPress={() => setWantPassword(true)} style={styles.forgot}>
            <Txt variant="bodyLg" style={styles.underline}>
              {t("soul_app.login.use_password")}
            </Txt>
          </Pressable>
        ) : null}
        {known ? <View style={styles.leftLink}>{forgot}</View> : null}
      </View>
      <View style={styles.fill} />
      <View style={[styles.footer, { borderTopColor: theme.hair }]}>
        <LanguageSwitch />
      </View>
      <SwitchAccountSheet
        open={switching}
        id={account ? formatSoulCode(account.code) : ""}
        bio={bio.word}
        onCancel={() => setSwitching(false)}
        onConfirm={() => void switchAccount()}
      />
    </Screen>
  );
}

export const MIN_PASSWORD_LENGTH = 8;

/**
 * The App's own password rules, before anything is sent: the first-login change
 * and the 「忘记密码」 reset both ask this, so the two cannot drift apart. The
 * server's validators still have the last word (`errors.weak_password`).
 */
export function newPasswordProblem(newPassword: string, confirm: string): SoulErrorMessage | null {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { key: "soul_app.change_password.too_short" };
  if (newPassword !== confirm) return { key: "soul_app.change_password.mismatch" };
  return null;
}

type PasswordField = "old" | "new" | "confirm";

/** Which field a failure belongs to; anything else is shown above the button. */
const FIELD_OF: Record<string, PasswordField> = {
  "soul_app.change_password.too_short": "new",
  "soul_app.errors.password_unchanged": "new",
  "soul_app.errors.weak_password": "new",
  "soul_app.change_password.mismatch": "confirm",
  "soul_app.errors.invalid_old_password": "old",
};

/** Re-renders every minute, so "N hours left" and the warning state do not go stale on an open screen. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function ExpiryBox({ expiresAt, now }: { expiresAt: string | null; now: number }) {
  const theme = useTheme();
  const { t } = useI18n();
  const expiry = expiryOf(expiresAt, now);
  if (!expiry) return null;
  const warn = expiry.warning;
  const hours = <Txt variant="value" tone={warn ? "warn" : "subtle"} style={styles.inlineMono}>{String(expiry.hoursLeft)}</Txt>;
  return (
    <View
      testID="expiry-box"
      accessibilityRole={warn ? "alert" : undefined}
      style={[
        styles.expiry,
        warn
          ? { borderColor: theme.warn, backgroundColor: theme.warnBg }
          : { borderColor: theme.inkSubtle, backgroundColor: theme.s1 },
      ]}
    >
      <Txt variant="label" tone={warn ? "warn" : "muted"}>
        {t("soul_app.change_password.expires_label")}
      </Txt>
      <Txt variant="value" tone={warn ? "warn" : "ink"} style={styles.expiryValue}>
        {formatStamp(expiresAt)}
      </Txt>
      <Interp
        testID="expiry-remaining"
        variant="label"
        tone={warn ? "warn" : "subtle"}
        style={styles.noSpacing}
        text={t(
          expiry.expired
            ? "soul_app.change_password.expired_consequence"
            : !warn
              ? "soul_app.change_password.hours_left"
              : expiry.hoursLeft === 0
                ? "soul_app.change_password.under_hour_consequence"
                : "soul_app.change_password.hours_left_consequence"
        )}
        parts={{ hours }}
      />
    </View>
  );
}

export function ChangePasswordScreen() {
  const { t } = useI18n();
  const { state, changePassword, signOut } = useSession();
  const toast = useToast();
  const now = useNow();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);
  const navigation = useNavigation();
  // Signed in = opened from settings by choice: no 72-hour story, no "back to login", and success returns there.
  const voluntary = state.status === "signedIn";
  const expiresAt = state.status === "mustChangePassword" ? state.expiresAt : null;
  const field = error ? FIELD_OF[error.key] : undefined;
  // Someone who changed the initial password long ago is typing their current one (Design 第二十二批).
  const said = (key: string) => (voluntary && key === "soul_app.errors.invalid_old_password" ? "profile.password_old_wrong" : key);
  const fieldError = (name: PasswordField) => (error && field === name ? t(said(error.key), error.params) : null);

  const submit = async () => {
    const problem = newPasswordProblem(newPassword, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await changePassword(oldPassword, newPassword);
      toast(t(voluntary ? "soul_app.change_password.success_others_out" : "soul_app.change_password.success"));
      if (voluntary && navigation.canGoBack()) navigation.goBack();
    } catch (e) {
      setError(soulErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Block last style={styles.stack}>
        {voluntary ? null : <Txt tone="muted">{t("soul_app.change_password.intro")}</Txt>}
        <ExpiryBox expiresAt={expiresAt} now={now} />
        <View style={styles.fields}>
          <Input
            testID="old-password"
            label={t(voluntary ? "soul_app.change_password.current_password" : "soul_app.change_password.old_password")}
            value={oldPassword}
            onChangeText={setOld}
            secureTextEntry
            error={fieldError("old")}
          />
          <Input
            testID="new-password"
            label={t("soul_app.change_password.new_password")}
            hint={t("soul_app.change_password.new_hint")}
            value={newPassword}
            onChangeText={setNew}
            secureTextEntry
            error={fieldError("new")}
          />
          <Input
            testID="confirm-password"
            label={t("soul_app.change_password.confirm_password")}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            error={fieldError("confirm")}
          />
        </View>
        {error && !field ? (
          <Notice tone={NEUTRAL_ERRORS.has(error.key) ? "neutral" : "neg"} testID="change-password-error">
            {t(error.key, error.params)}
          </Notice>
        ) : null}
        <Button
          testID="change-password-submit"
          style={styles.submit}
          title={t(busy ? "soul_app.change_password.submitting" : "soul_app.change_password.submit")}
          onPress={submit}
          busy={busy}
        />
        {voluntary ? null : <Button kind="secondary" title={t("soul_app.change_password.back_to_login")} onPress={signOut} />}
      </Block>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  brand: { alignItems: "center", paddingTop: 48, paddingBottom: 32 },
  appName: { marginTop: 24, letterSpacing: 1.6 },
  wordmark: { marginTop: 8, fontSize: 12, letterSpacing: 2.2 },
  login: { borderTopWidth: 1, marginHorizontal: 24, paddingTop: 24 },
  lead: { marginTop: 8 },
  gapTop: { marginTop: 16 },
  fields: { marginTop: 20, gap: 16 },
  dimmed: { opacity: 0.6 },
  submit: { marginTop: 24 },
  forgot: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  underline: { textDecorationLine: "underline" },
  resetNotice: { gap: 4, borderWidth: 1, borderLeftWidth: 3, paddingVertical: 12, paddingHorizontal: 12 },
  resetTitle: { fontFamily: family.ui[600], fontSize: 15, lineHeight: 20 },
  footer: { borderTopWidth: 1, marginHorizontal: 24, marginTop: 24, paddingTop: 24, paddingBottom: 32 },
  languages: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap" },
  languagesStacked: { flexDirection: "column", alignItems: "stretch" },
  language: { minWidth: 56, minHeight: 44, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  languageText: { fontSize: 12, letterSpacing: 0 },
  stack: { gap: 16, paddingHorizontal: GUTTER + 8 },
  expiry: { borderWidth: 1, borderLeftWidth: 3, paddingVertical: 12, paddingHorizontal: 16, gap: 4 },
  expiryValue: { fontSize: 15, lineHeight: 22, fontFamily: family.mono[500] },
  inlineMono: { fontSize: 11 },
  noSpacing: { letterSpacing: 0 },
  noticeTitle: { fontFamily: family.ui[600], fontSize: 15, lineHeight: 22 },
  network: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16 },
  lapsed: { flexDirection: "row", gap: 8, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16 },
  card: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, paddingVertical: 8, paddingLeft: 16, paddingRight: 4 },
  knownName: { fontFamily: family.ui[600], fontSize: 17, lineHeight: 24 },
  switch: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 12 },
  retry: { marginTop: 12 },
  leftLink: { alignItems: "flex-start" },
});
