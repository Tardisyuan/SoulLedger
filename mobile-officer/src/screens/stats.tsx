/**
 * 我的数(Design 第五十四批 S-1 ~ S-3):审判 / 申诉复核两组,不画比例也不画迷你图 -- 五个数之间没有部分与整体的关系。
 * 「认领未结」点了去审判队列(默认就是「我的」);「本月结案」下面写起算日,免得月初的 0 被读成出错。
 * 全 0 换成一句话;加载失败只给一行字和重试,不留旧数。
 *
 * v4 起下面加「本殿」一组(`GET /judgment/hall-stats/`,同网页概览 S04):待审、已过期限、本月已结与百分比、平均用时、
 * 退回重审、近 12 周结案(本季实心,上季同期一道细线)。范围是这位官员看得到的审判列表,时间按殿的时区。
 * 取不到就整组不画(上面「我的数」照旧),不另写失败。
 */
import { judgmentApi, type JudgmentHallStats } from "@soulledger/core/api/judgment";
import { officerAppApi, type OfficerStats } from "@soulledger/core/api/officer-app";
import { useCallback } from "react";
import { View } from "react-native";

import { Row } from "../kit";
import { hallLabel } from "../rules";
import { useSession } from "../session";
import { Notice, SectionLabel, SmallButton, Txt, space, useI18n, useRemote, useTheme } from "../shared";
import { AccountFrame } from "./account";

/** 本月 1 日(本地时间),与后端 `_month_start` 同一天。 */
export const monthSince = (now: Date = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

export const allZero = (s: OfficerStats): boolean => Object.values(s).every((n) => n === 0);

export function StatsScreen({ onBack, onOpenQueue }: { onBack: () => void; onOpenQueue: () => void }) {
  const { t } = useI18n();
  const load = useCallback(() => officerAppApi.stats().then((r) => r.data), []);
  const { data, error, reload } = useRemote(load);
  const loadHall = useCallback(() => judgmentApi.hallStats().then((r) => r.data), []);
  const hall = useRemote(loadHall).data;
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
      {hall ? <HallStats s={hall} /> : null}
    </AccountFrame>
  );
}

function HallStats({ s }: { s: JudgmentHallStats }) {
  const { t } = useI18n();
  const theme = useTheme();
  const { state } = useSession();
  const hall = state.status === "signedIn" ? hallLabel(t, state.user.tenant) : undefined;
  const top = Math.max(1, ...s.weeks.flatMap((w) => [w.concluded, w.previous_quarter]));
  return (
    <View testID="stats-hall" style={{ gap: space[3] }}>
      <SectionLabel>{hall ?? t("overview.trend.scope")}</SectionLabel>
      <Stat testID="hall-pending" label={t("swipe.title")} n={s.pending} />
      <Stat testID="hall-overdue" label={t("queue.tab.overdue")} n={s.overdue} />
      <Stat
        testID="hall-month"
        label={t("officer_app.stats.concluded_this_month")}
        n={s.concluded_this_month}
        note={s.month_done_pct != null ? t("overview.month_done_pct", { pct: String(s.month_done_pct) }) : undefined}
      />
      <Stat testID="hall-avg" label={t("overview.stat.avg_time")} n={s.avg_days != null ? t("overview.days", { n: String(s.avg_days) }) : "—"} />
      <Stat testID="hall-returned" label={t("overview.stat.returned")} n={s.returned_this_month} />
      <View style={{ gap: space[2] }}>
        <Txt variant="bodyLg">{t("overview.trend.title")}</Txt>
        <Txt variant="caption" tone="muted">{t("overview.trend.scope")}</Txt>
        <View testID="hall-weeks" style={{ flexDirection: "row", alignItems: "flex-end", gap: space[1], height: 72 }}>
          {s.weeks.map((w, i) => (
            <View
              key={w.week_start}
              accessible
              accessibilityLabel={`${t("overview.trend.week", { n: String(i + 1), date: w.week_start })} · ${t("overview.trend.this_quarter")} ${w.concluded} · ${t("overview.trend.last_quarter_same")} ${w.previous_quarter}`}
              style={{ flex: 1, height: "100%", justifyContent: "flex-end" }}
            >
              {/* 上季同期:一道细线;本季:实心柱。 */}
              <View style={{ position: "absolute", left: 0, right: 0, bottom: `${(100 * w.previous_quarter) / top}%`, height: 1, backgroundColor: theme.inkMuted }} />
              <View style={{ height: `${(100 * w.concluded) / top}%`, minHeight: w.concluded ? 2 : 0, backgroundColor: theme.plaque }} />
            </View>
          ))}
        </View>
        <Txt variant="caption" tone="muted">{`■ ${t("overview.trend.this_quarter")}  — ${t("overview.trend.last_quarter_same")}`}</Txt>
      </View>
    </View>
  );
}

function Stat({ testID, label, n, note, onPress }: { testID: string; label: string; n: number | string; note?: string; onPress?: () => void }) {
  return <Row testID={testID} minHeight={64} title={label} lines={note ? [{ one: note }] : []} onPress={onPress} right={<Txt variant="title">{`${n}${onPress ? "  ›" : ""}`}</Txt>} />;
}
