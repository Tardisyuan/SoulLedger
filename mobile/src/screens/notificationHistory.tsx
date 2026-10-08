/**
 * 通知记录:这个灵魂收到过的每一条推送,最新在前(`/me/notifications/`)。从设置页进。
 * 记的是**内容**:系统没送达的、当时关掉的也在,只多一个「未送达」角标。
 * 点一条带目标的,去推送本来要去的地方 —— 与锁屏上点通知走同一条 `landOn`。
 * 20 条一页;「更多」追加下一页,下拉刷新从头来。
 */
import { soulApi, soulErrorMessage, type PushHistoryItem } from "@soulledger/core/api/soul";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon } from "../emblems";
import { useI18n } from "../i18n";
import { landOn, landingOf } from "../push";
import { formatStamp } from "../rules";
import { Button, Empty, Notice, Screen, Skeleton, Txt, useLayout, useReloadOnRefocus, useRemote, useTheme } from "../ui";
import type { AppStackParams } from "./applications";

/** Statuses where the lock screen never showed it; the content is still readable. */
const NOT_DELIVERED = new Set(["FAILED", "DISABLED", "EXPIRED", "CANCELLED", "NO_DEVICE"]);

function Row({ item, last }: { item: PushHistoryItem; last: boolean }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const landing = landingOf(item.data);
  const body = (
    <>
      <View style={styles.fill}>
        <Txt variant="bodyLg">{item.title}</Txt>
        <Txt variant="caption" tone="muted">
          {item.body}
        </Txt>
        <View style={styles.meta}>
          <Txt variant="value" tone="subtle" style={styles.stamp}>
            {formatStamp(item.created_at) ?? ""}
          </Txt>
          {NOT_DELIVERED.has(item.status) ? (
            <View style={[styles.flag, { borderColor: theme.hair2 }]}>
              <Txt testID={`not-delivered-${item.id}`} variant="label" tone="subtle" style={styles.flagText}>
                {t("soul_app.history.not_delivered")}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
      {landing ? <Icon name="chevron" size={14} color={theme.inkSubtle} /> : null}
    </>
  );
  const style = [styles.row, { paddingHorizontal: gutter, borderBottomColor: theme.hair }, last && styles.last];
  return landing ? (
    <Pressable
      testID={`notification-${item.id}`}
      accessibilityRole="button"
      onPress={() => landOn(navigation.navigate, landing)}
      style={({ pressed }) => [...style, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  ) : (
    <View testID={`notification-${item.id}`} style={style}>
      {body}
    </View>
  );
}

export function NotificationHistoryScreen() {
  const { t } = useI18n();
  const { gutter } = useLayout();
  const first = useCallback(() => soulApi.notifications(1), []);
  const remote = useRemote(first);
  const { reload: reloadFirst } = remote;
  // Pages after the first, appended by 「更多」; a refresh drops them with the first page.
  const [tail, setTail] = useState<{ rows: PushHistoryItem[]; next: number | null; busy: boolean; failed: boolean } | null>(null);
  const reload = useCallback(() => {
    setTail(null);
    return reloadFirst();
  }, [reloadFirst]);
  useReloadOnRefocus(reload);

  const rows = remote.data ? [...remote.data.results, ...(tail?.rows ?? [])] : null;
  const next = tail ? tail.next : remote.data?.next ? 2 : null;
  const more = () => {
    if (next === null || tail?.busy) return;
    setTail((prev) => ({ rows: prev?.rows ?? [], next, busy: true, failed: false }));
    soulApi.notifications(next).then(
      (page) => setTail((prev) => ({ rows: [...(prev?.rows ?? []), ...page.results], next: page.next ? next + 1 : null, busy: false, failed: false })),
      () => setTail((prev) => ({ rows: prev?.rows ?? [], next, busy: false, failed: true }))
    );
  };

  return (
    <Screen testID="notification-history" refreshing={remote.loading && rows !== null} onRefresh={reload}>
      {rows === null ? (
        remote.error ? (
          <View style={{ padding: gutter }}>
            <Notice tone="neg" testID="history-error" onRetry={() => void reload()}>
              {t("soul_app.history.load_failed")}
            </Notice>
            <Txt variant="caption" tone="subtle" style={styles.reason}>
              {t(soulErrorMessage(remote.error).key, soulErrorMessage(remote.error).params)}
            </Txt>
          </View>
        ) : (
          <View style={{ padding: gutter }}>
            <Skeleton lines={4} testID="history-loading" />
          </View>
        )
      ) : rows.length === 0 ? (
        <Empty testID="history-empty" text={t("soul_app.history.empty")} />
      ) : (
        <View>
          {rows.map((item, i) => (
            <Row key={item.id} item={item} last={i === rows.length - 1} />
          ))}
          {next !== null ? (
            <View style={[styles.more, { paddingHorizontal: gutter }]}>
              {tail?.failed ? (
                <Notice tone="neg" testID="history-more-error" onRetry={more}>
                  {t("soul_app.history.load_failed")}
                </Notice>
              ) : (
                <Button testID="history-more" kind="secondary" title={t("soul_app.history.more")} onPress={more} busy={tail?.busy} />
              )}
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, borderBottomWidth: 1 },
  last: { borderBottomWidth: 0 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  stamp: { fontSize: 11, letterSpacing: 0.6 },
  flag: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  flagText: { fontSize: 10, letterSpacing: 0.4 },
  more: { paddingVertical: 16 },
  reason: { marginTop: 8 },
});
