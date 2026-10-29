/**
 * 本世页的进度卡(Design 第六十二批):勾魂牒、已超度、冥河渡口、地狱前庭(位置类,五段条正下方),
 * 与四十二条否定告白(紧贴审判那一格上方)。字段是 `/me/` 的 `capture_warrant` / `wangsi_delivered_at` /
 * `greek_ferry` / `european_vestibule` / `negative_confession`,不适用时为 null —— null 就不画。
 * 版式照「赴冥 · 十三站」(life.tsx 的 StationsCard):通栏,上下 16,底边一条细线;不加动效。
 */
import type { MeProfile } from "@soulledger/core/api/soul";
import { formatIsoDay } from "@soulledger/core/domain/dates";
import type { ReactNode, Ref } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Line } from "react-native-svg";

import { useI18n } from "../i18n";
import { formatStamp } from "../rules";
import { SectionLabel, Txt, useLayout, useTheme } from "../ui";

type Ferry = NonNullable<MeProfile["greek_ferry"]>;
type Confession = NonNullable<MeProfile["negative_confession"]>;

/** 时刻(ISO date-time)按本机的日子,写成第六十批的日期:「2026年 · 10月28日」/ `2026 · Abed 10 Hru 28`。 */
export function useDay(): (iso: string | null | undefined) => string {
  const { locale } = useI18n();
  return (iso) => formatIsoDay(/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "") ? iso : formatStamp(iso)?.slice(0, 10), locale);
}

const ymd = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;

/**
 * 到可渡之日还要等多久(第 4 节):按日历的整年往下取整;不满一年写天数(不用月);当天或已过 = 可以渡河。
 * `waited` 是百年里已经过去的比例(0–1),只给细线用;读屏的「已等 N 年」写 100 − years,与大字的「还要等 years 年」
 * 加起来正好一百(各自取整会差一年,真机 2026-10-30 听到 18 + 81)。
 */
export function ferryWait(crossesOn: string, today: Date): { years: number; days: number; waited: number } {
  const [cy, cm, cd] = ymd(crossesOn);
  const [y, m, d] = [today.getFullYear(), today.getMonth() + 1, today.getDate()];
  const days = Math.max(0, dayNumber(cy, cm, cd) - dayNumber(y, m, d));
  const years = Math.max(0, cy - y - (cm < m || (cm === m && cd < d) ? 1 : 0));
  return { years, days, waited: Math.min(1, Math.max(0, 1 - days / 36_525)) };
}

function DateLine({ testID, text }: { testID: string; text: string }) {
  return (
    <Txt testID={testID} variant="body" tone="muted">
      {text}
    </Txt>
  );
}

function Card({ testID, title, right, children }: { testID: string; title: string; right?: string; children: ReactNode }) {
  const t = useTheme();
  const { gutter } = useLayout();
  return (
    <View testID={testID} style={[styles.card, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <View style={styles.head}>
        <SectionLabel style={styles.fill}>{title}</SectionLabel>
        {right ? (
          <Txt testID={`${testID}-count`} variant="value" tone="muted" style={styles.small}>
            {right}
          </Txt>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const CAPTURE_STEPS = ["step_issued", "step_captured", "step_handed"] as const;
/** 正在第几步;HANDED_OVER = 3,三步都已过。不认识的状态不画(不把原始成员值放到页面上)。 */
const CAPTURE_AT: Record<string, number | undefined> = { ISSUED: 1, CAPTURED: 2, HANDED_OVER: 3 };

/**
 * 勾魂牒(地府):发牒 → 拘到 → 交城隍,■ 已过 ▪ 正在 □ 未到。死亡登记时牒一并签发并交接(用户 2026-10-30),
 * 所以灵魂端通常看到的是 HANDED_OVER:三步全是 ■。
 */
export function CaptureCard({ warrant }: { warrant: MeProfile["capture_warrant"] }) {
  const { t: tr } = useI18n();
  const day = useDay();
  const at = warrant ? CAPTURE_AT[warrant.status] : undefined;
  if (!warrant || at === undefined) return null;
  return (
    <Card testID="life-capture" title={tr("soul_app.life.capture.title")}>
      <View testID="life-capture-steps" style={styles.steps}>
        {CAPTURE_STEPS.map((step, i) => (
          <Txt key={step} numberOfLines={1} variant="caption" tone={i === at ? "ink" : "muted"}>
            {`${i ? "→ " : ""}${i < at ? "■" : i === at ? "▪" : "□"} ${tr(`soul_app.life.capture.${step}`)}`}
          </Txt>
        ))}
      </View>
      <Txt testID="life-capture-status" variant="body">
        {tr(`soul_app.life.capture.${warrant.status}`)}
      </Txt>
      <DateLine testID="life-capture-date" text={tr("soul_app.life.capture.issued_on", { date: day(warrant.issued_at) })} />
    </Card>
  );
}

/**
 * 已超度(地府):一行状态,浅底无边框。只在这一世的枉死城那一行(审判那格底部)没有把超度写出来时才画
 * —— 同一件事不说两遍(调用方判断)。推送「已超度」落在这里。
 */
export function DeliveredRow({ at, holdRef }: { at: string | null | undefined; holdRef?: Ref<View> }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const day = useDay();
  if (!at) return null;
  const date = day(at);
  return (
    <View
      ref={holdRef}
      testID="life-delivered"
      accessible
      accessibilityLabel={`${tr("soul_app.life.delivered_on", { date })} · ${tr("soul_app.wangsi.status.DELIVERED")}`}
      style={[styles.delivered, { paddingHorizontal: gutter, backgroundColor: t.s1 }]}
    >
      <View style={styles.head}>
        <Txt variant="bodyLg" style={styles.fill}>
          {tr("soul_app.life.delivered")}
        </Txt>
        <Txt testID="life-delivered-date" variant="body" tone="muted">
          {date}
        </Txt>
      </View>
      <Txt variant="caption" tone="muted">
        {tr("soul_app.wangsi.status.DELIVERED")}
      </Txt>
    </View>
  );
}

/** 冥河渡口(希腊):渡过了(crossed)就没有这张卡。NO_FARE 没有日期:不画细线,不写数字。 */
export function FerryCard({ ferry, today = new Date() }: { ferry: Ferry | null | undefined; today?: Date }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const day = useDay();
  if (!ferry || ferry.crossed || (ferry.ferry_passage !== "UNBURIED" && ferry.ferry_passage !== "NO_FARE")) return null;
  const wait = ferry.ferry_passage === "UNBURIED" && ferry.crosses_on ? ferryWait(ferry.crosses_on, today) : null;
  const n = wait ? String(wait.years || wait.days) : "";
  const big = !wait
    ? null
    : wait.days === 0
      ? tr("soul_app.life.ferry.may_cross")
      : wait.years >= 1
        ? tr(wait.years === 1 ? "soul_app.life.ferry.years_left_one" : "soul_app.life.ferry.years_left", { n })
        : tr(wait.days === 1 ? "soul_app.life.ferry.days_left_one" : "soul_app.life.ferry.days_left", { n });
  return (
    <Card testID="life-ferry" title={tr("soul_app.life.ferry.title")}>
      <Txt testID="life-ferry-body" variant="body">
        {tr(`soul_app.life.ferry.${ferry.ferry_passage}`)}
      </Txt>
      {wait && ferry.crosses_on ? (
        <>
          <Txt testID="life-ferry-wait" variant="bodyLg">
            {big}
          </Txt>
          {/* 百年细线:只画已等过的那段,不写数字(第 4 节第 5 条)。 */}
          <View
            testID="life-ferry-line"
            accessible
            accessibilityLabel={tr("soul_app.life.ferry.waited_aria", { waited: String(Math.min(99, 100 - wait.years)) })}
            style={[styles.track, { backgroundColor: t.hair }]}
          >
            <View testID="life-ferry-line-fill" style={[styles.trackFill, { width: `${wait.waited * 100}%`, backgroundColor: t.ink }]} />
          </View>
          <DateLine testID="life-ferry-date" text={tr("soul_app.life.ferry.crosses_on", { date: day(ferry.crosses_on) })} />
        </>
      ) : ferry.ferry_passage === "NO_FARE" ? (
        <DateLine testID="life-ferry-date" text={tr("soul_app.life.ferry.no_date")} />
      ) : null}
    </Card>
  );
}

/** 地狱前庭(欧洲):归处,不画任何进度 —— 没有步骤、细线、倒计时,右上角也不放数字。 */
export function VestibuleCard({ vestibule }: { vestibule: MeProfile["european_vestibule"] }) {
  const { t: tr } = useI18n();
  const day = useDay();
  if (!vestibule) return null;
  return (
    <Card testID="life-vestibule" title={tr("soul_app.life.vestibule.title")}>
      <Txt testID="life-vestibule-body" variant="body">
        {tr("soul_app.life.vestibule.body")}
      </Txt>
      <DateLine testID="life-vestibule-date" text={tr("soul_app.life.vestibule.entered_on", { date: day(vestibule.entered_at) })} />
    </Card>
  );
}

type Kind = "truthful" | "untruthful" | "unheard";
const KINDS: Kind[] = ["truthful", "untruthful", "unheard"];

/** 一格:如实实心、不实斜线、未记空心。不实不用红 —— 斜线就分得出来。 */
function Cell({ kind, flex }: { kind: Kind; flex: boolean }) {
  const t = useTheme();
  return (
    <View
      testID={`confession-cell-${kind}`}
      style={[flex ? styles.cell : styles.swatch, { borderColor: kind === "truthful" ? t.ink : t.inkMuted }, kind === "truthful" && { backgroundColor: t.ink }]}
    >
      {kind === "untruthful" ? (
        <Svg width="100%" height="100%" viewBox="0 0 10 14" preserveAspectRatio="none">
          <Line x1="0" y1="14" x2="10" y2="0" stroke={t.inkMuted} strokeWidth={1.5} />
        </Svg>
      ) : null}
    </View>
  );
}

/** 四十二条否定告白(埃及):42 小格 + 一行计数;整组一个读屏标签,不逐格读。 */
export function ConfessionCard({ tally }: { tally: Confession | null | undefined }) {
  const { t: tr } = useI18n();
  const { width } = useWindowDimensions();
  if (!tally) return null;
  const counts: Record<Kind, number> = { truthful: tally.truthful, untruthful: tally.untruthful, unheard: tally.unheard };
  const recorded = tally.truthful + tally.untruthful;
  const cells = KINDS.flatMap((k) => Array.from({ length: Math.max(0, counts[k]) }, () => k));
  const params = { truthful: String(tally.truthful), untruthful: String(tally.untruthful), unheard: String(tally.unheard), total: String(tally.total) };
  // 393 宽一行放得下;更窄(< 360pt)只留色块与数字。
  const labels = width >= 360;
  return (
    <Card testID="life-confession" title={tr("soul_app.life.confession.title")} right={`${recorded} / ${tally.total}`}>
      <Txt variant="caption" tone="subtle" style={styles.subtitle}>
        {tr("soul_app.life.confession.subtitle")}
      </Txt>
      <View testID="life-confession-strip" accessible accessibilityLabel={tr("soul_app.life.confession.strip_aria", params)} style={styles.strip}>
        {cells.map((k, i) => (
          <Cell key={i} kind={k} flex />
        ))}
      </View>
      <View testID="life-confession-tally" style={styles.tally}>
        {KINDS.map((k) => (
          <View key={k} style={styles.tallyItem}>
            <Cell kind={k} flex={false} />
            <Txt testID={`life-confession-${k}`} numberOfLines={1} variant="caption" tone="muted">
              {labels ? `${tr(`soul_app.life.confession.${k}`)} ${counts[k]}` : String(counts[k])}
            </Txt>
          </View>
        ))}
      </View>
      <Txt testID="life-confession-status" variant="body">
        {tally.unheard > 0
          ? tr("soul_app.life.confession.partial", { recorded: String(recorded), total: String(tally.total) })
          : tr("soul_app.life.confession.complete", { total: String(tally.total) })}
      </Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { paddingTop: 16, paddingBottom: 16, gap: 12, borderBottomWidth: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  small: { fontSize: 11, lineHeight: 16 },
  steps: { flexDirection: "row", flexWrap: "nowrap", gap: 4 },
  delivered: { paddingTop: 12, paddingBottom: 12, gap: 4 },
  track: { height: 2, overflow: "hidden" },
  trackFill: { height: 2 },
  subtitle: { marginTop: -8 },
  strip: { flexDirection: "row", gap: 2, height: 14 },
  cell: { flex: 1, height: 14, borderWidth: 1, overflow: "hidden" },
  swatch: { width: 8, height: 8, borderWidth: 1, overflow: "hidden" },
  tally: { flexDirection: "row", flexWrap: "nowrap", gap: 16 },
  tallyItem: { flexDirection: "row", alignItems: "center", gap: 4 },
});
