/** 待办: the kinds of item waiting on this officer, grouped, each group titled with its count. */
import { officerAppApi, type Todo, type TodoGroup, type TodoItem, type TodoItemExtra, type TodoKind } from "@soulledger/core/api/officer-app";
import { platform } from "@soulledger/core/platform";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";

import { discardReply, retryReply, useOutbox, type OutboxEntry } from "../outbox";
import { MoreRow, useMoreRows } from "../paged";
import { unassignedShown } from "../todoFacts";
import { useCachedRemote } from "../readCache";

import { ActionButton, FilterChips, RefreshFailed, Row, StateView, viewStateOf } from "../kit";
import { TODO_GROUPS, VIEW_ONLY_KINDS, deskUrl, goneKey, isDenied, isTodoKind, pickRowLines, todoTitle, type ItemKind } from "../rules";
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

/** `gone`: rows whose detail turned out to be gone (O-c), greyed and not pressable -- keyed by `goneKey`. */
export function TodoTab({ onOpen, highlight, gone }: { onOpen: (item: ItemRef) => void; highlight: ItemRef | null; gone?: ReadonlySet<string> }) {
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
  // 未分配的书信 is not a filter chip (it is not "on me"): it shows when no filter is chosen.
  const unassigned = data?.unassigned_letters ?? null;
  const rowsShown = (data ? shown.reduce((sum, g) => sum + countOf(data, g.field), 0) : 0) + (chosen.length === 0 ? (unassigned?.count ?? 0) : 0);
  const view = viewStateOf({ data, error }, (d) => TODO_GROUPS.every((g) => countOf(d, g.field) === 0) && (d.unassigned_letters?.count ?? 0) === 0, isDenied);

  return (
    // No big title (Design 第四十批 第四节 5): the top bar already says 待办, as on the other four tabs.
    <Screen testID="tab-todo-screen" edges={["left", "right"]} refreshing={loading && data !== null} onRefresh={reload}>
      <OutboxRows onOpen={onOpen} />
      <RefreshFailed data={data} error={error} onRetry={reload} />
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
          return <TodoGroupRows key={kind} kind={kind} label={t(label)} group={group} highlight={highlight} gone={gone} onOpen={onOpen} />;
        })}
        {chosen.length === 0 && unassigned && unassigned.count > 0 ? <UnassignedRows group={unassigned} highlight={highlight} gone={gone} onOpen={onOpen} /> : null}
        </>
      )}
    </Screen>
  );
}

/**
 * One group: the server sends the first 10; 「加载更多」 asks for the next 10 of this group only.
 * A view-only group (受刑计划变更, O-f) has rows that open nothing and one bar under them: 「在电脑上处理」.
 */
function TodoGroupRows({
  kind,
  label,
  group,
  highlight,
  gone,
  onOpen,
}: {
  kind: TodoKind | "unassigned_letter";
  label: string;
  group: TodoGroup;
  highlight: ItemRef | null;
  gone?: ReadonlySet<string>;
  onOpen: (item: ItemRef) => void;
}) {
  const { t } = useI18n();
  const viewOnly = (VIEW_ONLY_KINDS as readonly string[]).includes(kind);
  const size = group.items.length;
  const first = useMemo(() => ({ results: group.items, next: size < group.count ? "more" : null }), [group, size]);
  const fetchPage = useCallback(
    (page: number) =>
      officerAppApi.todoGroup(kind, (page - 1) * size).then((r) => ({ results: r.data.items, next: (page - 1) * size + r.data.items.length < r.data.count ? "more" : null })),
    [kind, size]
  );
  const { rows, more, moreState } = useMoreRows(first, fetchPage);
  return (
    <View testID={`todo-group-${kind}`}>
      <View style={{ paddingHorizontal: space[5], paddingVertical: space[3] }}>
        <SectionLabel>{`${label} · ${group.count}`}</SectionLabel>
      </View>
      {rows!.map((item) => (
        <TodoRow key={`${item.kind}:${item.id}`} item={item} highlight={highlight?.kind === item.kind && highlight.id === item.id} gone={gone} onOpen={viewOnly ? undefined : onOpen} />
      ))}
      <MoreRow more={more} state={moreState} />
      {viewOnly ? (
        <View style={{ paddingHorizontal: space[5], paddingVertical: space[3] }}>
          <ActionButton
            testID={`todo-desk-${kind}`}
            kind="outline"
            title={t("officer_app.todo.on_desk_only")}
            onPress={() => void Share.share({ message: deskUrl({ kind: "sentence_change", id: "" }) }).catch(() => {})}
          />
        </View>
      ) : null}
    </View>
  );
}

/** 未分配的书信: 3 rows after 待回书信, 「全部 N 封」 opens the whole group (paged like the others). */
function UnassignedRows({ group, highlight, gone, onOpen }: { group: TodoGroup; highlight: ItemRef | null; gone?: ReadonlySet<string>; onOpen: (item: ItemRef) => void }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const label = t("officer_app.todo.groups.unassigned_letters");
  if (all) return <TodoGroupRows kind="unassigned_letter" label={label} group={group} highlight={highlight} gone={gone} onOpen={onOpen} />;
  return (
    <View testID="todo-group-unassigned_letter">
      <View style={{ paddingHorizontal: space[5], paddingVertical: space[3] }}>
        <SectionLabel>{`${label} · ${group.count}`}</SectionLabel>
      </View>
      {unassignedShown(group.items, false).map((item) => (
        <TodoRow key={`${item.kind}:${item.id}`} item={item} highlight={highlight?.kind === item.kind && highlight.id === item.id} gone={gone} onOpen={onOpen} />
      ))}
      {group.count > 3 ? (
        <View style={{ padding: space[5], alignItems: "center" }}>
          <SmallButton testID="todo-unassigned-all" title={t("officer_app.todo.see_all", { n: String(group.count) })} onPress={() => setAll(true)} />
        </View>
      ) : null}
    </View>
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
                <Txt variant="caption" numberOfLines={1}>{t("officer_app.outbox.pending")}</Txt>
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
      <Notice tone="neg">{t("officer_app.outbox.failed_title", { name: entry.name })}</Notice>
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

/** 帮助与反馈 (Design 第二十八批 S5): a letter that came from the soul app's feedback form carries one of four words. Only the tag. */
const FEEDBACK_TAGS: Record<string, string> = {
  account: "soul_inbox.feedback.tags.account",
  record: "soul_inbox.feedback.tags.record",
  app: "soul_inbox.feedback.tags.app",
  other: "soul_inbox.feedback.tags.other",
};

/** `onOpen` absent: a view-only row (no ›, nothing to press). */
function TodoRow({ item, highlight, gone, onOpen }: { item: TodoItem; highlight: boolean; gone?: ReadonlySet<string>; onOpen?: (item: ItemRef) => void }) {
  const { t, enumLabel } = useI18n();
  const tagKey = item.feedback_tag ? FEEDBACK_TAGS[item.feedback_tag] : undefined;
  const tag = tagKey ? t("soul_inbox.feedback.label", { category: t(tagKey) }) : null;
  // 受刑计划变更: which kind of request (加项 / 减项 · 重开审判), in the desk's words.
  const requestKind = (item as TodoItemExtra).request_kind;
  const request = requestKind ? t(`sentence_plan.request_kinds.${requestKind}`) : null;
  // S4: every line here is a label, an identifier or a time -- one line each, long-press for the whole.
  // 待我选站 (O-1): who convened it and where this realm stands, then 「已在门口等 · N 天」 or 「前面还有 N 站」 -- no time.
  const pick = item.kind === "pick" ? pickRowLines(item as TodoItemExtra, t, (civ) => enumLabel("souls.civilizations", civ).label ?? "") : null;
  const lines = pick
    ? [{ one: pick.meta }, { one: pick.wait }]
    : [tag, request, item.soul_code, item.node_name, formatWhen(item.created_at)].filter((x): x is string => !!x).map((one) => ({ one }));
  return (
    <Row
      testID={`todo-row-${item.kind}-${item.id}`}
      glyph={pick?.atGate ? "◌" : "◐"}
      strong
      title={todoTitle(item, t) || t(`officer_app.kinds.${item.kind}`)}
      lines={lines}
      highlight={highlight}
      gone={gone?.has(goneKey({ type: "todo", kind: item.target.kind, id: item.target.id }))}
      right={onOpen ? <Txt tone="muted">›</Txt> : undefined}
      onPress={
        onOpen
          ? () => {
              if (isTodoKind(item.target.kind)) onOpen({ kind: item.target.kind, id: item.target.id });
            }
          : undefined
      }
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
