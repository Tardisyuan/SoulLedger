/**
 * 我的数(Design 第五十四批 S-1 ~ S-3):审判 / 申诉复核两组,不画比例也不画迷你图 -- 五个数之间没有部分与整体的关系。
 * 「认领未结」点了去审判队列(默认就是「我的」);「本月结案」下面写起算日,免得月初的 0 被读成出错。
 * 全 0 换成一句话;加载失败只给一行字和重试,不留旧数。
 */
import { officerAppApi, type OfficerStats } from "@soulledger/core/api/officer-app";
import { useCallback } from "react";
import { View } from "react-native";

import { Row } from "../kit";
import { Notice, SectionLabel, SmallButton, Txt, space, useI18n, useRemote } from "../shared";
import { AccountFrame } from "./account";

/** 本月 1 日(本地时间),与后端 `_month_start` 同一天。 */
export const monthSince = (now: Date = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

export const allZero = (s: OfficerStats): boolean => Object.values(s).every((n) => n === 0);

export function StatsScreen({ onBack, onOpenQueue }: { onBack: () => void; onOpenQueue: () => void }) {
  const { t } = useI18n();
  const load = useCallback(() => officerAppApi.stats().then((r) => r.data), []);
  const { data, error, reload } = useRemote(load);
  return (
    <AccountFrame testID="stats-screen" onBack={onBack}>
      <Txt variant="title">{t("officer_app.stats.title")}</Txt>
      <Txt variant="body" tone="muted">{t("officer_app.stats.scope")}</Txt>
      {!data && error ? (
        <View style={{ gap: space[3] }}>
          <Notice tone="neg">{t("officer_app.stats.load_failed")}</Notice>
          <SmallButton testID="stats-retry" title={t("common.retry")} onPress={() => void reload()} />
        </View>
      ) : null}
      {data && allZero(data) ? (
        <View testID="stats-empty" style={{ gap: space[2] }}>
          <Txt variant="bodyLg">{t("officer_app.stats.empty_title")}</Txt>
          <Txt variant="body" tone="muted">{t("officer_app.stats.empty_body")}</Txt>
        </View>
      ) : null}
      {data && !allZero(data) ? (
        <>
          <SectionLabel>{t("officer_app.stats.section_judgments")}</SectionLabel>
          <Stat testID="stat-month" label={t("officer_app.stats.concluded_this_month")} n={data.concluded_this_month} note={t("officer_app.stats.month_since", { date: monthSince() })} />
          <Stat testID="stat-total" label={t("officer_app.stats.concluded_total")} n={data.concluded_total} />
          <Stat testID="stat-open" label={t("officer_app.stats.open_claims")} n={data.open_claims} onPress={onOpenQueue} />
          <SectionLabel>{t("officer_app.stats.section_appeals")}</SectionLabel>
          <Stat testID="stat-reviewed" label={t("officer_app.stats.appeals_reviewed")} n={data.appeals_reviewed} />
          {/* ponytail: 申诉复核「我的」在官员 App 里没有对应页,这一格先不可点。 */}
          <Stat testID="stat-in-review" label={t("officer_app.stats.appeals_in_review")} n={data.appeals_in_review} />
        </>
      ) : null}
    </AccountFrame>
  );
}

function Stat({ testID, label, n, note, onPress }: { testID: string; label: string; n: number; note?: string; onPress?: () => void }) {
  return <Row testID={testID} minHeight={64} title={label} lines={note ? [{ one: note }] : []} onPress={onPress} right={<Txt variant="title">{`${n}${onPress ? "  ›" : ""}`}</Txt>} />;
}
