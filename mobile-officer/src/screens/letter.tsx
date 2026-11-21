/**
 * 待回书信's thread: one soul's letters, oldest at the top, in ONE full-width column (Design v4 第六十四批).
 * Consecutive letters from the same person are one group under one line 「名字 · 来信/回信 … 时:分」; a new
 * day gets a divider. The rule is one sentence: this side's (the hall's) groups sit on a neutral `card2`
 * panel, the soul's are plain text on the canvas -- no alignment, no tail, no civilization colour. The
 * unanswered group of the soul's letters has a 2px ink line on its left; a reply still in the outbox is a
 * dashed, unfilled panel at the end. Above the footer, one line says whose turn it is and how long the
 * letter has waited (`@soulledger/core/domain/letters`). Below: 「模板」 (a bottom sheet whose pick is FILLED INTO the box, still editable,
 * never sent), the box, 「发出后不能撤回」, and 「发送」. A reply cannot be taken back, so the line is
 * said above the button instead of asking again after it; there is no picture to attach here -- a soul's
 * picture is shown (letterImages.tsx) but a reply is text only.
 *
 * Bodies are plain text everywhere: a letter, a template and the box are drawn and sent as typed.
 * Nothing here writes a body to a log or into an error message.
 */
import {
  INBOX_REPLY_MAX,
  inboxTemplatesApi,
  soulInboxApi,
  type InboxMessage,
} from "@soulledger/core/api/soul-inbox";
import {
  groupLetters,
  inboxReplyGate,
  isReadOnlyLetterState,
  lastSoulLetterAt,
  letterState,
  letterWait,
  replyReady,
  type LetterFacts,
  type LetterGroup,
} from "@soulledger/core/domain/letters";
import { hhmm } from "@soulledger/core/domain/dates";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";

import { clearDraft, flushDraft, mergeServerDraft, readDraft, scheduleDraft, settleDraft } from "../drafts";
import { enqueueReply, newReplyTxn, removeFromOutbox, retryReply, useOutbox, type OutboxEntry } from "../outbox";
import { useCachedRemote } from "../readCache";
import { formatWhen } from "../format";
import { ActionButton, Row, StateView, detailStateOf } from "../kit";
import {
  hallLabel,
  lettersUnavailable,
  ASSIGNED_TO_OTHER,
  MOVED,
  replyFailureKey,
  withTemplate,
} from "../rules";
import { useCan, useSession } from "../session";
import { isUnassigned, menuActions, type LetterAction } from "../letterActions";
import { AssignSheet, LetterMenuSheet, TakeBar, UnassignSheet } from "./letterActions";
import { LetterImage, LetterImageViewer } from "./letterImages";
import {
  Input,
  Loader,
  Notice,
  Screen,
  Sheet,
  SmallButton,
  Txt,
  space,
  useI18n,
  useOnline,
  useRemote,
  useTheme,
  useToast,
  Press,
} from "../shared";

/** What `GET …/messages/` sends at most per page (`officer_messages`' limit): a full page means there may be more. */
const LETTER_PAGE = 50;
/** The same "no older page" every render, so the thread's memo below keeps its rows while the officer types. */
const NO_ROWS: InboxMessage[] = [];
/** What grouping reads of a letter: the hall's replies are grouped by officer, the soul's by sender. */
const factsOf = (m: InboxMessage): LetterFacts => ({ ts: m.timestamp, side: m.from_officer ? "hall" : "soul", author: m.sender_name });

export function LetterThread({
  id,
  onSettled,
  onDone,
}: {
  id: string;
  onSettled: () => void;
  /** The reply has left this screen's hands (sent, or queued for the network): back to the list (user, 2026-10-16). */
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { state } = useSession();
  const user = state.status === "signedIn" ? state.user : null;
  const load = useCallback(async () => {
    const [conversation, messages] = await Promise.all([
      soulInboxApi.get(id),
      soulInboxApi.messages(id),
    ]);
    return { conversation: conversation.data, messages: messages.data };
  }, [id]);
  const thread = useCachedRemote(`detail:letter:${id}`, load);
  const { offline } = useOnline();
  // 「转给我」: handing a letter on is `soul_inbox.reply` on the server (`assign`), the same code as answering it.
  const canHandOn = useCan("soul_inbox.reply");
  // Opening the letter is reading it: once per opening, when the thread came from the server (not the cache).
  // Without this a letter read and archived on the phone was still unread at the desk.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || !thread.data || thread.cached) return;
    marked.current = true;
    void soulInboxApi.markRead(id).catch(() => undefined);
  }, [id, thread.data, thread.cached]);
  // 「更早」: the server sends the newest LETTER_PAGE; older pages hang under them until the thread reloads.
  const [earlier, setEarlier] = useState<{ base: unknown; rows: InboxMessage[]; more: boolean; state: "busy" | "failed" | null }>({
    base: null,
    rows: [],
    more: false,
    state: null,
  });
  const older = earlier.base === thread.data ? earlier : { base: thread.data, rows: NO_ROWS, more: (thread.data?.messages.length ?? 0) >= LETTER_PAGE, state: null };
  const loadEarlier = () => {
    const base = thread.data;
    const all = [...(base?.messages ?? []), ...older.rows];
    const oldest = all[all.length - 1];
    if (!base || !oldest || older.state === "busy") return;
    setEarlier({ ...older, state: "busy" });
    soulInboxApi
      .messages(id, oldest.event_id)
      .then((r) => setEarlier({ base, rows: [...older.rows, ...r.data], more: r.data.length >= LETTER_PAGE, state: null }))
      .catch(() => setEarlier({ ...older, state: "failed" }));
  };
  const outboxEntry = useOutbox().find((e) => e.id === id);
  const queued = outboxEntry?.state === "queued";
  // A failed template list only hides the 模板 row; the letter can still be answered.
  const loadTemplates = useCallback(
    () => inboxTemplatesApi.list().then((r) => r.data),
    [],
  );
  const templates = useRemote(loadTemplates);
  // The words survive leaving the screen and the OS killing the app (drafts.ts); a reply that went out clears them.
  const [text, setText] = useState(() => readDraft(id));
  // The box opens with this phone's words at once; the server's copy (the desk's) joins when it arrives, once per
  // opening (the first time online). Anything done to the box meanwhile wins over an answer that was asked before it.
  const touched = useRef(false);
  const edit = (next: string) => {
    touched.current = true;
    setText(next);
    scheduleDraft(id, next);
  };
  useEffect(() => settleDraft, []);
  const askedServer = useRef(false);
  useEffect(() => {
    if (offline || askedServer.current) return;
    askedServer.current = true;
    if (outboxEntry) return; // the words are a reply on its way, not a draft to compare
    soulInboxApi.draft(id).then(
      (r) => {
        if (!touched.current) setText(mergeServerDraft(id, r.data));
      },
      () => undefined,
    );
  }, [id, offline, outboxEntry]);
  // 「来信已等 …」 is counted to when the thread was opened (render stays pure; a reopened thread counts again).
  const [openedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const frame = useRef<View>(null);
  const [top, setTop] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  // O-04: the ⋯ menu and what it opens. `archivedAt` is when this officer archived it (the banner's date).
  const [sheet, setSheet] = useState<"menu" | "assign" | "unassign" | null>(null);
  const [acting, setActing] = useState(false);
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  // Two quick taps must not make two replies: `busy` is state (a render behind), this is not.
  const sending = useRef(false);
  // One id per reply: pressing 「发送」 again with the same words after a lost response sends the same id.
  const attempt = useRef<{ text: string; txn: string; tried: boolean } | null>(null);
  // A queued reply that leaves the outbox went out (or was discarded): either way its words are gone from the draft,
  // so the box empties and the thread reloads. Before this the words sat there, the button live again, after the
  // reply had already been sent -- one more tap and the soul got it twice (Huawei, 2026-10-16).
  const wasQueued = useRef(false);
  useEffect(() => {
    if (outboxEntry) {
      wasQueued.current = true;
      return;
    }
    if (!wasQueued.current) return;
    wasQueued.current = false;
    attempt.current = null;
    setText("");
    void thread.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the entry coming and going matters
  }, [outboxEntry]);

  const send = () => {
    if (sending.current || !replyReady(text)) return;
    touched.current = true;
    const words = text.trim();
    if (attempt.current?.text !== words) attempt.current = { text: words, txn: newReplyTxn(), tried: false };
    const { txn } = attempt.current;
    if (offline) {
      // No network: the reply waits on this phone (outbox.ts) and the words stay in the draft.
      flushDraft();
      enqueueReply({
        id,
        name: thread.data?.conversation.soul_name ?? "",
        text: words,
        seen: (thread.data?.messages ?? []).filter((m) => m.from_officer).map((m) => m.event_id),
        txn,
        tried: attempt.current.tried,
      });
      onSettled();
      onDone?.();
      return;
    }
    attempt.current.tried = true;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    soulInboxApi
      .reply(id, words, txn)
      .then(() => {
        attempt.current = null;
        setText("");
        clearDraft(id);
        removeFromOutbox(id);
        toast(t("soul_inbox.sent"), "success");
        void thread.reload();
        onSettled();
        onDone?.();
      })
      // The text stays; the key says why (closed / unavailable / try again) without quoting anything.
      .catch((e: unknown) => {
        const key = replyFailureKey(e);
        if (key !== ASSIGNED_TO_OTHER) return setFailure(key);
        // Taken while this was being written: the reload swaps the box for 「转给我」, the words stay in the draft.
        toast(t(key), "failure");
        void thread.reload();
        onSettled();
      })
      .finally(() => {
        sending.current = false;
        setBusy(false);
      });
  };

  // An archived letter wears 「已归档 · 日期」; the date is in this officer's inbox state, not on the conversation.
  const archived = thread.data?.conversation.archived ?? false;
  useEffect(() => {
    if (!archived || archivedAt) return;
    soulInboxApi.draft(id).then((r) => setArchivedAt(r.data.archived_at ?? null), () => undefined);
  }, [archived, archivedAt, id]);

  /** Run one hand-over call; on success toast, refresh the thread and the list behind it. */
  const act = (call: () => Promise<unknown>, done: string, leave = false) => {
    setActing(true);
    call()
      .then(() => {
        if (done) toast(done, "success");
        onSettled();
        if (leave) onDone?.();
        else void thread.reload();
      })
      .catch(() => toast(t("officer_app.state.error_title"), "failure"))
      .finally(() => {
        setActing(false);
        setSheet(null);
      });
  };
  const pick = (action: LetterAction) => {
    if (action === "assign" || action === "unassign") {
      setSheet(action);
      return;
    }
    if (action === "archive") {
      setSheet(null);
      // No confirm: the banner's 取消归档 is the way back.
      act(() => soulInboxApi.archive(id).then((r) => setArchivedAt(r.data.archived_at ?? new Date().toISOString())), t("soul_inbox.archived_done"));
      return;
    }
    setSheet(null);
    act(() => soulInboxApi.unarchive(id).then(() => setArchivedAt(null)), t("officer_app.letter.done_unarchived"));
  };

  // Every keystroke in the reply box re-renders this screen (R2): the letters above it keep the same rows and the
  // same two callbacks, so each `LetterLine` (memo) skips its render instead of drawing the thread again.
  const shownMessages = thread.data?.messages;
  // The server sends the newest first; the screen reads from the top down. Earlier pages are older still.
  const ordered = useMemo(() => [...(shownMessages ?? []), ...older.rows].reverse(), [shownMessages, older.rows]);
  // The viewer pages through every picture in the thread, oldest first.
  const gallery = useMemo(() => ordered.flatMap((m) => (m.image ? [m.image] : [])), [ordered]);
  const openImage = useCallback((imageId: string) => setViewing(Math.max(0, gallery.findIndex((g) => g.id === imageId))), [gallery]);
  const { reload: reloadThread } = thread;
  const reloadImages = useCallback(() => void reloadThread(), [reloadThread]);
  // The web's rule (@soulledger/core/domain/letters): closed, then the soul dispatched to another hall (`can_reply`
  // false, or this phone's last reply answered 409 `not_current_hall`), then someone else holds it.
  const shownConversation = thread.data?.conversation;
  const gate = shownConversation ? inboxReplyGate(shownConversation, { userId: user?.id, movedSeen: failure === MOVED }) : "open";
  const last = ordered[ordered.length - 1];
  const turn = shownConversation ? letterState(gate, last ? factsOf(last).side : undefined) : null;
  // The groups only change when the letters, or whether the hall still owes a reply, do -- not as the officer types.
  const awaiting = turn === "awaiting_hall";
  const rows = useMemo(() => groupLetters(ordered, factsOf, { open: awaiting }), [ordered, awaiting]);

  if (thread.error && lettersUnavailable(thread.error)) {
    return (
      <Screen testID="letter-unavailable" edges={["left", "right"]}>
        <View style={{ padding: space[5] }}>
          <Txt variant="body" tone="muted">
            {t("officer_app.letter.unavailable")}
          </Txt>
        </View>
      </Screen>
    );
  }
  const view = detailStateOf({ data: thread.data, error: thread.error });
  if (view || !thread.data)
    return <StateView state={view ?? "loading"} onRetry={thread.reload} />;

  const { conversation } = thread.data;
  const meId = user?.id;
  const readOnly = isReadOnlyLetterState(turn);
  // The server always sends `assignee` (null = nobody); only that explicit null is "unassigned".
  const assigned = conversation.assignee !== null;
  const flags = { archived: conversation.archived, closed: conversation.closed_at != null, assigned };
  // Without `soul_inbox.reply` the server takes neither a reply nor 由我来回 (`assign`): no box, no TakeBar.
  // 由我来回 makes the viewer the assignee, and the server takes only an officer of this hall (`is_assignable`). A
  // civilization admin belongs to no hall: assign 400s (simulator 2026-11-21, 「没取到」). For them an unassigned letter
  // shows the box -- the server lets anyone with soul_inbox.reply answer one nobody holds -- and 转给别人 stays in ⋯.
  const unassigned = canHandOn && isUnassigned(flags) && user?.tenant != null;
  // O-e: someone else holds it -- the box gives way to one line saying so (not greyed, no confirm: a greyed box reads as
  // stuck, a confirm does not stop two people answering). Who may hand letters on gets 「转给我」, the same assign call.
  const othersLetter = gate === "others";
  const values = {
    soul_name: conversation.soul_name,
    hall_name: hallLabel(t, user?.tenant) ?? "",
  };
  // 第六十四批第三节: whose turn, right above where the officer decides. No warning colour: there is no service target yet.
  const since = awaiting ? lastSoulLetterAt(ordered, factsOf) : undefined;
  const wait = since !== undefined ? letterWait(since, openedAt) : null;
  const status =
    turn === "awaiting_hall" && wait ? (
      <Txt testID="letter-state" variant="section" style={styles.status}>
        {t("letters.state.awaiting_hall", { wait: t(`common.duration.${wait.unit}`, { n: String(wait.n) }) })}
      </Txt>
    ) : turn === "awaiting_soul" ? (
      <Txt testID="letter-state" variant="body" tone="muted" style={styles.status}>
        {t("letters.state.awaiting_soul")}
      </Txt>
    ) : null;
  // One footer: the status line, then what the officer can do. Read-only (closed, moved): one grey line, nothing else.
  const footer = (body: ReactNode) => (
    <View testID="letter-footer" style={{ borderTopWidth: 1, borderTopColor: theme.hair, backgroundColor: theme.s1 }}>
      {status ? <View style={{ paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: body ? 0 : space[4] }}>{status}</View> : null}
      {body}
    </View>
  );
  const ownName = user?.display_name || t("soul_inbox.officer_reply");

  return (
    <View
      ref={frame}
      style={{ flex: 1 }}
      onLayout={() => frame.current?.measureInWindow((_x, y) => setTop(y))}
    >
      <KeyboardAvoidingView
        testID="letter-thread"
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // This view starts below the hall band and the back bar. KeyboardAvoidingView pads by its own frame, which is
        // measured from its parent, so without the distance from the top of the window it came up short by exactly
        // that much and 「发送」 stayed under the keyboard, with a multiline box that has no way to dismiss it
        // (iPhone 17, 2026-10-11).
        keyboardVerticalOffset={top}
      >
        <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: space[5], borderBottomWidth: 1, borderBottomColor: theme.hair }}>
          <View style={{ flex: 1, paddingVertical: space[3], gap: space[1] }}>
            <Txt variant="title">{conversation.soul_name}</Txt>
            <Txt variant="caption" tone="muted" testID="letter-handler">
              {conversation.assignee ? t("officer_app.letter.handler", { name: conversation.assignee.display_name }) : t("officer_app.letter.handler_none")}
            </Txt>
          </View>
          <Press
            testID="letter-more"
            accessibilityRole="button"
            accessibilityLabel={t("officer_app.letter.more")}
            // 转出 / 放回 / 归档 all go to the server: offline the menu is shut, and says why.
            accessibilityHint={offline ? t("officer_app.offline.banner_bare") : undefined}
            accessibilityState={{ disabled: offline }}
            disabled={offline}
            onPress={() => setSheet("menu")}
            style={{ width: 48, minHeight: 48, alignItems: "center", justifyContent: "center", opacity: offline ? 0.4 : 1 }}
          >
            <Txt variant="title">⋯</Txt>
          </Press>
        </View>
        {conversation.archived ? (
          <View style={{ padding: space[4], gap: space[2] }}>
            <Notice tone="neutral" testID="letter-archived">{`○ ${archivedAt ? t("officer_app.letter.archived_banner", { date: formatWhen(archivedAt) }) : t("soul_inbox.archived_done")}`}</Notice>
            {/* The way back right where it was archived: 取消归档 is what 撤销 would do. */}
            {offline ? null : <SmallButton testID="letter-unarchive" title={t("officer_app.letter.unarchive")} onPress={() => pick("unarchive")} />}
          </View>
        ) : null}
        <Screen edges={["left", "right"]}>
          <View style={{ padding: space[5], gap: 20 }}>
            {older.more && older.state === "failed" ? (
              <Notice tone="neg" onRetry={loadEarlier} testID="letter-earlier-failed">
                {t("officer_app.letter.earlier_failed")}
              </Notice>
            ) : older.more ? (
              <View style={{ alignItems: "center" }}>
                {older.state === "busy" ? (
                  <Loader size={20} testID="letter-earlier-busy" />
                ) : (
                  <SmallButton testID="letter-earlier" title={t("officer_app.letter.earlier")} onPress={loadEarlier} />
                )}
              </View>
            ) : null}
            {ordered.length === 0 ? (
              <Txt variant="caption" tone="muted">
                {t("soul_inbox.no_messages")}
              </Txt>
            ) : null}
            {rows.map((row) =>
              row.kind === "day" ? (
                <DayDivider key={row.key} day={row.day} />
              ) : (
                <LetterGroupView
                  key={row.key}
                  group={row}
                  soulName={conversation.soul_name}
                  onReloadImages={reloadImages}
                  onOpenImage={openImage}
                />
              )
            )}
            {outboxEntry ? <OutboxLetter entry={outboxEntry} name={ownName} offline={offline} onRetry={() => void retryReply(id)} /> : null}
          </View>
        </Screen>
        {readOnly ? (
          footer(
            <View style={{ padding: space[4] }}>
              <Txt testID={turn === "closed" ? "letter-closed" : "letter-moved"} variant="body" tone="muted" style={styles.status}>
                {t(turn === "closed" ? "letters.state.closed" : "officer_app.letter.moved")}
              </Txt>
            </View>
          )
        ) : unassigned ? (
          // Nobody holds it: 由我来回 takes it (then the box appears), 转给别人 hands it on. No reply from here.
          footer(
            <TakeBar
              busy={acting}
              offline={offline}
              onAssign={() => setSheet("assign")}
              onTake={() => meId !== undefined && act(() => soulInboxApi.assign(id, meId), "")}
            />
          )
        ) : othersLetter ? (
          footer(
          <View testID="letter-not-yours" style={{ padding: space[4], gap: space[3] }}>
            <Txt variant="body" tone="muted">{t("officer_app.letter.not_yours", { name: conversation.assignee?.display_name ?? "" })}</Txt>
            {canHandOn && meId !== undefined ? (
              <ActionButton
                testID="letter-assign-to-me"
                kind="outline"
                busy={acting}
                disabled={offline}
                accessibilityHint={offline ? t("officer_app.offline.banner_bare") : undefined}
                title={t("officer_app.letter.assign_to_me")}
                onPress={() => act(() => soulInboxApi.assign(id, meId), "")}
              />
            ) : null}
          </View>
          )
        ) : !canHandOn ? (
          status ? footer(null) : null
        ) : (
          footer(
          <View testID="letter-composer" style={{ padding: space[4], gap: space[3] }}>
            {templates.data && !templates.error ? (
              <View style={{ flexDirection: "row" }}>
                <SmallButton
                  testID="letter-template"
                  title={t("soul_inbox.template.label")}
                  onPress={() => setPicking(true)}
                />
              </View>
            ) : null}
            <Input
              testID="letter-input"
              label={t("soul_inbox.reply_label")}
              multiline
              maxLength={INBOX_REPLY_MAX}
              value={text}
              editable={!queued}
              onChangeText={edit}
            />
            {failure ? (
              <Notice
                tone="neg"
                testID="letter-failed"
              >{t(failure)}</Notice>
            ) : null}
            <Txt variant="caption" tone="muted" testID="letter-irreversible">
              {t("officer_app.letter.irreversible")}
            </Txt>
            <ActionButton
              testID="letter-send"
              kind="primary"
              busy={busy}
              disabled={queued}
              title={t("soul_inbox.send")}
              onPress={send}
            />
          </View>
          )
        )}
        <LetterMenuSheet open={sheet === "menu"} actions={menuActions(flags)} onPick={pick} onClose={() => setSheet(null)} />
        <AssignSheet
          key={`assign-${sheet === "assign"}`}
          open={sheet === "assign"}
          id={id}
          selfId={meId}
          onClose={() => setSheet(null)}
          onAssigned={(name) => {
            toast(t("officer_app.letter.done_assigned", { name }), "success");
            onSettled();
            onDone?.();
          }}
        />
        <UnassignSheet
          open={sheet === "unassign"}
          busy={acting}
          onClose={() => setSheet(null)}
          onConfirm={() => act(() => soulInboxApi.unassign(id), t("officer_app.letter.done_unassigned"))}
        />
        <LetterImageViewer
          images={gallery}
          index={viewing}
          onClose={() => setViewing(null)}
        />
        <Sheet
          open={picking}
          onClose={() => setPicking(false)}
          edge={theme.hair}
          closeLabel={t("soul_app.common.cancel")}
        >
          <View testID="sheet-templates" style={{ paddingVertical: space[5] }}>
            <View
              style={{ paddingHorizontal: space[5], paddingBottom: space[3] }}
            >
              <Txt variant="title">{t("soul_inbox.template.pick")}</Txt>
            </View>
            {(templates.data ?? []).length === 0 ? (
              <Txt
                variant="caption"
                tone="muted"
                style={{ paddingHorizontal: space[5] }}
              >
                {t("soul_inbox.template.none")}
              </Txt>
            ) : null}
            {(templates.data ?? []).map((tpl) => (
              <Row
                key={tpl.id}
                testID={`template-${tpl.id}`}
                minHeight={56}
                title={tpl.title}
                onPress={() => {
                  // Into the box, not out of the door: the officer reads it, edits it, and presses 发送.
                  edit(withTemplate(text, tpl.body, values));
                  setPicking(false);
                }}
              />
            ))}
          </View>
        </Sheet>
      </KeyboardAvoidingView>
    </View>
  );
}

/** A new day: 11 faint on the left, a hairline to the right. Times in the groups are 时:分 only; the date is here. */
function DayDivider({ day }: { day: string }) {
  const theme = useTheme();
  return (
    <View testID={`letter-day-${day}`} style={styles.dayRow}>
      <Txt variant="label" tone="subtle" style={styles.day}>
        {day}
      </Txt>
      <View style={[styles.dayRule, { borderTopColor: theme.hair }]} />
    </View>
  );
}

/** The group's one line: 「名字 · 来信/回信」 at the left (13/20 500, the side word secondary), the first letter's 时:分 at the right. */
function GroupHead({ name, side, ts }: { name: string; side: "soul" | "hall"; ts: number | null }) {
  const { t } = useI18n();
  return (
    <View style={styles.head}>
      <Txt variant="label" numberOfLines={1} style={[styles.headName, styles.fill]}>
        {name}
        <Txt variant="body" tone="muted" style={styles.headName}>{` · ${t(`letters.side.${side}`)}`}</Txt>
      </Txt>
      {ts !== null ? (
        <Txt variant="label" tone="subtle" style={styles.time}>
          {hhmm(new Date(ts))}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * One group of letters from one person. The hall's (this side's) on the `card2` panel; the soul's plain on the canvas,
 * with the 2px ink line while it is unanswered (`open`). Full width either way. Memo: typing in the box re-renders
 * the screen, not the thread (R2) -- `rows` keeps the same groups.
 */
const LetterGroupView = memo(function LetterGroupView({
  group,
  soulName,
  onOpenImage,
  onReloadImages,
}: {
  group: LetterGroup<InboxMessage>;
  soulName: string;
  onOpenImage: (id: string) => void;
  onReloadImages: () => void;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const { back } = useOnline(); // a picture that failed offline tries again once the network is back
  const own = group.side === "hall";
  const first = group.letters[0].item;
  const name = own ? first.sender_name || t("soul_inbox.officer_reply") : first.sender_name || soulName;
  return (
    <View
      testID={`letter-group-${group.side}${group.open ? "-open" : ""}`}
      style={[styles.group, own && { backgroundColor: theme.s2, borderRadius: 6, padding: 12 }, group.open && { borderLeftWidth: 2, borderLeftColor: theme.ink, paddingLeft: 12 }]}
    >
      <GroupHead name={name} side={group.side} ts={group.ts} />
      {group.letters.map(({ item: m, stamp }) => (
        <View key={m.event_id} testID={`letter-${own ? "hall" : "soul"}-${m.event_id}`} style={styles.letter}>
          {stamp ? (
            <Txt variant="label" tone="subtle" style={[styles.time, styles.stamp]}>
              {hhmm(new Date(m.timestamp))}
            </Txt>
          ) : null}
          {m.image ? (
            // A picture is its own letter, without words ("[图片]" is only what an older reader shows).
            <LetterImage key={`${m.image.url}:${back}`} image={m.image} onOpen={() => onOpenImage(m.image!.id)} onReload={onReloadImages} />
          ) : (
            <Txt variant="body" style={styles.body}>
              {m.body}
            </Txt>
          )}
        </View>
      ))}
    </View>
  );
});

/**
 * A reply still on this phone (outbox.ts): the hall's panel, unfilled, in a 1px dashed frame -- not sent yet.
 * 「◌ 待发出」 while it waits; 「没发出 · 重试」 when it failed and trying again may work, else 「没发出 · <why>」.
 * Once it goes out the thread reloads and it is an ordinary panel in the group above. No animation either way.
 */
function OutboxLetter({ entry, name, offline, onRetry }: { entry: OutboxEntry; name: string; offline: boolean; onRetry: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const failed = entry.state === "failed";
  const retryable = (entry.reason ?? "retry") === "retry";
  return (
    <View testID={`letter-outbox-${entry.state}`} style={[styles.group, { borderWidth: 1, borderStyle: "dashed", borderColor: theme.inkSubtle, borderRadius: 6, padding: 12 }]}>
      <GroupHead name={name} side="hall" ts={null} />
      <Txt variant="body" style={styles.body}>
        {entry.text}
      </Txt>
      {failed ? (
        <View testID="letter-outbox-failed" style={styles.outboxLine}>
          <Txt variant="label" tone="neg" style={styles.small}>
            {retryable ? `${t("letters.not_sent")} · ` : `${t("letters.not_sent")} · ${t(`officer_app.outbox.${entry.reason}`)}`}
          </Txt>
          {retryable ? (
            <Press testID="letter-outbox-retry" accessibilityRole="button" disabled={offline} onPress={onRetry} hitSlop={12}>
              <Txt variant="label" style={[styles.small, styles.link]}>
                {t("common.retry")}
              </Txt>
            </Press>
          ) : null}
        </View>
      ) : (
        <Txt testID="letter-queued" variant="label" tone="muted" style={styles.small}>
          {`◌ ${t("letters.queued")}`}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  group: { gap: 16, alignSelf: "stretch" },
  letter: { gap: 8 },
  head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  headName: { fontSize: 13, lineHeight: 20, letterSpacing: 0 },
  time: { fontSize: 12, lineHeight: 16, letterSpacing: 0, fontVariant: ["tabular-nums"] },
  stamp: { textAlign: "right" },
  body: { fontSize: 16, lineHeight: 24 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  day: { fontSize: 11, lineHeight: 16, letterSpacing: 0 },
  dayRule: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth },
  status: { fontSize: 13, lineHeight: 20 },
  outboxLine: { flexDirection: "row", alignItems: "center" },
  small: { fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  link: { textDecorationLine: "underline" },
});
