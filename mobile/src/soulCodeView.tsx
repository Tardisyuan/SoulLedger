/**
 * The soul code on screen (第二十批 §二): 3-4-3, groups apart by space and never by a character, read out one
 * character at a time with a pause between groups. What is copied or sent is still the ten characters.
 *
 *   SoulCodeText   a code inside a sentence or a row (one space between groups, aria spelled out)
 *   SoulCodeField  the sign-in box: a hidden TextInput holds the raw characters, the groups are drawn over it
 */
import { SOUL_CODE_LENGTH, formatSoulCode, groupSoulCode, spellSoulCode } from "@soulledger/core/domain/soulCode";
import { useState, type Ref } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { family } from "./fonts";
import { useI18n } from "./i18n";
import { SOUL_CODE_PROBLEM_KEY, soulCodeStep } from "./loginRules";
import { FocusRing, Txt, useTheme } from "./ui";
import type { SoulCodeProblem } from "@soulledger/core/domain/soulCode";

export function useSpelled() {
  const { t } = useI18n();
  return (code: string) => t("soul_app.login.id_aria", { spelled: spellSoulCode(code) });
}

/** A code in running text, mono, `QU3 3Q9F W5F`. The label replaces the characters for a screen reader. */
export function SoulCodeText({ code, testID, tone = "muted", variant = "value", style }: { code: string; testID?: string; tone?: "ink" | "muted" | "subtle"; variant?: "value" | "valueLg" | "bodyLg"; style?: Parameters<typeof Txt>[0]["style"] }) {
  const spelled = useSpelled();
  return (
    <Txt testID={testID} variant={variant} tone={tone} accessibilityLabel={spelled(code)} style={[styles.groups, style]}>
      {formatSoulCode(code)}
    </Txt>
  );
}

function ScanGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.5}>
      <Path d="M2.75 7V2.75H7M13 2.75h4.25V7M17.25 13v4.25H13M7 17.25H2.75V13M5.5 10h9" />
    </Svg>
  );
}

export function SoulCodeField({
  value,
  onChange,
  onComplete,
  onScan,
  editable,
  scanned,
  inputRef,
}: {
  value: string;
  onChange: (code: string) => void;
  /** The tenth character just went in by typing or pasting: the page moves to the password. */
  onComplete: () => void;
  onScan: () => void;
  editable: boolean;
  /** 「✓ 已从二维码填入」 under the box. */
  scanned: boolean;
  inputRef?: Ref<TextInput>;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const spelled = useSpelled();
  const [focused, setFocused] = useState(false);
  const [problem, setProblem] = useState<{ kind: SoulCodeProblem; char: string } | null>(null);
  const groups = groupSoulCode(value);
  // A code that came from the scanner replaces whatever was refused before it. Adjusted during render
  // (react.dev "storing information from previous renders"), not in an effect.
  const [sawScan, setSawScan] = useState(scanned);
  if (sawScan !== scanned) {
    setSawScan(scanned);
    if (scanned) setProblem(null);
  }
  const off = !editable;

  const change = (text: string) => {
    // The box is controlled: after a refused character React puts the old text back, and iOS reports that as a
    // change too. Nothing was typed, so the message about the refused character stays (iPhone 17, 2026-10-11).
    if (text.toUpperCase() === value) return;
    const step = soulCodeStep(value, text);
    setProblem(step.problem);
    if (step.value !== value) onChange(step.value);
    if (step.value.length === SOUL_CODE_LENGTH && value.length < SOUL_CODE_LENGTH) onComplete();
  };

  const borderColor = problem ? theme.neg : focused ? theme.ink : theme.inkSubtle;
  return (
    <View style={styles.field}>
      <Txt variant="label" tone="muted">
        {t("soul_app.login.soul_code")}
      </Txt>
      <FocusRing focused={focused && !off}>
        <View
          testID="login-soul-code-box"
          style={[styles.box, off ? { backgroundColor: theme.s2, borderColor: theme.hair } : { backgroundColor: theme.s1, borderColor, borderWidth: problem ? 2 : 1 }]}
        >
          <View style={styles.entry}>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.groupRow}>
              {groups.length === 0 ? (
                <View testID="login-soul-code-placeholder" style={styles.groupRow}>
                  {["···", "····", "···"].map((dots, i) => (
                    <Txt key={i} style={[styles.digits, { color: theme.inkSubtle }]}>
                      {dots}
                    </Txt>
                  ))}
                </View>
              ) : (
                groups.map((g, i) => (
                  <Txt key={i} testID={`login-soul-code-group-${i}`} style={[styles.digits, { color: off ? theme.inkSubtle : theme.ink }]}>
                    {g}
                  </Txt>
                ))
              )}
              {focused && value.length < SOUL_CODE_LENGTH ? <View style={[styles.caret, { backgroundColor: theme.ink }]} /> : null}
            </View>
            <TextInput
              ref={inputRef}
              testID="login-soul-code"
              value={value}
              onChangeText={change}
              editable={editable}
              accessibilityLabel={value ? spelled(value) : t("soul_app.login.soul_code")}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              // Soul codes are ASCII. With a Chinese (pinyin) keyboard active, letters otherwise go into an
              // uncommitted composition that is dropped when focus moves to the password field.
              keyboardType="ascii-capable"
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="username"
              textContentType="username"
              caretHidden
              style={styles.hidden}
            />
          </View>
          <Pressable
            testID="login-scan"
            accessibilityRole="button"
            accessibilityLabel={t("soul_app.login.scan")}
            disabled={off}
            onPress={onScan}
            style={[styles.scan, { borderLeftColor: theme.hair }]}
          >
            <ScanGlyph color={theme.ink} />
            <Txt variant="label" style={styles.scanText}>
              {t("soul_app.login.scan")}
            </Txt>
          </Pressable>
        </View>
      </FocusRing>
      {problem ? (
        <View testID="login-soul-code-problem" accessibilityRole="alert">
          <Txt variant="caption" tone="negInk" style={styles.problem}>
            {problem.kind === "bad_char" ? t(SOUL_CODE_PROBLEM_KEY.bad_char, { c: problem.char }) : t(SOUL_CODE_PROBLEM_KEY[problem.kind])}
          </Txt>
          {problem.kind === "bad_char" ? (
            <Txt variant="caption" tone="muted">
              {t("soul_app.login.bad_char_body")}
            </Txt>
          ) : null}
        </View>
      ) : scanned ? (
        <Txt testID="login-scanned" variant="caption" style={styles.problem}>
          {t("soul_app.login.scanned")}
        </Txt>
      ) : (
        <Txt testID="login-soul-code-hint" variant="caption" tone="muted">
          {t("soul_app.login.soul_code_hint")}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  box: { flexDirection: "row", alignItems: "center", height: 56, borderWidth: 1, paddingLeft: 16, paddingRight: 4 },
  entry: { flex: 1, height: 56, justifyContent: "center" },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  digits: { fontFamily: family.mono[500], fontSize: 22, lineHeight: 30, letterSpacing: 1.8 },
  groups: { letterSpacing: 1 },
  caret: { width: 2, height: 26, marginLeft: -12 },
  // Transparent text, NOT opacity 0: iOS does not hit-test a view whose alpha is 0, so the box could not be
  // tapped into at all (iPhone 17 simulator, 2026-10-11; jest presses the node directly and cannot see it).
  hidden: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, color: "transparent", fontSize: 22 },
  scan: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, borderLeftWidth: 1 },
  scanText: { letterSpacing: 0 },
  problem: { fontFamily: family.ui[600] },
});
