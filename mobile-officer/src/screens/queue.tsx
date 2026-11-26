/**
 * 案卷台 (Design 第三十批 第 2 步 · 官员端): the 393 stack on the phone. Top to bottom: the overview line, the
 * source chips (one sideways row), and four groups -- 我认领 / 待定 / 待认领 / 他人手上 -- of 72-high rows: the person's name
 * in serif, 「来源 · 殿」 under it, the tag and the case number at the right. A row swipes left to 「认领」 (待认领)
 * or 「放回」 (我认领), ink-filled; a pull asks everything again. No search box: the magnifier in the top bar
 * opens 查询 (shell.tsx). 他人手上 comes last (the Design draws three; user 2026-11-13 kept the fourth), read-only;
 * 滑卡审判 (v4 S09) stays, at the 我认领 heading.
 *
 * Sources come from the server (`backend/apps/judgment/sources.py`): each row's `source` names its second line, the
 * 审判队列 / 城隍送来 / 跨域 chips filter the four lists with `?source=` and count from `counts.sources`. The other chips count
 * what waits elsewhere (`counts.elsewhere`, null = not this officer's to read) and open its list when the app has
 * one: 城隍初审中 opens 待办 filtered to 城隍初审. 申诉 / 跨殿联审 / 待发勾魂牒 have no screen in this app, so no chip.
 * A chip whose count is 0 or null is not drawn.
 */
import { errorStatus } from "@soulledger/core/api/errors";
import { judgmentApi, type Judgment, type JudgmentQueueGroup } from "@soulledger/core/api/judgment";
import { courtLabel } from "@soulledger/core/domain/courts";
import { formatIsoDay, isDuatBarred, isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { Fragment, useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";

import { FilterChips, RefreshFailed, StateView, Tag, TAG_SHAPE, touch, type TagTone, type ViewState } from "../kit";
import { readQueueSource, writeQueueSource } from "../memory";
import { MoreRow, useMoreRows } from "../paged";
import { useCachedRemote, useOnBump } from "../readCache";
import { goneKey, isDenied } from "../rules";
import { useCan, useSession } from "../session";
import { GONE_OPACITY, GUTTER, OneLine, Screen, Txt, family, space, useI18n, useOnline, useReloadOnReconnect, useRemote, useTheme, useToast, Press } from "../shared";
import { deadlineText, heldBeforeClaim } from "../verdict";

type DeskGroup = JudgmentQueueGroup;

/** The chips that filter the desk with `?source=` (user 2026-11-13: 城隍送来 filters, 城隍初审中 opens its list). */
const FILTER_SOURCES = ["queue", "city_god", "cross"] as const;
type FilterSource = (typeof FILTER_SOURCES)[number];
const DAY = 86_400;

/**
 * The row's one tag: 超期 over 退回重审 over the group's own -- 待定; 到期后可认领 / 到不了殿 for a held or barred
 * case nobody holds (no 认领 then); 他人认领; 待宣判 (in hand, not yet final: 滑卡审判) or 审判中; else the deadline.
 * `deadline`: the tag already says the deadline, so the second line does not repeat it.
 */
export function deskTag(
  t: (key: string, vars?: Record<string, string>) => string,
  row: Judgment,
  group: DeskGroup,
  locale?: Parameters<typeof formatIsoDay>[1]
): { tone: TagTone; text: string; deadline: boolean } {
  const s = row.deadline_remaining_seconds;
  if (group !== "deferred" && row.is_overdue && s != null && s < 0) {
    return { tone: "neg", text: `${TAG_SHAPE.overdue} ${t("officer_app.desk.tag.overdue", { n: String(Math.ceil(-s / DAY)) })}`, deadline: true };
  }
  if (row.retrial_of) return { tone: "warn", text: `${TAG_SHAPE.returned} ${t("officer_app.desk.tag.returned")}`, deadline: false };
  if (group === "deferred") return { tone: "neutral", text: `${TAG_SHAPE.deferred} ${t("officer_app.desk.groups.deferred")}`, deadline: false };
  // 第六十一批 二: a case nobody can claim yet says so on the right -- ⊘ 到不了殿, or ‖ and the day it opens.
  if (group === "unclaimed" && isDuatBarred(row)) return { tone: "neutral", text: `⊘ ${t("judgment.claim.duat_barred_short")}`, deadline: false };
  if (group === "unclaimed" && isHeldUntilFatedDate(row)) {
    // Word joiners inside each part of the date: on a narrow row the tag wraps at a space, never inside 「10月28日」.
    const date = formatIsoDay(row.held_until, locale).split(" ").map((part) => [...part].join("\u2060")).join(" ");
    return { tone: "neutral", text: `${TAG_SHAPE.deferred} ${t("judgment.claim.held_from", { date })}`, deadline: false };
  }
  if (group === "others") return { tone: "neutral", text: `${TAG_SHAPE.others} ${t("officer_app.desk.tag.others")}`, deadline: false };
  if (group === "mine") return { tone: "warn", text: `${TAG_SHAPE.reviewing} ${t(row.is_final ? "officer_app.desk.tag.reviewing" : "officer_app.desk.tag.awaiting")}`, deadline: false };
  return { tone: "neutral", text: deadlineText(t, row), deadline: true };
}

/**
 * What the old list wrote under the title, now after 「来源 · 殿」 on the one second line (cut with …, a long press
 * reads it whole): the deadline (none in 待定, none when the tag says it), 他人认领's holder, 滞留, 枉死 / 入殿前 with
 * 候至 while held.
 */
export function rowNotes(t: (key: string, vars?: Record<string, string>) => string, row: Judgment, group: DeskGroup, tagHasDeadline: boolean, locale?: Parameters<typeof formatIsoDay>[1]): string[] {
  // 第六十一批 二: a held row's day is on its tag (held_from); the second line says why it waits instead.
  if (group === "unclaimed" && waitsBeforeClaim(row)) {
    const why = isHeldUntilFatedDate(row) && row.untimely ? "judgment.claim.held_reason.wangsi" : row.duat_stage ? `judgment.duat_stage.${row.duat_stage}` : null;
    return why ? [t(why)] : [];
  }
  const held = isHeldUntilFatedDate(row) ? [t("judgment.held_until", { date: formatIsoDay(row.held_until, locale) })] : [];
  return [
    ...(group === "deferred" || tagHasDeadline ? [] : [`${t("queue.col.deadline")} ${deadlineText(t, row)}`]),
    ...(group === "others" && row.claimed_by_name ? [row.claimed_by_name] : []),
    ...(row.stale_since ? [t("judgment.stale.label")] : []),
    ...(row.untimely ? [t("judgment.untimely"), ...held] : []),
    ...(row.duat_stage ? [t(`judgment.duat_stage.${row.duat_stage}`), ...(row.untimely ? [] : held)] : []),
  ];
}

/**
 * 第六十一批 二: the cases in 待认领 nobody can claim yet -- held until a day (枉死城, 木乃伊 70 天) or barred from the hall.
 * A held_until already past is claimable whatever the server's phase still says.
 */
export function waitsBeforeClaim(row: Pick<Judgment, "held_until" | "duat_stage" | "ferry_barred">): boolean {
  return isHeldUntilFatedDate(row) || isDuatBarred(row) || !!row.ferry_barred;
}

/** 「今日 7 件 · 超期 1 · 本月已结 22%」; 0 overdue reads 「无超期」, unmarked. Parts that did not load are left out. */
export function overviewParts(
  t: (key: string, vars?: Record<string, string>) => string,
  onDesk: number | null,
  overdue: number | null,
  monthPct: number | null
): { text: string; neg?: boolean }[] {
  const parts: { text: string; neg?: boolean }[] = [];
  if (onDesk != null) parts.push({ text: t("officer_app.desk.overview.today", { n: String(onDesk) }) });
  if (overdue != null) parts.push(overdue > 0 ? { text: t("officer_app.desk.overview.overdue", { n: String(overdue) }), neg: true } : { text: t("officer_app.desk.overview.no_overdue") });
  if (monthPct != null) parts.push({ text: t("officer_app.desk.overview.month_done", { pct: String(monthPct) }) });
  return parts;
}

/** One group's first page (kept in the read cache as before, `list:queue:<group>`) and its 「加载更多」. */
function useGroupRows(group: DeskGroup, source: FilterSource | "all") {
  const params = useCallback((extra?: Record<string, string>) => ({ group, ...(source === "all" ? {} : { source }), ...extra }), [group, source]);
  const load = useCallback(() => judgmentApi.list(params()).then((r) => r.data), [params]);
  const { data, error, loading, reload } = useCachedRemote(source === "all" ? `list:queue:${group}` : `list:queue:${group}:${source}`, load);
  const fetchPage = useCallback((page: number) => judgmentApi.list(params({ page: String(page) })).then((r) => r.data), [params]);
  const { rows, more, moreState } = useMoreRows(data, fetchPage);
  return { group, rows, error, loading, reload, more, moreState };
}

/**
 * `onOpen(id, ids)`: the case and the ids of the rows shown, in order -- the shell keeps them for 「第 1 / 7 件」 in the
 * detail's bar and 「下一件」 after a decision (convenience audit 2026-11-15 D1).
 * `gone`: cases whose detail turned out to be gone (O-c), greyed and not pressable. `version`: the shell's bump.
 */
export function QueueTab({
  onOpen,
  gone,
  version,
  onSwipe,
  onOpenCityGod,
  onOpenRebirth,
}: {
  /** The 城隍初审 chip: 待办, filtered to 城隍初审 (shell.tsx). Without it the chip is not drawn. */
  onOpenCityGod?: () => void;
  /** The 转生申请 chip (第三十批 十二.2, the seventh source): 待办, filtered to 转生申请. Without it the chip is not drawn. */
  onOpenRebirth?: () => void;
  /** `names`: the soul name each of those rows shows, for 「下一件」's 「{name} · 还剩 {n} 件」 (第五十批 C1). */
  onOpen: (id: string, ids: string[], names?: string[]) => void;
  /** 「滑卡审判」(v4 S09):打开我认领的卡堆。 */
  onSwipe?: () => void;
  gone?: ReadonlySet<string>;
  version?: number;
}) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const { offline } = useOnline();
  // 认领 / 放回 need `judgment.execute`; a judgment.read role sees the desk without the swipe.
  const canClaim = useCan("judgment.execute");
  const [busy, setBusy] = useState<string | null>(null);
  // Counts (the overview and the group headings) and the hall's month: not in the read cache, asked again on reconnect.
  // Unfiltered: the overview, the chips and (under 全部) the group headings are the whole desk.
  const loadCounts = useCallback(() => judgmentApi.queueCounts().then((r) => r.data), []);
  const counts = useRemote(loadCounts);
  useReloadOnReconnect(counts.reload, counts);
  // 本月已结 % is the hall's figure, the same `hall-stats` `month_done_pct` the web desk shows (user 2026-11-13).
  // async: a test double without `hallStats` rejects instead of throwing out of the loader.
  const loadStats = useCallback(async () => (await judgmentApi.hallStats()).data, []);
  const stats = useRemote(loadStats);

  // Kept across launches for this officer (D8, memory.ts). The chip of a source with nothing in it now is not drawn, so
  // nothing could take it off: the desk shows 全部 then, and the kept choice stays for when it fills again.
  const [kept, setKept] = useState<FilterSource | "all">(() => readQueueSource(["all", ...FILTER_SOURCES]) ?? "all");
  const sources = counts.data?.sources;
  const source = kept !== "all" && sources && !(sources[kept] > 0) ? "all" : kept;
  const setSource = (next: FilterSource | "all") => {
    setKept(next);
    writeQueueSource(next);
  };

  const mine = useGroupRows("mine", source);
  const deferred = useGroupRows("deferred", source);
  const unclaimed = useGroupRows("unclaimed", source);
  // 他人手上 last: read-only on the phone, no swipe.
  const others = useGroupRows("others", source);
  const groups = [mine, deferred, unclaimed, others];

  const refresh = () => Promise.all([mine.reload(), deferred.reload(), unclaimed.reload(), others.reload(), counts.reload(), stats.reload()]);
  useOnBump(version, refresh);

  // A case is in one group; a refetch race could show it twice, so the first group keeps it.
  const seen = new Set<string>();
  const shown = groups.map((g) => {
    const rows = (g.rows ?? []).filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    return { ...g, rows };
  });
  const loaded = shown.flatMap((g) => g.rows);
  const flat = shown.flatMap((g) => g.rows);

  const denied = groups.some((g) => g.error && isDenied(g.error));
  const pending = groups.find((g) => g.rows === null);
  const view: ViewState | null = denied ? "denied" : pending ? (pending.error ? "error" : "loading") : loaded.length === 0 ? "empty" : null;
  const failed = groups.find((g) => g.rows !== null && g.error);

  const move = (row: Judgment, kind: "claim" | "release") => {
    setBusy(row.id);
    (kind === "claim" ? judgmentApi.claim(row.id) : judgmentApi.release(row.id))
      .then(refresh)
      .catch((e: unknown) => {
        // 409 on a claim: someone was first. Say so; the list and the counts are asked again.
        if (kind === "claim" && errorStatus(e) === 409) {
          toast(t("officer_app.queue.claim_taken"), "failure");
          void refresh();
        } else toast(t(kind === "claim" ? "officer_app.queue.claim_failed" : "officer_app.desk.release_failed"), "failure");
      })
      .finally(() => setBusy(null));
  };

  const c = counts.data;
  const overview = overviewParts(
    t,
    c ? (c.mine ?? 0) + (c.deferred ?? 0) + (c.unclaimed ?? 0) : null,
    c?.overdue ?? null,
    stats.data?.month_done_pct ?? null
  );
  // 全部 / 审判队列 / 跨域 from `sources` (which `?source=` does not change); the elsewhere chips that have a screen.
  const rebirths = (c?.elsewhere as { rebirth_application?: number | null } | undefined)?.rebirth_application;
  const elsewhere = [
    ...(onOpenCityGod && c?.elsewhere?.city_god_review ? [{ key: "city_god_review" as const, count: c.elsewhere.city_god_review }] : []),
    // `rebirth_application` is new on the server (queue-counts); read through a narrow type until core's type names it.
    ...(onOpenRebirth && rebirths ? [{ key: "rebirth_application" as const, count: rebirths }] : []),
  ];
  const chips = sources
    ? [
        { key: "all" as const, label: t("officer_app.desk.all"), count: sources.queue + sources.city_god + sources.cross },
        ...FILTER_SOURCES.filter((key) => sources[key] > 0).map((key) => ({ key, label: t(key === "city_god" ? "officer_app.desk.chips.city_god" : `officer_app.desk.sources.${key}`), count: sources[key] })),
        ...elsewhere.map(({ key, count }) => ({ key, label: t(`officer_app.desk.sources.${key}`), count })),
      ]
    : [];

  // 第六十一批 二: 待认领's held cases, in the order they came (rowsOf already puts them after the claimable ones).
  const heldOf = (group: DeskGroup, rows: Judgment[]) => (group === "unclaimed" ? rows.filter(waitsBeforeClaim) : []);
  // 第六十三批 二 f: 待认领's heading is the server's `claimable_count` (counted without `source`, so only under 全部);
  // without it the heading has no number -- never the loaded rows minus the held ones, which moves as pages load.
  const headCount = (group: DeskGroup, rows: Judgment[]): number | null =>
    group === "unclaimed" ? (source === "all" ? c?.claimable_count ?? null : null) : ((source === "all" ? c?.[group] : null) ?? rows.length);

  return (
    <Screen testID="tab-queue-screen" edges={["left", "right"]} refreshing={groups.some((g) => g.loading && g.rows !== null)} onRefresh={refresh}>
      {overview.length ? (
        <Txt testID="desk-overview" variant="caption" tone="muted" style={styles.overview}>
          {overview.map((p, i) => (
            <Txt key={p.text} variant="caption" tone={p.neg ? "neg" : "muted"}>
              {i ? ` · ${p.text}` : p.text}
            </Txt>
          ))}
        </Txt>
      ) : null}
      {chips.length > 1 ? (
        <FilterChips
          testID="desk-sources"
          size="lg"
          options={chips}
          selected={[source]}
          onToggle={(key) =>
            key === "city_god_review" ? onOpenCityGod?.() : key === "rebirth_application" ? onOpenRebirth?.() : setSource(key === source ? "all" : key)
          }
        />
      ) : null}
      <RefreshFailed data={failed?.rows ?? null} error={failed?.error} onRetry={() => void refresh()} />
      {view ? (
        <StateView
          state={view}
          onRetry={() => void refresh()}
          role={role}
          area={t("officer_app.areas.queue")}
          emptyTitle={t("officer_app.desk.empty_title")}
          emptyBody={t("officer_app.desk.empty_body")}
        />
      ) : (
        shown.map(({ group, rows, more, moreState }) =>
          rows.length === 0 && !more ? null : (
            <View key={group} testID={`desk-group-${group}`}>
              <View style={[styles.groupHead, { borderBottomColor: theme.hair }]}>
                <Txt variant="caption" style={{ color: theme.faintText }}>
                  {t(`officer_app.desk.groups.${group}`)}
                </Txt>
                <View style={styles.groupRight}>
                  {group === "mine" && canClaim && onSwipe ? (
                    <Press testID="queue-open-swipe" accessibilityRole="button" disabled={offline} onPress={onSwipe} hitSlop={12}>
                      <Txt variant="caption" style={{ color: offline ? theme.faint : theme.ink }}>{`${t("officer_app.queue.open_swipe")} ›`}</Txt>
                    </Press>
                  ) : null}
                  {headCount(group, rows) === null ? null : (
                    <Txt testID={`desk-count-${group}`} variant="value" style={{ color: theme.faintText }}>
                      {String(headCount(group, rows))}
                    </Txt>
                  )}
                </View>
              </View>
              {[...rows.filter((row) => !heldOf(group, rows).includes(row)), ...heldOf(group, rows)].map((row, i, all) => {
                const held = heldOf(group, rows).includes(row);
                const tag = deskTag(t, row, group, locale);
                const action = !canClaim ? null : group === "unclaimed" && !heldBeforeClaim(row) ? "claim" : group === "mine" ? "release" : null;
                return (
                  <Fragment key={`${group}:${row.id}`}>
                  {held && !heldOf(group, rows).includes(all[i - 1]) ? (
                    // A dashed rule and 「候着的 · N」 at the end of 待认领 (第六十一批 二); no 「· 0」 when there are none.
                    <View testID="desk-held-divider" style={[styles.heldHead, { borderTopColor: theme.hair2 }]}>
                      <Txt variant="caption" style={{ color: theme.faintText }}>
                        {t("judgment.claim.groups.held", { n: String((source === "all" ? c?.held_count : null) ?? heldOf(group, rows).length) })}
                      </Txt>
                    </View>
                  ) : null}
                  <DeskRow
                    row={row}
                    held={held}
                    lineTwo={[t(`officer_app.desk.sources.${row.source ?? "queue"}`), courtLabel(t, row.court, locale), ...rowNotes(t, row, group, tag.deadline, locale)].join(" · ")}
                    tag={tag}
                    gone={!!gone?.has(goneKey({ type: "judgment", id: row.id }))}
                    onPress={() => onOpen(row.id, flat.map((r) => r.id), flat.map((r) => r.soul_name ?? ""))}
                    action={
                      action
                        ? {
                            testID: `queue-${action}-${row.id}`,
                            label: t(action === "claim" ? "officer_app.queue.claim" : "officer_app.desk.release"),
                            disabled: offline || busy === row.id,
                            onPress: () => move(row, action),
                          }
                        : null
                    }
                  />
                  </Fragment>
                );
              })}
              <MoreRow more={more} state={moreState} />
            </View>
          )
        )
      )}
    </Screen>
  );
}

/** 72 high: the name in serif 16/24, 「来源 · 殿」 under it; the tag over the case number at the right. */
function DeskRow({
  row,
  held = false,
  lineTwo,
  tag,
  gone,
  onPress,
  action,
}: {
  row: Judgment;
  /** 第六十一批 二: a case nobody can claim yet -- the whole row in --sub. */
  held?: boolean;
  lineTwo: string;
  tag: { tone: TagTone; text: string; deadline: boolean };
  gone: boolean;
  onPress: () => void;
  action: { testID: string; label: string; disabled: boolean; onPress: () => void } | null;
}) {
  const theme = useTheme();
  const body = (
    <Pressable
      testID={`queue-row-${row.id}`}
      accessibilityRole="button"
      accessibilityState={gone ? { disabled: true } : undefined}
      disabled={gone}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.hair, backgroundColor: pressed ? theme.s2 : theme.s0 }, gone ? styles.gone : null]}
    >
      <View style={styles.rowText}>
        <Txt numberOfLines={1} style={[styles.name, { color: held ? theme.inkMuted : theme.ink }]}>
          {row.soul_name}
        </Txt>
        <OneLine variant="caption" tone="muted" onPress={gone ? undefined : onPress}>
          {lineTwo}
        </OneLine>
      </View>
      <View style={styles.rowRight}>
        <Tag tone={tag.tone}>{tag.text}</Tag>
        <Txt variant="value" tone="muted" numberOfLines={1}>
          {row.case_number}
        </Txt>
      </View>
    </Pressable>
  );
  if (!action || gone) return body;
  return (
    <Swipeable
      overshootRight={false}
      friction={2}
      renderRightActions={() => (
        <Press
          testID={action.testID}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: action.disabled }}
          disabled={action.disabled}
          onPress={action.onPress}
          style={[styles.swipeAction, { backgroundColor: action.disabled ? theme.s2 : theme.ink }]}
        >
          <Txt variant="nav" style={{ color: action.disabled ? theme.inkSubtle : theme.s0 }}>
            {action.label}
          </Txt>
        </Press>
      )}
    >
      {body}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  overview: { paddingHorizontal: GUTTER, paddingTop: space[3], paddingBottom: space[2] },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: GUTTER, paddingTop: space[4], paddingBottom: space[2], borderBottomWidth: 1 },
  groupRight: { flexDirection: "row", alignItems: "center", gap: space[4] },
  row: { minHeight: touch.row, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: GUTTER, paddingVertical: space[2], borderBottomWidth: 1 },
  rowText: { flex: 1, minWidth: 0, gap: space[1] },
  // At most 60% of the row: a held case's tag (「‖ 暂不能认领 · 2056年 · 10月28日 起可认领」) used to take it all and leave the
  // name as 「QA··」 (simulator 2026-11-21). The tag wraps to a second line instead.
  rowRight: { alignItems: "flex-end", gap: space[1], flexShrink: 1, maxWidth: "60%" },
  // Serif 16/24 (Design 第三十批 二.2). A Text, not a TextInput: the Android clipping of serif lines is TextInput's.
  name: { fontFamily: family.title, fontSize: 16, lineHeight: 24 },
  gone: { opacity: GONE_OPACITY },
  swipeAction: { width: 96, alignItems: "center", justifyContent: "center" },
  heldHead: { paddingHorizontal: GUTTER, paddingTop: space[3], paddingBottom: space[2], borderTopWidth: 1, borderStyle: "dashed" },
});
