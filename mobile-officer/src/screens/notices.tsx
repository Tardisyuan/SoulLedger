/** 通知: the same data as the desk's notification centre. Unread is ● and bold, read is ○. */
import { notificationsApi, type Notification } from "@soulledger/core/api/notifications";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { formatWhen } from "../format";
import { RefreshFailed, Row, StateView, viewStateOf } from "../kit";
import { MoreRow, useMoreRows } from "../paged";
import { useCachedRemote, useOnBump } from "../readCache";
import { isDenied, landingGoneKey, noticeIsDeskOnly, noticeLanding, type Landing } from "../rules";
import { useSession } from "../session";
import { Screen, SmallButton, space, useI18n } from "../shared";

/**
 * `onRead`: a mark reached the server, or the list was pulled -- the shell asks for the unread count again (the tab bar's ●).
 * `gone`: notices whose item turned out to be gone (O-c) -- greyed, and they no longer open anything.
 */
export function NoticesTab({ onRead, onLand, gone, version }: { onRead?: () => void; onLand?: (landing: Landing) => void; gone?: ReadonlySet<string>; version?: number }) {
  const { t } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const load = useCallback(() => notificationsApi.list().then((r) => r.data), []);
  const { data: firstPage, error, loading, reload } = useCachedRemote("list:notices", load);
  useOnBump(version, reload); // the shell's bump: reloaded in place
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
      {/* No big title (as on 待办): the top bar already says 通知. 全部已读 stays, right-aligned. */}
      {data?.some(isUnread) ? (
        <View style={{ paddingHorizontal: space[5], paddingTop: space[3], flexDirection: "row", justifyContent: "flex-end" }}>
          <SmallButton testID="notices-mark-all" title={t("notifications.mark_all_read")} onPress={markAll} />
        </View>
      ) : null}
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
            lines={[...(n.message ? [n.message] : []), { one: formatWhen(n.created_at) }, ...(noticeIsDeskOnly(n) ? [{ one: t("officer_app.notices.on_desk") }] : [])]}
            gone={!!gone?.has(landingGoneKey(noticeLanding(n)) ?? "")}
            onPress={() => open(n)}
          />
        ))
      )}
      <MoreRow more={more} state={moreState} />
    </Screen>
  );
}
