/**
 * 审判: 「我手上 / 待认领」. On the phone an officer can claim, read and (once the server has a
 * comment endpoint) comment; the verdict and the seal are the desk's. A row waiting for a verdict
 * says so: 「◇ 待宣判 · 请在官员台」.
 */
import { judgmentApi, type Judgment, type JudgmentQueueGroup } from "@soulledger/core/api/judgment";
import { isDuatBarred, isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ActionButton, RefreshFailed, Row, Segmented, StateView, viewStateOf } from "../kit";
import { MoreRow, useMoreRows } from "../paged";
import { useCachedRemote } from "../readCache";
import { goneKey, isDenied } from "../rules";
import { useCan, useSession } from "../session";
import { Screen, Txt, space, useI18n, useOnline, useRemote, useToast } from "../shared";

/** 他人手上 / 暂缓 are read-only on the phone: no claim button, the row opens the case. */
const GROUPS: readonly JudgmentQueueGroup[] = ["mine", "unclaimed", "others", "deferred"];
type Group = JudgmentQueueGroup;

/**
 * `gone`: cases whose detail turned out to be gone (O-c), greyed and not pressable.
 * `initialGroup` / `onGroup`: the shell keeps the chosen segment. Opening a case unmounts this tab and
 * closing it remounts it (`key={version}`), so a segment kept here alone fell back to 我手上 on every
 * return from a case opened under 待认领 (华为真机 10-29 第二轮).
 */
export function QueueTab({
  onOpen,
  gone,
  initialGroup = "mine",
  onGroup,
}: {
  onOpen: (id: string) => void;
  gone?: ReadonlySet<string>;
  initialGroup?: Group;
  onGroup?: (group: Group) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const [group, setGroup] = useState<Group>(initialGroup);
  const [claiming, setClaiming] = useState<string | null>(null);
  const { offline } = useOnline();
  // 认领要 `judgment.execute`;只有 judgment.read 的角色看得到队列,但不画认领键。
  const canClaim = useCan("judgment.execute");
  const load = useCallback(() => judgmentApi.list({ group }).then((r) => r.data), [group]);
  const { data: firstPage, error, loading, reload } = useCachedRemote(`list:queue:${group}`, load);
  const fetchPage = useCallback((page: number) => judgmentApi.list({ group, page: String(page) }).then((r) => r.data), [group]);
  const { rows: data, more, moreState } = useMoreRows(firstPage, fetchPage);
  const view = viewStateOf({ data, error }, (rows) => rows.length === 0, isDenied);
  // The four counts (a count that fails to load is simply not shown).
  const loadCounts = useCallback(() => judgmentApi.queueCounts().then((r) => r.data), []);
  const { data: counts, reload: reloadCounts } = useRemote(loadCounts);
  // A pull, a claim, a 409: the list and its four counts are asked again together.
  const refresh = () => Promise.all([reload(), reloadCounts()]);

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
        options={GROUPS.map((key) => ({ key, label: counts ? `${t(`officer_app.queue.${key}`)} · ${counts[key]}` : t(`officer_app.queue.${key}`) }))}
      />
      <View style={{ paddingHorizontal: space[5], paddingBottom: space[3] }}>
        <Txt variant="caption" tone="muted">
          {t("officer_app.queue.scope_note")}
        </Txt>
      </View>
      <RefreshFailed data={data} error={error} onRetry={reload} />
      {view ? (
        <StateView
          state={view}
          onRetry={reload}
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
              row.court,
              ...(group === "mine" && !row.is_final ? [{ one: `◇ ${t("officer_app.queue.desk_only")}` }] : []),
              // 滞留:定时任务盖的章(30 天无进展,不结案);下一次进展就清掉。
              ...(row.stale_since ? [{ one: `◐ ${t("judgment.stale.label")} · ${t("judgment.stale.hint")}` }] : []),
              ...(row.untimely
                ? [{ one: [`▢ ${t("judgment.untimely")}`, ...(held ? [t("judgment.held_until", { date: row.held_until as string })] : [])].join(" · ") }]
                : []),
              ...(row.duat_stage
                ? [{ one: [`▢ ${t(`judgment.duat_stage.${row.duat_stage}`)}`, ...(held ? [t("judgment.held_until", { date: row.held_until as string })] : [])].join(" · ") }]
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
