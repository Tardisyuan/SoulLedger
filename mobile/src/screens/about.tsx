/**
 * 关于 / 致谢(规范 v2 补足 C16):从设置页进。数据与 Web 同一份
 * (`@soulledger/core/config/credits`);专名原样,只有分节标题走语言包。
 * 链接交给系统浏览器 —— 授权全文与 Commons 文件页都不是 App 该内嵌的东西。
 * 开源软件八十多行,按平台分四个默认收起的 Section(与 Web 的 <details> 同一分组)。
 */
import {
  DESIGN_CREDITS,
  FONT_CREDITS,
  LICENCE_LABELS,
  LITERATURE_CIVILIZATIONS,
  LITERATURE_CREDITS,
  OSS_CREDITS,
  OSS_GROUPS,
  SERVICE_CREDITS,
  type Credit,
  type OssGroup,
} from "@soulledger/core/config/credits";
import { useState, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import { useI18n } from "../i18n";
import { Screen, Section, SectionLabel, Txt, useLayout, useTheme } from "../ui";

/** 18 高的字 + 上下各 13 的 hitSlop = 44,App 点击区下限(补足 A1)。 */
function Link({ label, url, testID }: { label: string; url: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="link" onPress={() => void Linking.openURL(url)} hitSlop={13}>
      <Txt variant="caption" tone="muted" style={styles.link}>
        {label} {"↗\uFE0E"}
      </Txt>
    </Pressable>
  );
}

function Row({ name, detail, testID, children }: { name: string; detail?: string; testID?: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.row, { borderBottomColor: theme.hair }]}>
      <Txt variant="body">{name}</Txt>
      {detail ? (
        <Txt variant="caption" tone="subtle">
          {detail}
        </Txt>
      ) : null}
      {children ? <View style={styles.links}>{children}</View> : null}
    </View>
  );
}

function Heading({ title, note }: { title: string; note?: string }) {
  return (
    <>
      <SectionLabel accessibilityRole="header" style={styles.heading}>
        {title}
      </SectionLabel>
      {note ? (
        <Txt variant="caption" tone="subtle" style={styles.note}>
          {note}
        </Txt>
      ) : null}
    </>
  );
}

function Group({ title, credits }: { title: string; credits: Credit[] }) {
  const { t } = useI18n();
  const { gutter } = useLayout();
  return (
    <View style={{ paddingHorizontal: gutter }}>
      <Heading title={title} />
      {credits.map((c) => {
        const licence = c.licence === "PD" ? null : LICENCE_LABELS[c.licence];
        return (
          <Row key={`${c.name} · ${c.detail ?? ""}`} testID={`credit-${c.name}`} name={c.name} detail={c.detail}>
            {licence ? (
              <Link label={licence.label} url={licence.url} />
            ) : (
              <Txt variant="caption" tone="muted">
                {t("about.public_domain")}
              </Txt>
            )}
            {c.url ? <Link label={t("about.source")} url={c.url} testID={`credit-source-${c.name}`} /> : null}
          </Row>
        );
      })}
    </View>
  );
}

function OssGroupSection({ group }: { group: OssGroup }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rows = OSS_CREDITS[group];
  return (
    <Section testID={`oss-${group}`} title={t(`about.group_${group}`)} count={String(rows.length)} open={open} onToggle={() => setOpen((o) => !o)}>
      {rows.map((c) => (
        <Row key={c.name} testID={`oss-${group}-${c.name}`} name={c.name}>
          <Txt variant="caption" tone="muted">
            {c.licence ?? t("about.undeclared")}
          </Txt>
          <Link label={t("about.source")} url={c.url} />
        </Row>
      ))}
    </Section>
  );
}

export function AboutScreen() {
  const { t } = useI18n();
  const { gutter } = useLayout();
  const pad = { paddingHorizontal: gutter };
  return (
    <Screen testID="about">
      <Txt variant="caption" tone="muted" style={[styles.intro, pad]}>
        {t("about.intro")}
      </Txt>
      <Group title={t("about.fonts")} credits={FONT_CREDITS} />

      <View style={pad}>
        <Heading title={t("about.software")} />
      </View>
      {OSS_GROUPS.map((group) => (
        <OssGroupSection key={group} group={group} />
      ))}

      <View style={pad}>
        <Heading title={t("about.literature")} />
        {LITERATURE_CIVILIZATIONS.map((civ) => (
          <View key={civ}>
            <Txt variant="caption" tone="subtle" style={styles.subheading}>
              {t(`home.civ_subtitle.${civ}`)}
            </Txt>
            {LITERATURE_CREDITS.filter((c) => c.civilization === civ).map((c) => (
              <Row key={c.title} testID={`literature-${c.title}`} name={c.title} detail={c.details.join(" · ")}>
                {c.kind === "reference" ? (
                  <Txt variant="caption" tone="muted">
                    {t("about.reference")}
                  </Txt>
                ) : null}
                {c.url ? <Link label={t("about.source")} url={c.url} /> : null}
              </Row>
            ))}
          </View>
        ))}

        <Heading title={t("about.services")} note={t("about.by_deployment")} />
        {SERVICE_CREDITS.map((s) => (
          <Row key={s.name} testID={`service-${s.name}`} name={s.name} detail={s.detail}>
            {s.isDefault ? (
              <Txt variant="caption" tone="muted">
                {t("about.default")}
              </Txt>
            ) : null}
            <Link label={t("about.source")} url={s.url} />
          </Row>
        ))}

        <Heading title={t("about.design")} />
        {DESIGN_CREDITS.map((d) => (
          <Row key={d.name} name={d.name} detail={d.detail} />
        ))}
      </View>
      <View style={styles.end} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { paddingTop: 16 },
  heading: { paddingTop: 24, paddingBottom: 8 },
  note: { paddingBottom: 4 },
  subheading: { paddingTop: 12 },
  row: { paddingVertical: 12, borderBottomWidth: 1, gap: 2 },
  links: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 2 },
  link: { textDecorationLine: "underline" },
  end: { height: 32 },
});
