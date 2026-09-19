import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@soulledger/core/config/locale";
import { soulErrorMessage, type SoulErrorMessage } from "@soulledger/core/api/soul";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Emblem } from "../emblems";
import { useToast } from "../feedback";
import { family } from "../fonts";
import { useI18n } from "../i18n";
import { expiryOf, formatStamp } from "../rules";
import { useSession } from "../session";
import { Block, Button, GUTTER, Interp, Input, Notice, Screen, Txt, useLayout, useTheme } from "../ui";

/** Refusals are the user's to fix (red); a rate limit or a dead network is not (neutral). */
const NEUTRAL_ERRORS = new Set(["soul_app.errors.rate_limited", "soul_app.errors.network"]);

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
            style={[styles.language, { borderColor: on ? t.accent : "transparent" }]}
          >
            <Txt variant="label" tone={on ? "accent" : "subtle"} style={styles.languageText}>
              {LOCALE_LABELS[l]}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LoginScreen() {
  const theme = useTheme();
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
    <Screen edges={["top", "left", "right", "bottom"]}>
      <View style={styles.brand}>
        <Emblem civ="neutral" size={66} stroke={theme.inkSubtle} />
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
        <Txt tone="muted" style={styles.lead}>
          {t(busy ? "soul_app.login.verifying" : "soul_app.login.subtitle")}
        </Txt>
        {error ? (
          <View style={styles.gapTop}>
            <Notice
              tone={NEUTRAL_ERRORS.has(error.key) ? "neutral" : "neg"}
              testID="login-error"
              onRetry={error.key === "soul_app.errors.network" ? submit : undefined}
            >
              {t(error.key, error.params)}
            </Notice>
          </View>
        ) : null}
        <View style={[styles.fields, busy && styles.dimmed]}>
          <Input
            testID="login-soul-code"
            label={t("soul_app.login.soul_code")}
            hint={t("soul_app.login.soul_code_hint")}
            value={soulCode}
            onChangeText={setSoulCode}
            editable={!busy}
            mono
            autoCapitalize="characters"
            // Soul codes are ASCII. With a Chinese (pinyin) keyboard active, letters
            // otherwise go into an uncommitted composition that is dropped when focus
            // moves to the password field (seen on the iPhone run).
            keyboardType="ascii-capable"
          />
          <Input
            testID="login-password"
            label={t("soul_app.login.password")}
            value={password}
            onChangeText={setPassword}
            editable={!busy}
            secureTextEntry
            secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
            onSubmitEditing={submit}
          />
        </View>
        <Button
          testID="login-submit"
          style={styles.submit}
          title={t(busy ? "soul_app.login.submitting" : "soul_app.login.submit")}
          onPress={submit}
          busy={busy}
        />
      </View>
      <View style={styles.fill} />
      <View style={[styles.footer, { borderTopColor: theme.hair }]}>
        <LanguageSwitch />
      </View>
    </Screen>
  );
}

export const MIN_PASSWORD_LENGTH = 8;

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
  const hours = <Txt variant="value" tone={warn ? "negInk" : "subtle"} style={styles.inlineMono}>{String(expiry.hoursLeft)}</Txt>;
  return (
    <View
      testID="expiry-box"
      accessibilityRole={warn ? "alert" : undefined}
      style={[
        styles.expiry,
        warn
          ? { borderColor: theme.negStrong, backgroundColor: theme.negBg }
          : { borderColor: theme.accent, backgroundColor: theme.s1 },
      ]}
    >
      <Txt variant="label" tone={warn ? "negInk" : "muted"}>
        {t("soul_app.change_password.expires_label")}
      </Txt>
      <Txt variant="value" tone={warn ? "negInk" : "accent"} style={styles.expiryValue}>
        {formatStamp(expiresAt)}
      </Txt>
      <Interp
        testID="expiry-remaining"
        variant="label"
        tone={warn ? "negInk" : "subtle"}
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
  const expiresAt = state.status === "mustChangePassword" ? state.expiresAt : null;
  const field = error ? FIELD_OF[error.key] : undefined;
  const fieldError = (name: PasswordField) => (error && field === name ? t(error.key, error.params) : null);

  const submit = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setError({ key: "soul_app.change_password.too_short" });
    if (newPassword !== confirm) return setError({ key: "soul_app.change_password.mismatch" });
    setBusy(true);
    setError(null);
    try {
      await changePassword(oldPassword, newPassword);
      toast(t("soul_app.change_password.success"));
    } catch (e) {
      setError(soulErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Block last style={styles.stack}>
        <Txt tone="muted">{t("soul_app.change_password.intro")}</Txt>
        <ExpiryBox expiresAt={expiresAt} now={now} />
        <View style={styles.fields}>
          <Input
            testID="old-password"
            label={t("soul_app.change_password.old_password")}
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
        <Button kind="secondary" title={t("soul_app.change_password.back_to_login")} onPress={signOut} />
      </Block>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  brand: { alignItems: "center", paddingTop: 44, paddingBottom: 36 },
  appName: { marginTop: 22, letterSpacing: 1.6 },
  wordmark: { marginTop: 8, fontSize: 12, letterSpacing: 2.2 },
  login: { borderTopWidth: 1, marginHorizontal: 28, paddingTop: 28 },
  lead: { marginTop: 7 },
  gapTop: { marginTop: 18 },
  fields: { marginTop: 20, gap: 16 },
  dimmed: { opacity: 0.6 },
  submit: { marginTop: 24 },
  footer: { borderTopWidth: 1, marginHorizontal: 28, marginTop: 28, paddingTop: 26, paddingBottom: 30 },
  languages: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap" },
  languagesStacked: { flexDirection: "column", alignItems: "stretch" },
  language: { minWidth: 56, minHeight: 44, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  languageText: { fontSize: 12.5, letterSpacing: 0 },
  stack: { gap: 18, paddingHorizontal: GUTTER + 8 },
  expiry: { borderWidth: 1, borderLeftWidth: 3, paddingVertical: 12, paddingHorizontal: 14, gap: 5 },
  expiryValue: { fontSize: 16, lineHeight: 22, fontFamily: family.mono[500] },
  inlineMono: { fontSize: 11.5 },
  noSpacing: { letterSpacing: 0 },
});
