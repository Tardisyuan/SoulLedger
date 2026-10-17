/**
 * 审判: 「我手上 / 待认领」. On the phone an officer can claim, read and (once the server has a
 * comment endpoint) comment; the verdict and the seal are the desk's. A row waiting for a verdict
 * says so: 「◇ 待宣判 · 请在官员台」.
 */
import { judgmentApi, type Judgment, type JudgmentQueueGroup } from "@soulledger/core/api/judgment";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ActionButton, RefreshFailed, Row, Segmented, StateView, viewStateOf } from "../kit";
import { MoreRow, useMoreRows } from "../paged";
import { useCachedRemote } from "../readCache";
import { isDenied } from "../rules";
import { useCan, useSession } from "../session";
import { Screen, Txt, space, useI18n, useOnline, useRemote, useToast } from "../shared";

/** 他人手上 / 暂缓 are read-only on the phone: no claim button, the row opens the case. */
const GROUPS: readonly JudgmentQueueGroup[] = ["mine", "unclaimed", "others", "deferred"];
type Group = JudgmentQueueGroup;

export function QueueTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const [group, setGroup] = useState<Group>("mine");
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
        data!.map((row) => (
          <Row
            key={row.id}
            testID={`queue-row-${row.id}`}
            minHeight={88}
            strong
            glyph="§"
            title={`${row.case_number} · ${row.soul_name}`}
            lines={[
              row.court,
              ...(group === "mine" && !row.is_final ? [`◇ ${t("officer_app.queue.desk_only")}`] : []),
              // 滞留:定时任务盖的章(30 天无进展,不结案);下一次进展就清掉。
              ...(row.stale_since ? [`◐ ${t("judgment.stale.label")} · ${t("judgment.stale.hint")}`] : []),
            ].filter(Boolean)}
            onPress={() => onOpen(row.id)}
            right={
              group === "unclaimed" && canClaim ? (
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
        ))
      )}
      <MoreRow more={more} state={moreState} />
    </Screen>
  );
}
