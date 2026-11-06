/**
 * 审判: 「我手上 / 待认领」. On the phone an officer can claim, read and comment, and (v4 S09) conclude the
 * cases in hand in 「滑卡审判」 (screens/swipe.tsx) with the automatic routing; choosing a destination and citing
 * articles stay the desk's. Each row carries its deadline (v4 D10, `queue.deadline.*`; none in 待定), and two
 * filters under the segments pick the overdue and the sent-back cases (`?overdue=` / `?returned=`).
 */
import { judgmentApi, type Judgment, type JudgmentQueueGroup } from "@soulledger/core/api/judgment";
import { courtLabel } from "@soulledger/core/domain/courts";
import { formatIsoDay, isDuatBarred, isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ActionButton, FilterChips, RefreshFailed, Row, Segmented, StateView, viewStateOf } from "../kit";
import { MoreRow, useMoreRows } from "../paged";
import { useCachedRemote, useOnBump } from "../readCache";
import { goneKey, isDenied } from "../rules";
import { useCan, useSession } from "../session";
import { Screen, Txt, space, useI18n, useOnline, useReloadOnReconnect, useRemote, useToast } from "../shared";
import { deadlineText } from "../verdict";

/** 他人手上 / 暂缓 are read-only on the phone: no claim button, the row opens the case. */
const GROUPS: readonly JudgmentQueueGroup[] = ["mine", "unclaimed", "others", "deferred"];

/** 分段上的「名 · 数」。两位数起去掉「 · 」(用户 2026-10-29):360dp 上四段各自放得下;数字等宽见 `kit` 的 segmentTight。 */
export function segmentLabel(label: string, count?: number | null): string {
  // null: the counts did not load (offline, a failed fetch) -- 「—」, and they are asked again on reconnect.
  if (count === null) return `${label} · —`;
  if (count == null) return label;
  return count >= 10 ? `${label}${count}` : `${label} · ${count}`;
}
type Group = JudgmentQueueGroup;
/** v4 队列的两个标签(与四组不互斥):已过期限、退回重审。在手机上是分段下面的两个筛选。 */
type Flag = "overdue" | "returned";
const FLAGS: readonly Flag[] = ["overdue", "returned"];

/**
 * `gone`: cases whose detail turned out to be gone (O-c), greyed and not pressable.
 * `initialGroup` / `onGroup`: the shell keeps the chosen segment. Opening a case unmounts this tab and
 * closing it mounts it again, so a segment kept here alone fell back to 我手上 on every
 * return from a case opened under 待认领 (华为真机 10-29 第二轮). `version`: the shell's bump, reloaded in place.
 */
export function QueueTab({
  onOpen,
  gone,
  initialGroup = "mine",
  version,
  onGroup,
  onSwipe,
}: {
  onOpen: (id: string) => void;
  /** 「滑卡审判」(v4 S09):打开我手上的卡堆。 */
  onSwipe?: () => void;
  gone?: ReadonlySet<string>;
  initialGroup?: Group;
  onGroup?: (group: Group) => void;
  version?: number;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const [group, setGroup] = useState<Group>(initialGroup);
  const [claiming, setClaiming] = useState<string | null>(null);
  const { offline } = useOnline();
  // 认领要 `judgment.execute`;只有 judgment.read 的角色看得到队列,但不画认领键。
  const canClaim = useCan("judgment.execute");
  const [flags, setFlags] = useState<readonly Flag[]>([]);
  const params = useCallback(
    (extra?: Record<string, string>) => ({ group, ...Object.fromEntries(flags.map((f) => [f, "true"])), ...extra }),
    [group, flags]
  );
  const load = useCallback(() => judgmentApi.list(params()).then((r) => r.data), [params]);
  const { data: firstPage, error, loading, reload } = useCachedRemote(flags.length ? `list:queue:${group}:${flags.join(",")}` : `list:queue:${group}`, load);
  const fetchPage = useCallback((page: number) => judgmentApi.list(params({ page: String(page) })).then((r) => r.data), [params]);
  const { rows: data, more, moreState } = useMoreRows(firstPage, fetchPage);
  const view = viewStateOf({ data, error }, (rows) => rows.length === 0, isDenied);
  // The four counts. They are not in the read cache: offline they fail and the segments say 「—」; back online
  // they are asked again by themselves, like the list (phone QA 10-29c: they stayed blank until a pull).
  const loadCounts = useCallback(() => judgmentApi.queueCounts().then((r) => r.data), []);
  const { data: counts, error: countsError, reload: reloadCounts } = useRemote(loadCounts);
  useReloadOnReconnect(reloadCounts, { data: counts, error: countsError });
  // A pull, a claim, a 409: the list and its four counts are asked again together.
  const refresh = () => Promise.all([reload(), reloadCounts()]);
  useOnBump(version, refresh); // the shell's bump (a push, the foreground): reloaded in place

  const claim = (row: Judgment) => {
    setClaiming(row.id);
    judgmentApi
      .claim(row.id)
      .then(refresh)
      .catch((e: unknown) => {
        // 409: someone claimed it first. Say so and drop the stale row (the list and the counts are asked again).
        if ((e as { response?: { status?: number } })?.response?.status === 409) {
          toast(t("officer_app.queue.claim_taken"), "failure");
          void refresh();
        } else toast(t("officer_app.queue.claim_failed"), "failure");
      })
      .finally(() => setClaiming(null));
  };

  return (
    <Screen testID="tab-queue-screen" edges={["left", "right"]} refreshing={loading && data !== null} onRefresh={refresh}>
      <Segmented
        testID="queue-group"
        value={group}
        onChange={(next) => {
          setGroup(next);
          onGroup?.(next);
        }}
        options={GROUPS.map((key) => ({ key, label: segmentLabel(t(`officer_app.queue.${key}`), counts ? counts[key] : countsError ? null : undefined) }))}
      />
      {counts && (counts.overdue != null || counts.returned != null) ? (
        <FilterChips
          testID="queue-flags"
          options={FLAGS.map((key) => ({ key, label: t(`queue.tab.${key}`), count: counts[key] ?? 0 }))}
          selected={flags}
          onToggle={(key) => setFlags((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]))}
        />
      ) : null}
      <View style={{ paddingHorizontal: space[5], paddingVertical: space[3], gap: space[3] }}>
        <Txt variant="caption" tone="muted">
          {group === "deferred" ? t("queue.deferred_hint") : t("officer_app.queue.scope_note")}
        </Txt>
        {group === "mine" && canClaim && onSwipe && (counts?.mine ?? 0) > 0 ? (
          <ActionButton testID="queue-open-swipe" kind="primary" disabled={offline} title={t("officer_app.queue.open_swipe")} onPress={onSwipe} />
        ) : null}
      </View>
      {/* Retry asks the counts again too: offline, both failed (phone QA 10-29b: the counts stayed blank). */}
      <RefreshFailed data={data} error={error} onRetry={() => void refresh()} />
      {view ? (
        <StateView
          state={view}
          onRetry={() => void refresh()}
          role={role}
          area={t("officer_app.areas.queue")}
          emptyTitle={t("officer_app.queue.empty_title")}
          emptyBody={t("officer_app.queue.empty_body")}
        />
      ) : (
        data!.map((row) => {
          // 枉死城(第五十一批):候审中的不放「认领」,换一行「到期后可认领」;徽标一直留着。
          const held = isHeldUntilFatedDate(row);
          // 埃及入殿前(review P2-9):无名、葬仪不当的到不了殿,永远候着,不放「认领」。
          const barred = isDuatBarred(row);
          return (
          <Row
            key={row.id}
            testID={`queue-row-${row.id}`}
            minHeight={88}
            strong
            glyph="§"
            title={`${row.case_number} · ${row.soul_name}`}
            lines={[
              courtLabel(t, row.court, locale),
              // v4 期限:待定的不计期限(停表),那一组不写。
              ...(group === "deferred" ? [] : [{ one: `${row.is_overdue ? "◐ " : ""}${t("queue.col.deadline")} · ${deadlineText(t, row)}` }]),
              ...(group === "mine" && !row.is_final ? [{ one: `◇ ${t("officer_app.queue.desk_only")}` }] : []),
              // 滞留:定时任务盖的章(30 天无进展,不结案);下一次进展就清掉。
              ...(row.stale_since ? [{ one: `◐ ${t("judgment.stale.label")} · ${t("judgment.stale.hint")}` }] : []),
              ...(row.untimely
                ? [{ one: [`▢ ${t("judgment.untimely")}`, ...(held ? [t("judgment.held_until", { date: formatIsoDay(row.held_until, locale) })] : [])].join(" · ") }]
                : []),
              ...(row.duat_stage
                ? [{ one: [`▢ ${t(`judgment.duat_stage.${row.duat_stage}`)}`, ...(held ? [t("judgment.held_until", { date: formatIsoDay(row.held_until, locale) })] : [])].join(" · ") }]
                : []),
            ].filter(Boolean)}
            onPress={() => onOpen(row.id)}
            gone={!!gone?.has(goneKey({ type: "judgment", id: row.id }))}
            right={
              group === "unclaimed" && canClaim && barred ? (
                <View style={{ width: 88 }}>
                  <Txt variant="caption" tone="muted" testID={`queue-held-${row.id}`}>
                    {t("judgment.claim.duat_barred_short")}
                  </Txt>
                </View>
              ) : group === "unclaimed" && canClaim && held ? (
                <View style={{ width: 88 }}>
                  <Txt variant="caption" tone="muted" testID={`queue-held-${row.id}`}>
                    {t("judgment.claim.held_short")}
                  </Txt>
                </View>
              ) : group === "unclaimed" && canClaim ? (
                <View style={{ width: 88 }}>
                  <ActionButton
                    testID={`queue-claim-${row.id}`}
                    kind="outline"
                    title={t("officer_app.queue.claim")}
                    busy={claiming === row.id}
                    disabled={offline}
                    accessibilityHint={offline ? t("officer_app.offline.banner_bare") : undefined}
                    onPress={() => claim(row)}
                  />
                </View>
              ) : undefined
            }
          />
          );
        })
      )}
      <MoreRow more={more} state={moreState} />
    </Screen>
  );
}
