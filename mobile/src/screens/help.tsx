/**
 * 帮助 (Design 第二十八批 S5): the questions people ask, in three groups, each question opening its answer in place
 * (the first-version answers are Design's words, in the language bundles). Under the list: 「没找到答案？」 and
 * 「写给本殿」, which goes to the feedback form.
 *
 * The sign-in page reaches the same screen as 「登录遇到问题」 with `only: "login"`: only 登录与账号, and no way to write
 * (a letter needs a signed-in soul). That is why this screen reads the session and nothing else -- it works signed out.
 */
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useChat } from "../chat";
import { Icon } from "../emblems";
import { useI18n } from "../i18n";
import { useSession } from "../session";
import { Button, Screen, SectionLabel, Txt, useLayout, useTheme } from "../ui";
import type { AppStackParams } from "./applications";

/** [id, question key, answer key]. Written out so the copy harvest and the bundles' parity tests see every key. */
type Faq = readonly [string, string, string];
const GROUPS: readonly { id: "login" | "visit" | "contact"; title: string; items: readonly Faq[] }[] = [
  {
    id: "login",
    title: "soul_app.help.group_login",
    items: [
      ["login", "soul_app.help.q_login", "soul_app.help.a_login"],
      ["forgot", "soul_app.help.q_forgot", "soul_app.help.a_forgot"],
      ["phone", "soul_app.help.q_phone", "soul_app.help.a_phone"],
    ],
  },
  { id: "visit", title: "soul_app.help.group_visit", items: [["slip", "soul_app.help.q_slip", "soul_app.help.a_slip"]] },
  { id: "contact", title: "soul_app.help.group_contact", items: [["contact", "soul_app.help.q_contact", "soul_app.help.a_contact"]] },
];

function Question({ item }: { item: Faq }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  const [id, q, a] = item;
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.hair }}>
      <Pressable
        testID={`help-q-${id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.row, { paddingHorizontal: gutter }, pressed && styles.pressed]}
      >
        <Txt variant="bodyLg" style={styles.fill}>
          {t(q)}
        </Txt>
        <Icon name={open ? "chevronDown" : "chevron"} size={14} color={theme.inkSubtle} />
      </Pressable>
      {open ? (
        <Txt testID={`help-a-${id}`} variant="bodyLg" tone="muted" style={[styles.answer, { paddingHorizontal: gutter }]}>
          {t(a)}
        </Txt>
      ) : null}
    </View>
  );
}

export function HelpScreen({ only }: { only?: "login" }) {
  const { t } = useI18n();
  const { gutter } = useLayout();
  const { state } = useSession();
  const chat = useChat();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const groups = GROUPS.filter((g) => !only || g.id === only);
  // Writing needs a signed-in soul and a hall to write to; the sign-in page's version has neither.
  const canWrite = !only && state.status === "signedIn" && chat.availability !== "not_configured";
  return (
    <Screen testID="help">
      {groups.map((group) => (
        <View key={group.id} testID={`help-group-${group.id}`}>
          <View style={[styles.groupLabel, { paddingHorizontal: gutter }]}>
            <SectionLabel>{t(group.title)}</SectionLabel>
          </View>
          {group.items.map((item) => (
            <Question key={item[0]} item={item} />
          ))}
        </View>
      ))}
      {canWrite ? (
        <View testID="help-write-block" style={[styles.write, { paddingHorizontal: gutter }]}>
          <Txt variant="body" tone="muted">
            {t("soul_app.help.not_found")}
          </Txt>
          <Button testID="help-write" kind="secondary" title={t("soul_app.help.write")} onPress={() => navigation.navigate("Feedback")} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.8 },
  groupLabel: { paddingTop: 24, paddingBottom: 8 },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  answer: { paddingTop: 0, paddingBottom: 16 },
  write: { paddingVertical: 24, gap: 8 },
});
