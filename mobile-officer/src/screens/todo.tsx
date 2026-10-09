/** 待办: the four kinds of item waiting on this officer, grouped, each group titled with its count. */
import { officerAppApi, type TodoItem, type TodoKind } from "@soulledger/core/api/officer-app";
import { useCallback } from "react";
import { View } from "react-native";

import { Row, StateView, viewStateOf } from "../kit";
import { TODO_GROUPS, isDenied, isTodoKind, todoTitle } from "../rules";
import { useSession } from "../session";
import { Screen, SectionLabel, Txt, space, useI18n, useRemote } from "../shared";
import { formatWhen } from "../format";

export interface ItemRef {
  kind: TodoKind;
  id: string;
}

export function TodoTab({ onOpen, highlight }: { onOpen: (item: ItemRef) => void; highlight: ItemRef | null }) {
  const { t } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  // The shell gives this tab a new `key` whenever the list should ask again (back from a detail, a push).
  const load = useCallback(() => officerAppApi.todo().then((r) => r.data), []);
  const { data, error, loading, reload } = useRemote(load);
  const view = viewStateOf({ data, error }, (d) => TODO_GROUPS.every((g) => d[g.field].count === 0), isDenied);

  return (
    <Screen testID="tab-todo-screen" edges={["left", "right"]} refreshing={loading && data !== null} onRefresh={reload}>
      <View style={{ padding: space[5] }}>
        <Txt variant="title">{t("officer_app.todo.title")}</Txt>
      </View>
      {view ? (
        <StateView
          state={view}
          onRetry={reload}
          role={role}
          area={t("officer_app.areas.todo")}
          emptyTitle={t("officer_app.todo.empty_title")}
          emptyBody={t("officer_app.todo.empty_body")}
        />
      ) : (
        TODO_GROUPS.map(({ field, kind, label }) => {
          const group = data![field];
          if (group.count === 0) return null;
          return (
            <View key={kind} testID={`todo-group-${kind}`}>
              <View style={{ paddingHorizontal: space[5], paddingVertical: space[3] }}>
                <SectionLabel>{`${t(label)} · ${group.count}`}</SectionLabel>
              </View>
              {group.items.map((item) => (
                <TodoRow key={`${item.kind}:${item.id}`} item={item} highlight={highlight?.kind === item.kind && highlight.id === item.id} onOpen={onOpen} />
              ))}
            </View>
          );
        })
      )}
    </Screen>
  );
}

function TodoRow({ item, highlight, onOpen }: { item: TodoItem; highlight: boolean; onOpen: (item: ItemRef) => void }) {
  const { t } = useI18n();
  const lines = [item.soul_code, item.node_name, formatWhen(item.created_at)].filter((x): x is string => !!x);
  return (
    <Row
      testID={`todo-row-${item.kind}-${item.id}`}
      glyph="◐"
      strong
      title={todoTitle(item, t) || t(`officer_app.kinds.${item.kind}`)}
      lines={lines}
      highlight={highlight}
      right={<Txt tone="muted">›</Txt>}
      onPress={() => {
        if (isTodoKind(item.target.kind)) onOpen({ kind: item.target.kind, id: item.target.id });
      }}
    />
  );
}
