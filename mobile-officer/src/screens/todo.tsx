/** 待办: the kinds of item waiting on this officer, grouped, each group titled with its count. */
import { officerAppApi, type Todo, type TodoItem, type TodoKind } from "@soulledger/core/api/officer-app";
import { platform } from "@soulledger/core/platform";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { FilterChips, Row, StateView, viewStateOf } from "../kit";
import { TODO_GROUPS, isDenied, isTodoKind, todoTitle, type ItemKind } from "../rules";
import { useSession } from "../session";
import { Button, Screen, SectionLabel, Txt, publishVoiceNumber, space, useI18n, useRemote } from "../shared";
import { formatWhen } from "../format";

export interface ItemRef {
  kind: ItemKind;
  id: string;
}

/** A server that predates a group (an older build) does not send it: that group is empty, not an error. */
/** 类型筛选 (Design batch 28 O2): the chosen kinds, on this phone. Nothing chosen = all. */
export const TODO_FILTER_KEY = "officer_todo_filter";

function readFilter(): TodoKind[] {
  try {
    const parsed: unknown = JSON.parse(platform().persistent.get(TODO_FILTER_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isTodoKind) : [];
  } catch {
    return [];
  }
}

const countOf = (data: Todo, field: keyof Todo): number => data[field]?.count ?? 0;

export function TodoTab({ onOpen, highlight }: { onOpen: (item: ItemRef) => void; highlight: ItemRef | null }) {
  const { t } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  // The shell gives this tab a new `key` whenever the list should ask again (back from a detail, a push).
  const load = useCallback(() => officerAppApi.todo().then((r) => r.data), []);
  const { data, error, loading, reload } = useRemote(load);
  // Siri's 「有几件待办」 speaks this total back (voiceCache.ts): a number and a time, never a case.
  useEffect(() => {
    if (data) publishVoiceNumber("todo", TODO_GROUPS.reduce((sum, g) => sum + countOf(data, g.field), 0));
  }, [data]);
  const [chosen, setChosen] = useState<TodoKind[]>(readFilter);
  const toggle = (kind: TodoKind) =>
    setChosen((prev) => {
      const next = prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind];
      if (next.length === 0) platform().persistent.remove(TODO_FILTER_KEY);
      else platform().persistent.set(TODO_FILTER_KEY, JSON.stringify(next));
      return next;
    });
  const clear = () => {
    platform().persistent.remove(TODO_FILTER_KEY);
    setChosen([]);
  };
  const shown = TODO_GROUPS.filter((g) => chosen.length === 0 || chosen.includes(g.kind));
  const view = viewStateOf({ data, error }, (d) => TODO_GROUPS.every((g) => countOf(d, g.field) === 0), isDenied);

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
        <>
          <FilterChips
            testID="todo-filter"
            options={TODO_GROUPS.map((g) => ({ key: g.kind, label: t(g.label), count: countOf(data!, g.field) }))}
            selected={chosen}
            onToggle={toggle}
          />
          {shown.every((g) => countOf(data!, g.field) === 0) ? (
            <>
              <StateView state="empty" emptyTitle={t("officer_app.todo.filter_empty_title")} emptyBody={t("officer_app.todo.filter_empty_body")} />
              <View style={{ paddingHorizontal: space[5] }}>
                <Button testID="todo-filter-clear" kind="secondary" title={t("officer_app.todo.filter_clear")} onPress={clear} />
              </View>
            </>
          ) : null}
        {shown.map(({ field, kind, label }) => {
          const group = data![field];
          if (!group || group.count === 0) return null;
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
        })}
        </>
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
