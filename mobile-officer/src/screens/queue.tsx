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
import { isDenied } from "../rules";
import { useSession } from "../session";
import { Screen, Txt, space, useI18n, useRemote, useToast } from "../shared";

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
  const load = useCallback(() => judgmentApi.list({ group }).then((r) => r.data), [group]);
  const { data: firstPage, error, loading, reload } = useRemote(load);
  const fetchPage = useCallback((page: number) => judgmentApi.list({ group, page: String(page) }).then((r) => r.data), [group]);
  const { rows: data, more } = useMoreRows(firstPage, fetchPage);
  const view = viewStateOf({ data, error }, (rows) => rows.length === 0, isDenied);
  // The four counts (a count that fails to load is simply not shown).
  const loadCounts = useCallback(() => judgmentApi.queueCounts().then((r) => r.data), []);
  const { data: counts, reload: reloadCounts } = useRemote(loadCounts);

  const claim = (row: Judgment) => {
    setClaiming(row.id);
    judgmentApi
      .claim(row.id)
      .then(() => {
        reload();
        reloadCounts();
      })
      .catch(() => toast(t("officer_app.queue.claim_failed"), "failure"))
      .finally(() => setClaiming(null));
  };

  return (
    <Screen testID="tab-queue-screen" edges={["left", "right"]} refreshing={loading && data !== null} onRefresh={reload}>
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
            lines={[row.court, ...(group === "mine" && !row.is_final ? [`◇ ${t("officer_app.queue.desk_only")}`] : [])].filter(Boolean)}
            onPress={() => onOpen(row.id)}
            right={
              group === "unclaimed" ? (
                <View style={{ width: 88 }}>
                  <ActionButton
                    testID={`queue-claim-${row.id}`}
                    kind="outline"
                    title={t("officer_app.queue.claim")}
                    busy={claiming === row.id}
                    onPress={() => claim(row)}
                  />
                </View>
              ) : undefined
            }
          />
        ))
      )}
      <MoreRow more={more} />
    </Screen>
  );
}
