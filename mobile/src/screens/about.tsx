/**
 * 关于 / 致谢(规范 v2 补足 C16):从设置页进。数据与 Web 同一份
 * (`@soulledger/core/config/credits`);专名原样,只有分节标题走语言包。
 * 链接交给系统浏览器 —— 授权全文与 Commons 文件页都不是 App 该内嵌的东西。
 */
import { FONT_CREDITS, IMAGE_CREDITS, LICENCE_LABELS, ORNAMENT_CREDITS, type Credit } from "@soulledger/core/config/credits";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import { useI18n } from "../i18n";
import { Screen, Txt, useLayout, useTheme } from "../ui";

/** 18 高的字 + 上下各 13 的 hitSlop = 44,App 点击区下限(补足 A1)。 */
function Link({ label, url, testID }: { label: string; url: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="link" onPress={() => void Linking.openURL(url)} hitSlop={13}>
      <Txt variant="caption" tone="muted" style={styles.link}>
        {label} ↗
      </Txt>
    </Pressable>
  );
}

function Group({ title, credits }: { title: string; credits: Credit[] }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  return (
    <View style={{ paddingHorizontal: gutter }}>
      <Txt variant="section" tone="accent" accessibilityRole="header" style={styles.heading}>
        {title}
      </Txt>
      {credits.map((c) => {
        const licence = c.licence === "PD" ? null : LICENCE_LABELS[c.licence];
        return (
          <View key={`${c.name} · ${c.detail ?? ""}`} testID={`credit-${c.name}`} style={[styles.row, { borderBottomColor: theme.hair }]}>
            <Txt variant="body">{c.name}</Txt>
            {c.detail ? (
              <Txt variant="caption" tone="subtle">
                {c.detail}
              </Txt>
            ) : null}
            <View style={styles.links}>
              {licence ? (
                <Link label={licence.label} url={licence.url} />
              ) : (
                <Txt variant="caption" tone="muted">
                  {t("about.public_domain")}
                </Txt>
              )}
              {c.url ? <Link label={t("about.source")} url={c.url} testID={`credit-source-${c.name}`} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function AboutScreen() {
  const { t } = useI18n();
  const { gutter } = useLayout();
  return (
    <Screen testID="about">
      <Txt variant="caption" tone="muted" style={[styles.intro, { paddingHorizontal: gutter }]}>
        {t("about.intro")}
      </Txt>
      <Group title={t("about.fonts")} credits={FONT_CREDITS} />
      <Group title={t("about.ornament")} credits={ORNAMENT_CREDITS} />
      <Group title={t("about.images")} credits={IMAGE_CREDITS} />
      <View style={styles.end} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { paddingTop: 16 },
  heading: { paddingTop: 22, paddingBottom: 8 },
  row: { paddingVertical: 10, borderBottomWidth: 1, gap: 2 },
  links: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 2 },
  link: { textDecorationLine: "underline" },
  end: { height: 32 },
});
