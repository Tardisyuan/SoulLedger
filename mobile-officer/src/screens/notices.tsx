/** 通知: the same data as the desk's notification centre. Unread is ● and bold, read is ○. */
import { notificationsApi, type Notification } from "@soulledger/core/api/notifications";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { formatWhen } from "../format";
import { RefreshFailed, Row, StateView, viewStateOf } from "../kit";
import { MoreRow, useMoreRows } from "../paged";
import { useCachedRemote } from "../readCache";
import { isDenied, noticeIsDeskOnly, noticeLanding, type Landing } from "../rules";
import { useSession } from "../session";
import { Screen, SmallButton, Txt, space, useI18n } from "../shared";

/** `onRead`: a mark reached the server, or the list was pulled -- the shell asks for the unread count again (the tab bar's ●). */
export function NoticesTab({ onRead, onLand }: { onRead?: () => void; onLand?: (landing: Landing) => void }) {
  const { t } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const load = useCallback(() => notificationsApi.list().then((r) => r.data), []);
  const { data: firstPage, error, loading, reload } = useCachedRemote("list:notices", load);
  const fetchPage = useCallback((page: number) => notificationsApi.list({ page: String(page) }).then((r) => r.data), []);
  const { rows: data, more, moreState } = useMoreRows(firstPage, fetchPage);
  // Marking is local first (the row turns ○ at once); a failure puts it back on the next reload.
  const [read, setRead] = useState<ReadonlySet<number>>(new Set());
  const view = viewStateOf({ data, error }, (rows) => rows.length === 0, isDenied);
  const isUnread = (n: Notification) => !n.is_read && !read.has(n.id);

  const open = (n: Notification) => {
    if (isUnread(n)) {
      setRead((prev) => new Set(prev).add(n.id));
      notificationsApi.markRead(n.id).then(() => onRead?.(), () => void reload());
    }
    // Read or not, a row that names an item opens it -- the same landing as a tapped push.
    const landing = noticeLanding(n);
    if (landing) onLand?.(landing);
  };
  const markAll = () => {
    setRead(new Set((data ?? []).map((n) => n.id)));
    notificationsApi.markAllRead().then(() => onRead?.(), () => void reload());
  };

  return (
    <Screen
      testID="tab-notices-screen"
      edges={["left", "right"]}
      refreshing={loading && data !== null}
      onRefresh={() => {
        onRead?.();
        return reload();
      }}
    >
      <View style={{ padding: space[5], flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Txt variant="title">{t("officer_app.tabs.notices")}</Txt>
        {data?.some(isUnread) ? <SmallButton testID="notices-mark-all" title={t("notifications.mark_all_read")} onPress={markAll} /> : null}
      </View>
      <RefreshFailed data={data} error={error} onRetry={reload} />
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
            glyphLabel={isUnread(n) ? t("soul_inbox.unread") : undefined}
            strong={isUnread(n)}
            minHeight={88}
            title={n.title}
            lines={[n.message, formatWhen(n.created_at), noticeIsDeskOnly(n) ? t("officer_app.notices.on_desk") : ""].filter(Boolean)}
            onPress={() => open(n)}
          />
        ))
      )}
      <MoreRow more={more} state={moreState} />
    </Screen>
  );
}
