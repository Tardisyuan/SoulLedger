/**
 * 案卷台(Design 第三十批 第 2 步)的纯规则:来源、分组去重、行上的标签与第二行、概览行、来源 chip、
 * 哪些按键算数。页面(`CaseDesk.tsx`)与测试(`caseDeskRules.test.ts`)都读这一份。
 *
 * 与官员端 `mobile-officer/src/screens/queue.tsx` 同一套规矩(那边是 393 的同一张台)。`deadlineText` /
 * `heldBeforeClaim` 是 `mobile-officer/src/verdict.ts` 的同名函数在网页的一份 —— 两个 App 不互相 import。
 */
import type { Judgment, JudgmentElsewhereCounts, JudgmentQueueCounts, JudgmentQueueGroup, JudgmentQueueSource } from "@soulledger/core/api/judgment";
import { isDuatBarred, isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import type { BadgeTone } from "@/src/components/ui/Badge";
import { DOSSIER_TAG } from "@/src/components/ui/StatusBadge";
import { CIVILIZATION_OPTIONS, civShortCode } from "@soulledger/core/config/civilizations";

export type T = (key: string, vars?: Record<string, string>) => string;

/** 摞上的四组,自上而下;「他人手上」最后,只读(用户 2026-11-13 留下第四组)。 */
export const DESK_GROUPS: readonly JudgmentQueueGroup[] = ["mine", "deferred", "unclaimed", "others"];

export const SOURCES: readonly JudgmentQueueSource[] = ["queue", "city_god", "cross"];

const DAY = 86_400;

/**
 * 一件案子从哪来。THE ONE PLACE:chip、行的第二行、筛选都读它。服务端的 `source`(`backend/apps/judgment/sources.py`)
 * 已经在行上;老录制(演示)没有这个字段的行算「审判队列」。
 */
export function sourceOf(row: Pick<Judgment, "source">): JudgmentQueueSource {
  return row.source ?? "queue";
}

/** 行的第二行里的来源:城隍送来的写「城隍初审」,跨域写「跨域」,其余「审判队列」。 */
export function sourceLabel(t: T, row: Pick<Judgment, "source">): string {
  return t(`officer_app.desk.sources.${sourceOf(row)}`);
}

export function heldBeforeClaim(j: Pick<Judgment, "conclude_refusal" | "held_until" | "duat_stage">): boolean {
  return !!j.conclude_refusal || isHeldUntilFatedDate(j) || isDuatBarred(j);
}

/** 期限一格:候审中 / 不计 / 超 n 日 / n 日。 */
export function deadlineText(t: T, j: Pick<Judgment, "deadline_remaining_seconds" | "conclude_refusal" | "held_until" | "duat_stage">): string {
  if (heldBeforeClaim(j)) return t("queue.deadline.held");
  const s = j.deadline_remaining_seconds;
  if (s == null) return t("queue.deadline.none");
  if (s < 0) return t("queue.deadline.over", { n: String(Math.ceil(-s / DAY)) });
  return t("queue.deadline.days", { n: String(Math.ceil(s / DAY)) });
}

/**
 * 行的那一个标签:超期 > 退回重审 > 组自己的(待定;候审 / 到不了殿;他人认领;审判中 / 待宣判);否则写期限。
 * 字形与色调取第 1 步的 `DOSSIER_TAG`。`deadline`:标签已经写了期限,第二行不再重复。
 */
export function deskTag(t: T, row: Judgment, group: JudgmentQueueGroup): { tone: BadgeTone; glyph: string; text: string; deadline: boolean } {
  const s = row.deadline_remaining_seconds;
  if (group !== "deferred" && row.is_overdue && s != null && s < 0) {
    return { ...DOSSIER_TAG.overdue, text: t("officer_app.desk.tag.overdue", { n: String(Math.ceil(-s / DAY)) }), deadline: true };
  }
  if (row.retrial_of) return { ...DOSSIER_TAG.retry, text: t("officer_app.desk.tag.returned"), deadline: false };
  if (group === "deferred") return { ...DOSSIER_TAG.pending, text: t("officer_app.desk.groups.deferred"), deadline: false };
  if (group === "unclaimed" && isDuatBarred(row)) return { ...DOSSIER_TAG.pending, text: t("judgment.claim.duat_barred_short"), deadline: false };
  if (group === "unclaimed" && isHeldUntilFatedDate(row)) return { ...DOSSIER_TAG.pending, text: t("judgment.claim.held_short"), deadline: false };
  if (group === "others") return { ...DOSSIER_TAG.claimedByOther, text: t("officer_app.desk.tag.others"), deadline: false };
  if (group === "mine") return { ...DOSSIER_TAG.judging, text: t(row.is_final ? "officer_app.desk.tag.reviewing" : "officer_app.desk.tag.awaiting"), deadline: false };
  return { tone: "neutral", glyph: "", text: deadlineText(t, row), deadline: true };
}

/** 第二行「来源 · 殿」之后的:期限(待定与标签已写时不写)、他人手上的持有人、滞留、枉死 / 入殿前与候至。 */
export function rowNotes(t: T, row: Judgment, group: JudgmentQueueGroup, tagHasDeadline: boolean, day: (iso: string) => string): string[] {
  const held = isHeldUntilFatedDate(row) && row.held_until ? [t("judgment.held_until", { date: day(row.held_until) })] : [];
  return [
    ...(group === "deferred" || tagHasDeadline ? [] : [`${t("queue.col.deadline")} ${deadlineText(t, row)}`]),
    ...(group === "others" && row.claimed_by_name ? [row.claimed_by_name] : []),
    ...(row.stale_since ? [t("judgment.stale.label")] : []),
    ...(row.untimely ? [t("judgment.untimely"), ...held] : []),
    ...(row.duat_stage ? [t(`judgment.duat_stage.${row.duat_stage}`), ...(row.untimely ? [] : held)] : []),
  ];
}

/** 「今日 7 件 · 超期 1 · 本月已结 22%」;超期 0 写「无超期」、不标红。没读到的部分不写。 */
export function overviewParts(t: T, onDesk: number | null, overdue: number | null, monthPct: number | null): { text: string; neg?: boolean }[] {
  const parts: { text: string; neg?: boolean }[] = [];
  if (onDesk != null) parts.push({ text: t("officer_app.desk.overview.today", { n: String(onDesk) }) });
  if (overdue != null) {
    parts.push(overdue > 0 ? { text: t("officer_app.desk.overview.overdue", { n: String(overdue) }), neg: true } : { text: t("officer_app.desk.overview.no_overdue") });
  }
  if (monthPct != null) parts.push({ text: t("officer_app.desk.overview.month_done", { pct: String(monthPct) }) });
  return parts;
}

/** 今日 N 件 = 我认领 + 待定 + 待认领(他人手上的不在我台上)。 */
export function onDeskCount(c: Pick<JudgmentQueueCounts, "mine" | "deferred" | "unclaimed"> | null | undefined): number | null {
  return c ? (c.mine ?? 0) + (c.deferred ?? 0) + (c.unclaimed ?? 0) : null;
}

/** 一件案子只在一组:重取时的竞态可能让它出现两次,先到的组留下。 */
export function dedupeGroups<R extends { id: string }>(groups: { group: JudgmentQueueGroup; rows: R[] }[]): { group: JudgmentQueueGroup; rows: R[] }[] {
  const seen = new Set<string>();
  return groups.map(({ group, rows }) => ({
    group,
    rows: rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))),
  }));
}

/** 搜索:姓名或案号里有这几个字(不分大小写)。 */
export function matchesSearch(row: Pick<Judgment, "soul_name" | "case_number">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${row.soul_name ?? ""} ${row.case_number ?? ""}`.toLowerCase().includes(needle);
}

export type SourceChip =
  | { kind: "filter"; key: "all" | JudgmentQueueSource; label: string; count: number }
  | { kind: "link"; key: keyof JudgmentElsewhereCounts; label: string; count: number; href: string };

const ELSEWHERE: { key: keyof JudgmentElsewhereCounts; href: string }[] = [
  { key: "appeal", href: "/judgment/appeals" },
  { key: "city_god_review", href: "/city-god-cases" },
  { key: "cross_judgment", href: "/cross-judgments" },
  { key: "capture_due", href: "/judgment/capture-due" },
  { key: "rebirth_application", href: "/rebirth-applications" },
];

/**
 * 来源 chip:全部 + 三个来源(筛这一摞,`?source=`)+ 别处等着办的四样(点了去那一页)。值是 null(没有读码)或 0 的不画,
 * 所以每个文明只列它有的。城隍有两个(用户 2026-11-13):「城隍送来」= 已解送到殿的(筛),「城隍初审中」= 还在城隍手上的(去)。
 */
export function sourceChips(t: T, counts: Pick<JudgmentQueueCounts, "sources" | "elsewhere" | "total"> | null | undefined): SourceChip[] {
  if (!counts) return [];
  const sources = counts.sources;
  const all = sources ? SOURCES.reduce((n, s) => n + (sources[s] ?? 0), 0) : counts.total;
  const chips: SourceChip[] = [{ kind: "filter", key: "all", label: t("officer_app.desk.all"), count: all }];
  for (const key of SOURCES) {
    const count = sources?.[key] ?? 0;
    if (count > 0) chips.push({ kind: "filter", key, label: key === "city_god" ? t("officer_app.desk.chips.city_god") : t(`officer_app.desk.sources.${key}`), count });
  }
  for (const { key, href } of ELSEWHERE) {
    const count = counts.elsewhere?.[key];
    if (count) chips.push({ kind: "link", key, label: t(`officer_app.desk.sources.${key}`), count, href });
  }
  return chips;
}

/** J / K 在摞上挪一格,两头停住;还没选中时 J 落到第一件、K 落到最后一件。 */
export function step(ids: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = current ? ids.indexOf(current) : -1;
  if (at < 0) return delta === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
}

/**
 * 总簿的栏(用户决定):没绑殿的管理员(全局的,`is_tenant_exempt`)看四个冥界;绑了殿的只看本殿那一栏。
 * 只读登录信封里已有的殿(`user.tenant` 的 civilization,旧信封没有时按殿码前缀);认不出就照旧四栏
 * —— 服务端按殿过滤,别的栏读出来是 0,不会多看见什么。
 */
export function zongbuCivilizations(tenant: { code: string; civilization?: string } | null | undefined): readonly (typeof CIVILIZATION_OPTIONS)[number][] {
  if (!tenant) return CIVILIZATION_OPTIONS;
  const short = civShortCode(tenant.civilization) ?? civShortCode(tenant.code);
  const own = CIVILIZATION_OPTIONS.filter((c) => civShortCode(c) === short);
  return own.length ? own : CIVILIZATION_OPTIONS;
}
