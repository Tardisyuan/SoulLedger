/**
 * 「记住的账号」, one card for both apps (Design 第五十批 C3): card ground, 1px line, radius 12; a 44 round avatar on
 * card2 with the name's first character in the serif, the name 16 / 500, the masked account in mono 13 / sub, and the
 * text link 「换一个账号」 at the right (sub, underlined in line2). The apps differ only in how the account is masked
 * (officer `zh***g`, soul `QU3-•••-W5F`) and in the link's words.
 *
 * Also the row of C4's list (`trailing` in place of the link: the soul app's 「⋯」, 40 avatar, 15 / 500 name).
 * `afterCode` sits right after the masked account (第五十二批 C4: the fingerprint on the row that owns the credential).
 * A leaf: ui / fonts only, so the officer app can import it (mobile-officer/src/shared.ts, sharedClosure.test.ts).
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { family } from "./fonts";
import { Txt, useTheme, Press } from "./ui";

export function RememberedCard({
  name,
  masked,
  link,
  trailing,
  afterCode,
  onPress,
  compact,
  disabled,
  testID,
}: {
  name: string;
  masked: string;
  /** 「换一个账号」. */
  link?: { label: string; onPress: () => void; testID?: string };
  /** In place of the link (a list row's 「⋯」). */
  trailing?: ReactNode;
  /** Right after the masked account, on its line. */
  afterCode?: ReactNode;
  /** The whole card (a list row: pick this number). */
  onPress?: () => void;
  /** A list row: avatar 40, name 15, no own border (the list draws one). */
  compact?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const size = compact ? 40 : 44;
  const body = (
    <>
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: t.s2 }]}>
        <Txt style={styles.initial} accessibilityElementsHidden importantForAccessibility="no">
          {[...(name || masked)][0] ?? ""}
        </Txt>
      </View>
      <View style={styles.fill}>
        {name ? (
          <Txt testID={testID ? `${testID}-name` : undefined} numberOfLines={1} style={[styles.name, compact && styles.nameCompact]}>
            {name}
          </Txt>
        ) : null}
        <View style={styles.codeLine}>
          <Txt testID={testID ? `${testID}-code` : undefined} tone="muted" style={styles.masked}>
            {masked}
          </Txt>
          {afterCode}
        </View>
      </View>
      {link ? (
        <Press testID={link.testID} accessibilityRole="button" disabled={disabled} onPress={link.onPress} style={styles.link}>
          <Txt tone="muted" style={[styles.linkText, { textDecorationColor: t.hair2 }]}>
            {link.label}
          </Txt>
        </Press>
      ) : null}
      {trailing}
    </>
  );
  const frame = [styles.card, compact ? null : { borderWidth: 1, borderRadius: 12, borderColor: t.hair, backgroundColor: t.s1 }];
  return onPress ? (
    <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [frame, pressed && { backgroundColor: t.hair }]}>
      {body}
    </Pressable>
  ) : (
    <View testID={testID} style={frame}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingVertical: 12, paddingLeft: 16, paddingRight: 4 },
  avatar: { alignItems: "center", justifyContent: "center" },
  initial: { fontFamily: family.serifHan, fontSize: 18, lineHeight: 24 },
  fill: { flex: 1, gap: 2 },
  name: { fontFamily: family.ui[500], fontSize: 16, lineHeight: 22 },
  nameCompact: { fontSize: 15, lineHeight: 21 },
  masked: { fontFamily: family.mono[400], fontSize: 13, lineHeight: 18 },
  codeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  link: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 12 },
  linkText: { textDecorationLine: "underline", fontSize: 14, lineHeight: 20 },
});
