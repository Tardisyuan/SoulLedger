/**
 * Sign-in, second step (设计 第十八批 C1–C5, D1–D3): the same screen with other contents. The password was
 * right and the account has two-step verification on, so there is a pending credential and no token yet.
 *
 *   输入中   the six digits go to the server the moment the sixth is typed -- once per value (`sent`), so a
 *            re-render or a keyboard "done" cannot send them twice; the button is the other way in.
 *   发请求中 the box greys, the button says 「验证中…」 and cannot be pressed.
 *   数字不对 the card says how many tries are left; the digits stay (edit one to try again).
 *   超时     the pending credential (five minutes) is gone: the button becomes 「重新输入密码」, and the two
 *            things that no longer make sense -- 「30 天内不再询问」 and 「手机和恢复码都没有了」 -- are not shown.
 *   锁定     the card says what time it can be tried again (the server's clock, shown in the device's); the box
 *            and the button are off until then.
 *   网络失败 the digits are kept and the card says so.
 *
 * The pending credential, the digits and the recovery code live in this component's state only.
 */
import { soulMfaFailure } from "@soulledger/core/api/soul";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { BrandMark } from "../brandMarkView";
import { Icon } from "../emblems";
import { AppHeader } from "../chrome";
import { family } from "../fonts";
import { useI18n } from "../i18n";
import { recoveryOf, stateOfFailure, type StepState } from "../mfa";
import { useSession, type MfaChallenge } from "../session";
import { Button, Input, Screen, Txt, useTheme } from "../ui";
import { CheckRow, CoverRule, DigitField, Heading, StepNotice, TextLink } from "./mfaParts";

/** The hall's name in the interface language, as the profile does: the language's own entry, else the display name. */
export function hallNameOf(hall: MfaChallenge["hall"], locale: string): string {
  return hall.hallNames[locale] || hall.hallNames["zh-Hans"] || hall.displayName;
}

export type LoginMfaParams = { MfaLost: { soulCode: string; hall: string } };

export function LoginSecondStep({
  challenge,
  onRestart,
  onChangeAccount,
}: {
  challenge: MfaChallenge;
  /** Back to the password, the soul code kept. */
  onRestart: () => void;
  /** Back to the password, as another account. */
  onChangeAccount: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { verifyMfa } = useSession();
  const navigation = useNavigation<NavigationProp<LoginMfaParams>>();
  const [mode, setMode] = useState<"code" | "recovery">("code");
  const [digits, setDigits] = useState("");
  const [recovery, setRecovery] = useState("");
  const [remember, setRemember] = useState(false);
  const [state, setState] = useState<StepState>({ kind: "idle" });
  const sent = useRef<string | null>(null);
  const inFlight = useRef(false);

  const busy = state.kind === "busy";
  const expired = state.kind === "expired";
  const locked = state.kind === "locked";

  // A lock ends by itself: the box and the button come back at the time the card named.
  useEffect(() => {
    if (state.kind !== "locked" || !state.until) return;
    // An end already past (the clocks differ a little) clears on the next tick, not inside the effect body.
    const wait = Math.max(0, new Date(state.until).getTime() - Date.now());
    const timer = setTimeout(() => setState({ kind: "idle" }), wait);
    return () => clearTimeout(timer);
  }, [state]);

  const run = async (proof: { code: string } | { recoveryCode: string }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "busy" });
    try {
      await verifyMfa(challenge, proof, remember);
      // Signed in: the navigator swaps this screen for the app; nothing more to do (and nothing to clear --
      // the component goes with its state).
    } catch (e) {
      const next = stateOfFailure(soulMfaFailure(e));
      setState(next);
      if (next.kind === "locked" || next.kind === "expired") setDigits("");
    } finally {
      inFlight.current = false;
    }
  };

  const changeDigits = (next: string) => {
    setDigits(next);
    if (next.length < 6) {
      sent.current = null;
      if (state.kind === "wrong" || state.kind === "network" || state.kind === "other") setState({ kind: "idle" });
      return;
    }
    if (next !== sent.current && !busy && !locked && !expired) {
      sent.current = next;
      void run({ code: next });
    }
  };

  const switchTo = (next: "code" | "recovery") => {
    setMode(next);
    // A card about the other kind of proof means nothing here; a lock and a timeout belong to the account and stay.
    if (state.kind === "wrong" || state.kind === "network" || state.kind === "other") setState({ kind: "idle" });
  };

  const pressVerify = () => {
    if (expired) return onRestart();
    if (mode === "code") {
      if (digits.length !== 6) return;
      sent.current = digits;
      void run({ code: digits });
    } else if (recovery.trim().length >= 8) {
      void run({ recoveryCode: recovery.trim() });
    }
  };

  const ready = mode === "code" ? digits.length === 6 : recovery.trim().length >= 8;
  const buttonDisabled = !expired && (busy || locked || !ready);
  const label = busy ? t("soul_app.mfa.login.sending") : expired ? t("soul_app.mfa.login.expired_button") : t("officer_app.mfa.submit");
  const hall = hallNameOf(challenge.hall, locale);

  return (
    <View testID="login-second-step" style={styles.fill}>
      <CoverRule />
      <View style={styles.bar}>
        <Pressable
          testID="mfa-change-account"
          accessibilityRole="button"
          accessibilityLabel={t("soul_app.change_password.back_to_login")}
          onPress={onChangeAccount}
          style={styles.backHit}
        >
          <Icon name="back" size={18} color={theme.ink} strokeWidth={1.4} />
        </Pressable>
        <BrandMark size={24} color={theme.ink} />
        <Txt style={styles.brand}>{t("soul_app.app_name")}</Txt>
      </View>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
      <ScrollView style={{ backgroundColor: theme.s1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.titleBlock}>
          <Heading size={28}>{t(mode === "code" ? "officer_app.mfa.title" : "soul_app.mfa.login.recovery_title")}</Heading>
          <Txt variant="bodyLg" tone="muted">
            {`${t("soul_app.login.soul_code")} `}
            <Txt style={styles.mono}>{challenge.soulCode}</Txt>
          </Txt>
        </View>

        <StepNotice state={state} />

        {mode === "code" ? (
          <DigitField
            testID="login-code"
            label={t("soul_app.mfa.login.code_label")}
            hint={t("soul_app.mfa.login.auto_submit")}
            value={digits}
            onChange={changeDigits}
            locked={busy || locked || expired}
            invalid={state.kind === "wrong"}
          />
        ) : (
          <Input
            testID="login-recovery"
            label={t("officer_app.mfa.recovery_label")}
            hint={t("soul_app.mfa.login.recovery_hint")}
            value={recovery}
            onChangeText={(next) => {
              setRecovery(recoveryOf(next));
              if (state.kind === "wrong" || state.kind === "network" || state.kind === "other") setState({ kind: "idle" });
            }}
            editable={!busy && !locked}
            mono
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="ascii-capable"
            style={styles.recovery}
          />
        )}

        {expired ? null : (
          <CheckRow testID="login-remember" on={remember} onToggle={() => setRemember((v) => !v)}>
            {t("soul_app.mfa.login.remember")}
          </CheckRow>
        )}

        <Button testID="login-verify" title={label} onPress={pressVerify} disabled={buttonDisabled} />

        <View>
          {mode === "code" ? (
            <TextLink testID="use-recovery" title={t("soul_app.mfa.login.use_recovery")} onPress={() => switchTo("recovery")} disabled={busy} />
          ) : (
            <TextLink testID="use-code" title={t("soul_app.mfa.login.use_code")} onPress={() => switchTo("code")} disabled={busy} />
          )}
          {expired ? null : (
            <TextLink
              testID="lost-phone"
              title={t("soul_app.mfa.login.lost")}
              onPress={() => navigation.navigate("MfaLost", { soulCode: challenge.soulCode, hall })}
              disabled={busy}
            />
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** 手机和恢复码都没有了: who to ask, and what to say. No button to write: a soul that cannot sign in cannot write. */
export function MfaLostScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const navigation = useNavigation();
  const { soulCode, hall } = useRoute<RouteProp<LoginMfaParams, "MfaLost">>().params;
  return (
    <Screen scroll={false} testID="mfa-lost">
      <AppHeader title={tr("soul_app.mfa.login.lost")} onBack={() => navigation.goBack()} />
      <ScrollView style={{ backgroundColor: t.s1 }} contentContainerStyle={styles.lost}>
        <Heading>{tr("soul_app.mfa.lost.title")}</Heading>
        <Txt variant="bodyLg">{tr("soul_app.mfa.lost.body")}</Txt>
        <View testID="lost-card" style={[styles.card, { borderColor: t.inkSubtle, backgroundColor: t.s0 }]}>
          <View style={styles.cardRow}>
            <Txt variant="bodyLg" tone="muted" style={styles.cardKey}>
              {tr("soul_app.mfa.lost.hall")}
            </Txt>
            <Txt testID="lost-hall" variant="bodyLg" style={styles.fill}>
              {hall}
            </Txt>
          </View>
          <View style={styles.cardRow}>
            <Txt variant="bodyLg" tone="muted" style={styles.cardKey}>
              {tr("soul_app.mfa.lost.bring")}
            </Txt>
            <Txt variant="bodyLg" style={styles.fill}>
              {`${tr("soul_app.login.soul_code")} `}
              <Txt testID="lost-code" style={styles.mono}>
                {soulCode}
              </Txt>
            </Txt>
          </View>
        </View>
        {(["lost.same_as_password", "lost.no_email"] as const).map((key) => (
          <View key={key} style={styles.note}>
            <Txt style={styles.diamond} accessibilityElementsHidden importantForAccessibility="no">
              ◇
            </Txt>
            <Txt variant="body" tone="muted" style={styles.fill}>
              {tr(`soul_app.mfa.${key}`)}
            </Txt>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  mono: { fontFamily: family.mono[400] },
  bar: { height: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 4, paddingRight: 16 },
  backHit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  brand: { fontFamily: family.ui[600], fontSize: 17, lineHeight: 24 },
  body: { paddingVertical: 32, paddingHorizontal: 24, gap: 20, flexGrow: 1 },
  titleBlock: { gap: 4 },
  recovery: { fontSize: 22, letterSpacing: 2 },
  lost: { padding: 16, paddingTop: 24, gap: 20 },
  card: { borderWidth: 1, padding: 16, gap: 8 },
  cardRow: { flexDirection: "row", gap: 16 },
  cardKey: { minWidth: 40 },
  note: { flexDirection: "row", gap: 12, alignItems: "baseline" },
  diamond: { width: 16 },
});
