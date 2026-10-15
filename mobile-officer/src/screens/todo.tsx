/** 待办: the kinds of item waiting on this officer, grouped, each group titled with its count. */
import { officerAppApi, type Todo, type TodoItem, type TodoKind } from "@soulledger/core/api/officer-app";
import { platform } from "@soulledger/core/platform";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { discardReply, retryReply, useOutbox, type OutboxEntry } from "../outbox";
import { useCachedRemote } from "../readCache";

import { FilterChips, Row, StateView, viewStateOf } from "../kit";
import { TODO_GROUPS, isDenied, isTodoKind, todoTitle, type ItemKind } from "../rules";
import { useSession } from "../session";
import { Button, Notice, Screen, SectionLabel, SmallButton, Txt, publishVoiceNumber, space, useI18n, useTheme } from "../shared";
import { formatWhen } from "../format";

export interface ItemRef {
  kind: ItemKind;
  id: string;
}

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

/** A server that predates a group (an older build) does not send it: that group is empty, not an error. */
const countOf = (data: Todo, field: keyof Todo): number => data[field]?.count ?? 0;

export function TodoTab({ onOpen, highlight }: { onOpen: (item: ItemRef) => void; highlight: ItemRef | null }) {
  const { t, locale } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  // The shell gives this tab a new `key` whenever the list should ask again (back from a detail, a push).
  const load = useCallback(() => officerAppApi.todo().then((r) => r.data), []);
  const { data, error, loading, reload } = useCachedRemote("list:todo", load);
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
  const kinds = chosen.length === 0 ? "" : shown.map((g) => t(g.label)).join(locale === "zh-Hans" ? "、" : ", "); // Design batch 29: en / egy use ", "
  const rowsShown = data ? shown.reduce((sum, g) => sum + countOf(data, g.field), 0) : 0;
  const view = viewStateOf({ data, error }, (d) => TODO_GROUPS.every((g) => countOf(d, g.field) === 0), isDenied);

  return (
    <Screen testID="tab-todo-screen" edges={["left", "right"]} refreshing={loading && data !== null} onRefresh={reload}>
      <View style={{ padding: space[5] }}>
        <Txt variant="title">{t("officer_app.todo.title")}</Txt>
      </View>
      <OutboxRows onOpen={onOpen} />
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
          {chosen.length > 0 ? (
            <View style={styles.summary}>
              <Txt testID="todo-filter-summary" variant="body" tone="muted" style={styles.summaryText}>
                {t("officer_app.todo.filter_summary", { kinds, n: String(rowsShown) })}
              </Txt>
              <Pressable testID="todo-filter-clear" accessibilityRole="button" accessibilityLabel={t("officer_app.todo.filter_clear")} hitSlop={{ left: 8, right: 8 }} onPress={clear} style={styles.summaryClear}>
                <Txt variant="body">{t("officer_app.todo.filter_clear")}</Txt>
              </Pressable>
            </View>
          ) : null}
          {rowsShown === 0 ? (
            <>
              <StateView state="empty" emptyTitle={t("officer_app.todo.filter_empty_title", { kinds })} emptyBody={t("officer_app.todo.filter_empty_body")} />
              <View style={{ paddingHorizontal: space[5] }}>
                <Button testID="todo-filter-clear-empty" kind="secondary" title={t("officer_app.todo.filter_clear")} onPress={clear} />
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

/** 回信 queued offline: a row with the dashed 「待发出」 tag, or, when the send failed, why and what can be done. */
function OutboxRows({ onOpen }: { onOpen: (item: ItemRef) => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <>
      {useOutbox().map((entry) =>
        entry.state === "queued" ? (
          <Row
            key={entry.id}
            testID={`outbox-row-${entry.id}`}
            glyph="◐"
            strong
            title={t("officer_app.outbox.row", { name: entry.name })}
            lines={[t("officer_app.outbox.auto")]}
            right={
              <View testID={`outbox-pending-${entry.id}`} style={[styles.pending, { borderColor: theme.inkSubtle }]}>
                <Txt variant="caption">{t("officer_app.outbox.pending")}</Txt>
              </View>
            }
            onPress={() => onOpen({ kind: "letter", id: entry.id })}
          />
        ) : (
          <OutboxFailure key={entry.id} entry={entry} onOpen={onOpen} />
        ),
      )}
    </>
  );
}

function OutboxFailure({ entry, onOpen }: { entry: OutboxEntry; onOpen: (item: ItemRef) => void }) {
  const { t } = useI18n();
  const reason = entry.reason ?? "retry";
  return (
    <View testID={`outbox-failed-${entry.id}`} style={styles.failure}>
      <Notice tone="neg">{`! ${t("officer_app.outbox.failed_title", { name: entry.name })}`}</Notice>
      <Txt testID={`outbox-reason-${entry.id}`} variant="body">
        {t(`officer_app.outbox.${reason}`)}
      </Txt>
      <View style={styles.actions}>
        {reason === "retry" ? <SmallButton testID={`outbox-retry-${entry.id}`} title={t("common.retry")} onPress={() => void retryReply(entry.id)} /> : null}
        {reason === "answered" || reason === "archived" ? (
          <SmallButton testID={`outbox-view-${entry.id}`} title={t("officer_app.outbox.view_existing")} onPress={() => onOpen({ kind: "letter", id: entry.id })} />
        ) : null}
        <SmallButton testID={`outbox-discard-${entry.id}`} title={t("officer_app.outbox.discard")} onPress={() => discardReply(entry.id)} />
      </View>
    </View>
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

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], paddingHorizontal: space[5] },
  summaryText: { flex: 1 },
  pending: { borderWidth: 1, borderStyle: "dashed", paddingHorizontal: space[2], paddingVertical: 2 },
  failure: { paddingHorizontal: space[5], paddingVertical: space[3], gap: space[2] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  summaryClear: { minHeight: 44, justifyContent: "center" },
});
