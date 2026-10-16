/**
 * 「问一问」 (Design batch 39, O-13a–c): an entry at the right of every tab's top bar, opening a
 * bottom sheet. The console's assistant (`/assist/`, the officer token), answered in one piece.
 *
 * The conversation lives in the shell (`useOfficerAssist`), not in the sheet or a tab: switching
 * tabs, closing the sheet and opening it again keep it (「会话跟着弹层走」). The sheet's children
 * unmount when it closes, so nothing that must survive is kept inside it.
 *
 * NEVER A SILENT RESUME. The server continues "the same page within 30 minutes" when a question
 * carries no conversation; the App always says which: the id it holds, or `new: true`. A
 * conversation opened from history keeps the page it was asked on — the server reads the context
 * from the conversation, not from the tab the officer is on now.
 */
import {
  isOfficerEmptyAnswer,
  officerAssistApi,
  officerAssistErrorCode,
  type OfficerAssistConversation,
  type OfficerAssistScreen,
} from "@soulledger/core/api/officer-assist";
import { officerAssistSuggestions } from "@soulledger/core/config/officerAssistSuggestions";
import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { ActionButton, type TabKey } from "./kit";
import { useSession } from "./session";
import { Button, Input, Loader, Notice, SectionLabel, Sheet, Txt, space, useI18n, useTheme } from "./shared";

/**
 * Each tab as a page the backend knows (`OFFICER_SCREENS`). 待办 → `workflow`: its first and main
 * group is workflow approval nodes (审批节点), and the web's 待我审批 lives on the workflow page;
 * the suggestion table's workflow pair ("待我审批的有几件？") is what the to-do list is for.
 */
export const TAB_SCREEN: Record<TabKey, OfficerAssistScreen> = {
  todo: "workflow",
  queue: "judgment",
  search: "souls",
  notices: "notifications",
  me: "profile",
};

/** A conversation's page by the App's tab names; one asked on another web page is 「其他页」. */
function usePageName() {
  const { t } = useI18n();
  return (screen: OfficerAssistScreen) => {
    const tab = (Object.keys(TAB_SCREEN) as TabKey[]).find((k) => TAB_SCREEN[k] === screen);
    return tab ? t(`officer_app.tabs.${tab}`) : t("officer_assist.page_other");
  };
}

interface Line {
  role: "user" | "assistant";
  text: string;
}

interface Thread {
  id: string | null;
  /** The page it was first asked on; null until then (a new one asks with the current tab's). */
  screen: OfficerAssistScreen | null;
  lines: Line[];
  /** Opened from history: the strip and 「接着问…」 come from it. */
  resumed: OfficerAssistConversation | null;
}

const EMPTY: Thread = { id: null, screen: null, lines: [], resumed: null };

const pad = (n: number) => String(n).padStart(2, "0");
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const md = (d: Date) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function useOfficerAssist() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [thread, setThread] = useState<Thread>(EMPTY);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return { open, setOpen, view, setView, thread, setThread, draft, setDraft, busy, setBusy, failure, setFailure };
}
export type OfficerAssist = ReturnType<typeof useOfficerAssist>;

/** The tab's top bar: its name, and 「问一问」 at the right (O-13a). No floating button: it would cover the lists' bottom bars. */
export function TabHead({ tab, onAsk }: { tab: TabKey; onAsk: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const name = t(`officer_app.tabs.${tab}`);
  return (
    <View style={[styles.head, { borderBottomColor: theme.hair }]}>
      <Txt variant="title" numberOfLines={1} style={styles.grow}>
        {name}
      </Txt>
      <Pressable
        testID="assist-entry"
        accessibilityRole="button"
        accessibilityLabel={t("officer_app.assist.entry_label", { page: name })}
        onPress={onAsk}
        style={({ pressed }) => [styles.entry, { borderColor: theme.inkSubtle, backgroundColor: pressed ? theme.hair : "transparent" }]}
      >
        <Txt variant="nav" accessibilityElementsHidden importantForAccessibility="no">
          ?
        </Txt>
        <Txt variant="nav">{t("officer_app.assist.entry")}</Txt>
      </Pressable>
    </View>
  );
}

export function AssistSheet({ assist, tab }: { assist: OfficerAssist; tab: TabKey }) {
  const { t } = useI18n();
  const theme = useTheme();
  const { setOpen } = assist;
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <Sheet open={assist.open} onClose={close} edge={theme.hair} closeLabel={t("officer_assist.close")}>
      <View testID="assist-sheet" style={{ paddingBottom: space[5] }}>
        {assist.view === "history" ? <History assist={assist} /> : <Chat assist={assist} tab={tab} onClose={close} />}
      </View>
    </Sheet>
  );
}

function HeadButton({ label, onPress, testID, accessibilityLabel }: { label: string; onPress: () => void; testID: string; accessibilityLabel?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={styles.headButton}>
      <Txt variant="nav">{label}</Txt>
    </Pressable>
  );
}

function Chat({ assist, tab, onClose }: { assist: OfficerAssist; tab: TabKey; onClose: () => void }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const pageName = usePageName();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "VIEWER";
  const { height } = useWindowDimensions();
  const { thread, setThread, draft, setDraft, busy, setBusy, failure, setFailure } = assist;
  const screen = thread.screen ?? TAB_SCREEN[tab];
  const resumed = thread.resumed;
  const startNew = () => {
    setThread(EMPTY);
    setFailure(null);
    setDraft("");
  };

  const send = (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    setBusy(true);
    setFailure(null);
    officerAssistApi
      .ask({ question, screen, ...(thread.id ? { conversation_id: thread.id } : { new: true }) })
      .then((answer) => {
        const reply = answer.answer.content;
        setThread((th) => ({
          ...th,
          id: answer.conversation_id,
          screen,
          lines: [...th.lines, { role: "user", text: question }, { role: "assistant", text: reply }],
        }));
        setDraft("");
        // A screen reader is told the answer has landed (the desk's 「已回答」).
        AccessibilityInfo.announceForAccessibility(t("officer_assist.answered"));
      })
      .catch((e: unknown) => {
        // The question stays in the box: "你的问题还在".
        setDraft(question);
        const code = officerAssistErrorCode(e);
        // Deleted meanwhile (here or on the desk): the retry starts a new conversation, said so by `new`.
        if (code === "not_found") setThread((th) => ({ ...th, id: null, resumed: null }));
        setFailure(
          code === "rate_limited"
            ? t("officer_assist.limited_later")
            : code === "assistant_not_configured"
              ? t("officer_assist.not_configured_title")
              : t("officer_assist.unanswered")
        );
      })
      .finally(() => setBusy(false));
  };

  const suggestions = officerAssistSuggestions(role, screen, locale);
  return (
    <View>
      <View style={[styles.sheetHead, { borderBottomColor: theme.hair }]}>
        {resumed ? <HeadButton testID="assist-back-history" label="‹" accessibilityLabel={t("officer_assist.history_title")} onPress={() => assist.setView("history")} /> : null}
        <Txt variant="section" style={styles.grow}>
          {t("officer_assist.title")}
          {resumed ? null : (
            <Txt variant="caption" tone="muted">
              {`  ${t("officer_assist.read_only")}`}
            </Txt>
          )}
        </Txt>
        {thread.lines.length > 0 ? <HeadButton testID="assist-new" label={t("officer_assist.new")} onPress={startNew} /> : null}
        {resumed ? null : <HeadButton testID="assist-history" label={t("officer_assist.history")} onPress={() => assist.setView("history")} />}
        <HeadButton testID="assist-close" label="×" accessibilityLabel={t("officer_assist.close")} onPress={onClose} />
      </View>
      {resumed && !isToday(resumed.last_active_at) ? (
        <View testID="assist-resumed" accessibilityRole="text" style={[styles.strip, { backgroundColor: theme.s2 }]}>
          <Txt variant="caption" tone="muted">
            {t("officer_app.assist.resumed", { date: md(new Date(resumed.last_active_at)), page: pageName(resumed.screen) })}
          </Txt>
        </View>
      ) : null}
      <ScrollView style={{ maxHeight: height * 0.55 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {thread.lines.length === 0 ? (
          <View testID="assist-suggestions" style={{ gap: space[3] }}>
            <Txt variant="caption" tone="muted">
              {t("officer_assist.suggest_intro", { page: t(`officer_app.tabs.${tab}`) })}
            </Txt>
            {suggestions.map((q, i) => (
              <Pressable
                key={q}
                testID={`assist-suggestion-${i}`}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => send(q)}
                style={({ pressed }) => [styles.suggestion, { borderColor: theme.inkSubtle, backgroundColor: pressed ? theme.hair : "transparent" }]}
              >
                <Txt variant="bodyLg">{q}</Txt>
              </Pressable>
            ))}
            <Txt variant="caption" tone="subtle">
              {t("officer_assist.suggest_hint")}
            </Txt>
          </View>
        ) : (
          <>
            {thread.lines.map((line, i) => (
              <View key={i} testID={`ask-${line.role}`} style={{ gap: space[1] }}>
                <Txt variant="caption" tone="muted">
                  {line.role === "user" ? "›" : "◇"}
                </Txt>
                <Txt variant="bodyLg">{line.role === "assistant" && isOfficerEmptyAnswer(line.text) ? t("officer_assist.cannot_answer") : line.text}</Txt>
              </View>
            ))}
            <Txt variant="caption" tone="subtle">
              {t("officer_assist.footnote")}
            </Txt>
          </>
        )}
        {failure ? <Notice tone="neg" testID="ask-failure">{failure}</Notice> : null}
      </ScrollView>
      <View style={styles.composer}>
        <Input
          testID="ask-input"
          label={t("officer_assist.title")}
          placeholder={t(resumed ? "officer_app.assist.continue_placeholder" : "officer_assist.placeholder")}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Button testID="ask-send" title={t("officer_assist.send")} busy={busy} onPress={() => send(draft)} />
      </View>
    </View>
  );
}

type ListState = { status: "loading" | "error" } | { status: "done"; rows: OfficerAssistConversation[] };

function History({ assist }: { assist: OfficerAssist }) {
  const { t } = useI18n();
  const theme = useTheme();
  const pageName = usePageName();
  const { height } = useWindowDimensions();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [doomed, setDoomed] = useState<OfficerAssistConversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<"delete_failed" | "open_failed" | null>(null);

  const load = useCallback(() => {
    setList({ status: "loading" });
    officerAssistApi.conversations().then(
      (rows) => setList({ status: "done", rows }),
      () => setList({ status: "error" })
    );
  }, []);
  useEffect(load, [load]);

  const back = () => assist.setView("chat");
  const startNew = () => {
    assist.setThread(EMPTY);
    assist.setFailure(null);
    assist.setDraft("");
    back();
  };

  /** Read again on open: the messages as they are now, and a conversation deleted elsewhere is 「没能打开」, not a stale copy. */
  const openOne = (id: string) => {
    setNotice(null);
    officerAssistApi.conversations().then(
      (rows) => {
        const found = rows.find((c) => c.id === id);
        if (!found) {
          setNotice("open_failed");
          setList({ status: "done", rows });
          return;
        }
        assist.setThread({
          id: found.id,
          screen: found.screen,
          lines: found.messages.map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.content })),
          resumed: found,
        });
        assist.setFailure(null);
        assist.setDraft("");
        back();
      },
      () => setNotice("open_failed")
    );
  };

  const confirmDelete = () => {
    if (!doomed) return;
    const id = doomed.id;
    setDeleting(true);
    setNotice(null);
    officerAssistApi
      .deleteConversation(id)
      .then(
        () => {
          if (assist.thread.id === id) assist.setThread(EMPTY);
          setList((l) => (l.status === "done" ? { status: "done", rows: l.rows.filter((c) => c.id !== id) } : l));
        },
        () => setNotice("delete_failed")
      )
      .finally(() => {
        setDeleting(false);
        setDoomed(null);
      });
  };

  const rows = list.status === "done" ? list.rows : [];
  const today = rows.filter((c) => isToday(c.last_active_at));
  const earlier = rows.filter((c) => !isToday(c.last_active_at));
  const row = (c: OfficerAssistConversation) => {
    const at = new Date(c.last_active_at);
    const when = isToday(c.last_active_at) ? t("officer_app.assist.time_today", { time: hm(at) }) : `${md(at)} ${hm(at)}`;
    return (
      <View key={c.id} testID={`assist-row-${c.id}`} style={[styles.historyRow, { borderBottomColor: theme.hair }]}>
        <Pressable accessibilityRole="button" onPress={() => openOne(c.id)} style={[styles.grow, { gap: space[1], paddingVertical: space[3] }]}>
          <Txt variant="caption" tone="muted">{`${pageName(c.screen)} · ${when}`}</Txt>
          <Txt variant="body" numberOfLines={2}>
            {c.first_question}
          </Txt>
        </Pressable>
        <Pressable testID={`assist-delete-${c.id}`} accessibilityRole="button" accessibilityLabel={t("officer_assist.delete_label")} onPress={() => setDoomed(c)} style={styles.headButton}>
          <Txt variant="nav" tone="muted">
            ×
          </Txt>
        </Pressable>
      </View>
    );
  };

  return (
    <View>
      <View style={[styles.sheetHead, { borderBottomColor: theme.hair }]}>
        <HeadButton testID="assist-back" label="‹" accessibilityLabel={t("officer_assist.back_label")} onPress={back} />
        <Txt variant="section" style={styles.grow}>
          {t("officer_assist.history_title")}
        </Txt>
        <HeadButton testID="assist-new" label={t("officer_assist.new")} onPress={startNew} />
      </View>
      {doomed ? (
        // In the sheet, not a second modal over it (a modal over a sheet is unreliable).
        <View testID="assist-delete-confirm" accessibilityViewIsModal style={[styles.body, { borderTopWidth: 2, borderTopColor: theme.negStrong }]}>
          <Txt variant="section">{t("officer_assist.delete_title")}</Txt>
          <Txt variant="body" tone="muted">
            {t("officer_assist.delete_body", { page: pageName(doomed.screen) })}
          </Txt>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <ActionButton testID="assist-delete-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={() => setDoomed(null)} />
            <ActionButton testID="assist-delete-ok" kind="ink" busy={deleting} title={t("officer_assist.delete_confirm")} onPress={confirmDelete} />
          </View>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={styles.body}>
          <Txt variant="caption" tone="subtle">
            {t("officer_assist.retention")}
          </Txt>
          {notice ? <Notice tone="neg" testID={`assist-${notice}`}>{t(notice === "open_failed" ? "officer_app.assist.open_failed" : "officer_assist.delete_failed")}</Notice> : null}
          {list.status === "loading" ? (
            <Loader />
          ) : list.status === "error" ? (
            <Notice tone="neg" testID="assist-history-failed" onRetry={load}>
              {t("officer_assist.history_failed")}
            </Notice>
          ) : rows.length === 0 ? (
            <Txt testID="assist-history-empty" variant="body" tone="muted">
              {t("officer_assist.history_empty")}
            </Txt>
          ) : (
            <>
              {today.length > 0 ? (
                <View testID="assist-group-today">
                  <SectionLabel>{t("officer_assist.today")}</SectionLabel>
                  {today.map(row)}
                </View>
              ) : null}
              {earlier.length > 0 ? (
                <View testID="assist-group-earlier">
                  <SectionLabel>{t("officer_app.assist.group_earlier")}</SectionLabel>
                  {earlier.map(row)}
                </View>
              ) : null}
              <Txt testID="assist-history-end" variant="caption" tone="subtle">
                {t("officer_assist.history_end")}
              </Txt>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[5], paddingVertical: space[2], borderBottomWidth: 1 },
  entry: { flexDirection: "row", alignItems: "center", gap: space[1], minHeight: 44, paddingHorizontal: space[3], borderWidth: 1 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[3], minHeight: 52, borderBottomWidth: 1 },
  headButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: space[2] },
  strip: { paddingHorizontal: space[5], paddingVertical: space[2] },
  body: { paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[3], gap: space[4] },
  suggestion: { minHeight: 52, justifyContent: "center", paddingHorizontal: space[4], paddingVertical: space[3], borderWidth: 1 },
  composer: { paddingHorizontal: space[5], gap: space[3] },
  historyRow: { flexDirection: "row", alignItems: "center", gap: space[2], borderBottomWidth: 1 },
});
