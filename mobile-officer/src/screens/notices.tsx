/** 通知: the same data as the desk's notification centre. Unread is ● and bold, read is ○. */
import { notificationsApi, type Notification } from "@soulledger/core/api/notifications";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { formatWhen } from "../format";
import { Row, StateView, viewStateOf } from "../kit";
import { isDenied } from "../rules";
import { useSession } from "../session";
import { Screen, SmallButton, Txt, space, useI18n, useRemote } from "../shared";

export function NoticesTab({ onUnread }: { onUnread: (unread: boolean) => void }) {
  const { t } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const load = useCallback(() => notificationsApi.list().then((r) => r.data.results), []);
  const { data, error, loading, reload } = useRemote(load);
  // Marking is local first (the row turns ○ at once); a failure puts it back on the next reload.
  const [read, setRead] = useState<ReadonlySet<number>>(new Set());
  const view = viewStateOf({ data, error }, (rows) => rows.length === 0, isDenied);
  const isUnread = (n: Notification) => !n.is_read && !read.has(n.id);

  useEffect(() => {
    onUnread(!!data?.some(isUnread));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isUnread closes over `read`, which is listed
  }, [data, read, onUnread]);

  const open = (n: Notification) => {
    if (!isUnread(n)) return;
    setRead((prev) => new Set(prev).add(n.id));
    void notificationsApi.markRead(n.id).catch(() => reload());
  };
  const markAll = () => {
    setRead(new Set((data ?? []).map((n) => n.id)));
    void notificationsApi.markAllRead().catch(() => reload());
  };

  return (
    <Screen testID="tab-notices-screen" edges={["left", "right"]} refreshing={loading && data !== null} onRefresh={reload}>
      <View style={{ padding: space[5], flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Txt variant="title">{t("officer_app.tabs.notices")}</Txt>
        {data?.some(isUnread) ? <SmallButton testID="notices-mark-all" title={t("notifications.mark_all_read")} onPress={markAll} /> : null}
      </View>
      {view ? (
        <StateView
          state={view}
          onRetry={reload}
          role={role}
          area={t("officer_app.areas.notices")}
          emptyTitle={t("officer_app.notices.empty_title")}
          emptyBody={t("officer_app.notices.empty_body")}
        />
      ) : (
        data!.map((n) => (
          <Row
            key={n.id}
            testID={`notice-${n.id}`}
            glyph={isUnread(n) ? "●" : "○"}
            strong={isUnread(n)}
            minHeight={88}
            title={n.title}
            lines={[n.message, formatWhen(n.created_at)].filter(Boolean)}
            onPress={() => open(n)}
          />
        ))
      )}
    </Screen>
  );
}
