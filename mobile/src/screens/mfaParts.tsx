/**
 * The small parts the 两步验证 screens share (设计 第十八批 `SoulMfaApp`): the 3px cover line, a checkbox row,
 * an underlined text link, the six-digit box, the state card of a failed step, and the confirmation sheet.
 * Colours are the App's theme slots (`plaqueFill` is the web's `--color-main`); nothing is a bare colour.
 */
import { type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { family } from "../fonts";
import { useI18n } from "../i18n";
import { clockOf, digitsOf, type StepState } from "../mfa";
import { Interp, Input, Txt, useReducedMotion, useTheme } from "../ui";

/** 3px, in the civilization's main colour: the top of every screen in this flow. */
export function CoverRule() {
  const t = useTheme();
  return <View testID="cover-rule" style={[styles.rule, { backgroundColor: t.plaqueFill }]} />;
}

export function Heading({ children, size = 24 }: { children: ReactNode; size?: 24 | 28 }) {
  return (
    <Txt accessibilityRole="header" style={size === 28 ? styles.h28 : styles.h24}>
      {children}
    </Txt>
  );
}

export function CheckRow({ testID, on, onToggle, children }: { testID?: string; on: boolean; onToggle: () => void; children: ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onToggle}
      style={styles.checkRow}
    >
      <View style={[styles.box, { borderColor: t.ink }, on && { backgroundColor: t.ink }]}>
        {on ? (
          <Txt style={[styles.tick, { color: t.s1 }]} accessibilityElementsHidden importantForAccessibility="no">
            ✓
          </Txt>
        ) : null}
      </View>
      <Txt variant="bodyLg" style={styles.fill}>
        {children}
      </Txt>
    </Pressable>
  );
}

/** An underlined line of text that is a button: 44 high, left-aligned. */
export function TextLink({ testID, title, onPress, disabled }: { testID?: string; title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="link" disabled={disabled} onPress={onPress} style={styles.link}>
      <Txt variant="bodyLg" style={styles.underline}>
        {title}
      </Txt>
    </Pressable>
  );
}

/**
 * The six digits: numeric keyboard, a one-time-code hint so the keyboard can offer the code from a
 * message, mono 28 with wide tracking. `locked` greys it (busy, locked, timed out); the digits typed stay in it.
 */
export function DigitField({
  testID,
  label,
  hint,
  value,
  onChange,
  locked,
  invalid,
}: {
  testID: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (digits: string) => void;
  locked?: boolean;
  invalid?: boolean;
}) {
  return (
    <Input
      testID={testID}
      label={label}
      hint={hint}
      value={value}
      onChangeText={(text) => onChange(digitsOf(text))}
      editable={!locked}
      invalid={invalid}
      mono
      keyboardType="number-pad"
      inputMode="numeric"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      maxLength={6}
      style={styles.digits}
    />
  );
}

/**
 * One boxed message of a failed (or waiting) step. `neg` is the danger border, `warn` the warning one; both on the
 * canvas, the title in the status colour (negInk / warn) and the body muted -- never colour alone: the strings
 * carry their own `!` / `◐`.
 */
export function StateCard({ testID, tone, title, children }: { testID?: string; tone: "neg" | "warn"; title: string; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[styles.card, { borderColor: tone === "neg" ? t.negStrong : t.warn, backgroundColor: t.s0 }]}
    >
      <Txt variant="bodyLg" style={[styles.cardTitle, { color: tone === "neg" ? t.negInk : t.warn }]}>
        {title}
      </Txt>
      {children ? (
        <Txt variant="bodyLg" tone="muted">
          {children}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * What a non-idle step says, in the Design's words. `password` is the disable sheet's password mode;
 * `recovery` is the sign-in step in recovery-code mode, where "the digits are wrong" would point at the
 * authenticator (seen on the simulator, 2026-10-12) -- it says the recovery code is wrong or used.
 */
export function StepNotice({ state, password, recovery }: { state: StepState; password?: boolean; recovery?: boolean }) {
  const { t } = useI18n();
  const theme = useTheme();
  switch (state.kind) {
    case "wrong":
      return (
        <StateCard testID="step-wrong" tone="neg" title={password ? t("soul_app.mfa.wrong_password") : recovery ? `! ${t("mfa.verify.error_recovery_wrong")}` : t("soul_app.mfa.login.wrong")}>
          {state.left !== null ? t("soul_app.mfa.login.tries_left", { n: String(state.left) }) : null}
        </StateCard>
      );
    case "expired":
      return (
        <StateCard testID="step-expired" tone="neg" title={t("soul_app.mfa.login.expired")}>
          {t("soul_app.mfa.login.expired_body")}
        </StateCard>
      );
    case "locked": {
      const time = clockOf(state.until);
      return (
        <StateCard testID="step-locked" tone="warn" title={t("soul_app.mfa.login.locked")}>
          {time ? (
            <Interp
              variant="bodyLg"
              tone="muted"
              text={t("soul_app.mfa.login.locked_until")}
              parts={{ time: <Txt style={{ fontFamily: family.mono[400], color: theme.inkMuted }}>{time}</Txt> }}
            />
          ) : null}
        </StateCard>
      );
    }
    case "network":
      return (
        <StateCard testID="step-network" tone="neg" title={t("soul_app.mfa.login.network")}>
          {t("soul_app.mfa.login.network_body")}
        </StateCard>
      );
    case "rate_limited":
      return (
        <StateCard testID="step-rate-limited" tone="warn" title={t("soul_app.errors.rate_limited")} />
      );
    case "other":
      return <StateCard testID="step-other" tone="neg" title={t("soul_app.errors.unknown", { code: "2fa" })} />;
    default:
      return null;
  }
}

/**
 * A confirmation sheet from the bottom: a 3px line in the main colour on its top edge, a dimmed screen behind.
 * A modal of its own rather than the library bottom sheet: this one holds a text field, and the keyboard has to
 * lift it (`KeyboardAvoidingView`); the library sheet needs its own input component for that. Closes on the
 * scrim and on Android's back key.
 */
export function MfaSheet({
  testID,
  open,
  onClose,
  closeLabel,
  children,
}: {
  testID: string;
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Modal visible={open} transparent animationType={reduced ? "none" : "fade"} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <View style={[styles.fill, { backgroundColor: t.scrim }]}>
          <Pressable style={styles.fill} accessibilityRole="button" onPress={onClose} accessibilityLabel={closeLabel} />
          <View
            testID={testID}
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: t.s1, borderTopColor: t.plaqueFill, paddingBottom: 32 + insets.bottom }]}
          >
            {children}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Two buttons side by side, equal width: cancel on the left, the action on the right. */
export function ButtonPair({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.pair, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  rule: { height: 3 },
  h24: { fontFamily: family.ui[600], fontSize: 24, lineHeight: 32 },
  h28: { fontFamily: family.ui[600], fontSize: 28, lineHeight: 36 },
  checkRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12 },
  box: { width: 20, height: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tick: { fontFamily: family.ui[600], fontSize: 14, lineHeight: 16 },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  underline: { textDecorationLine: "underline" },
  digits: { fontSize: 28, letterSpacing: 14, minHeight: 54 },
  card: { borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16, gap: 2 },
  cardTitle: { fontFamily: family.ui[600] },
  sheet: { borderTopWidth: 3, paddingTop: 24, paddingHorizontal: 16, gap: 16 },
  pair: { flexDirection: "row", gap: 8 },
});
