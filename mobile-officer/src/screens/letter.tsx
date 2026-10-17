/**
 * 待回书信's thread: one soul's letters, oldest at the top. The soul's letters sit at the left, the
 * hall's replies at the right -- told apart by alignment and a line of author and time, never by a
 * bubble colour. Below: 「模板」 (a bottom sheet whose pick is FILLED INTO the box, still editable,
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
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native";

import { clearDraft, flushDraft, readDraft, scheduleDraft } from "../drafts";
import { enqueueReply, newReplyTxn, removeFromOutbox, useOutbox } from "../outbox";
import { useCachedRemote } from "../readCache";
import { formatWhen } from "../format";
import { ActionButton, Row, StateView, detailStateOf } from "../kit";
import {
  hallLabel,
  lettersUnavailable,
  replyFailureKey,
  replyReady,
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
  OneLine,
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
} from "../shared";

/** What `GET …/messages/` sends at most per page (`officer_messages`' limit): a full page means there may be more. */
const LETTER_PAGE = 50;

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
  const older = earlier.base === thread.data ? earlier : { base: thread.data, rows: [] as InboxMessage[], more: (thread.data?.messages.length ?? 0) >= LETTER_PAGE, state: null };
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
  const edit = (next: string) => {
    setText(next);
    scheduleDraft(id, next);
  };
  useEffect(() => flushDraft, []);
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
      .catch((e: unknown) => setFailure(replyFailureKey(e)))
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

  const { conversation, messages } = thread.data;
  const closed = conversation.closed_at != null;
  // The server always sends `assignee` (null = nobody); only that explicit null is "unassigned".
  const assigned = conversation.assignee !== null;
  const flags = { archived: conversation.archived, closed, assigned };
  const unassigned = isUnassigned(flags);
  const meId = user?.id;
  // O-e: someone else holds it -- the box gives way to one line saying so (not greyed, no confirm: a greyed box reads as
  // stuck, a confirm does not stop two people answering). Who may hand letters on gets 「转给我」, the same assign call.
  const othersLetter = conversation.assignee != null && conversation.assignee.user_id !== meId;
  const values = {
    soul_name: conversation.soul_name,
    hall_name: hallLabel(t, user?.tenant) ?? "",
  };
  // The server sends the newest first; the screen reads from the top down. Earlier pages are older still.
  const ordered = [...messages, ...older.rows].reverse();
  // The viewer pages through every picture in the thread, oldest first.
  const gallery = ordered.flatMap((m) => (m.image ? [m.image] : []));

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
          <Pressable
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
          </Pressable>
        </View>
        {conversation.archived ? (
          <View style={{ padding: space[4], gap: space[2] }}>
            <Notice tone="neutral" testID="letter-archived">{`○ ${archivedAt ? t("officer_app.letter.archived_banner", { date: formatWhen(archivedAt) }) : t("soul_inbox.archived_done")}`}</Notice>
            {/* The way back right where it was archived: 取消归档 is what 撤销 would do. */}
            {offline ? null : <SmallButton testID="letter-unarchive" title={t("officer_app.letter.unarchive")} onPress={() => pick("unarchive")} />}
          </View>
        ) : null}
        <Screen edges={["left", "right"]}>
          <View style={{ padding: space[5], gap: space[4] }}>
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
            {ordered.map((m) => (
              <LetterLine
                key={m.event_id}
                message={m}
                soulName={conversation.soul_name}
                onReloadImages={() => void thread.reload()}
                onOpenImage={(id) =>
                  setViewing(
                    Math.max(
                      0,
                      gallery.findIndex((g) => g.id === id),
                    ),
                  )
                }
              />
            ))}
          </View>
        </Screen>
        {closed ? (
          <View style={{ padding: space[4] }}>
            <Notice
              tone="neutral"
              testID="letter-closed"
            >{`○ ${t("soul_inbox.closed")}`}</Notice>
          </View>
        ) : unassigned ? (
          // Nobody holds it: 由我来回 takes it (then the box appears), 转给别人 hands it on. No reply from here.
          <TakeBar
            busy={acting}
            offline={offline}
            onAssign={() => setSheet("assign")}
            onTake={() => meId !== undefined && act(() => soulInboxApi.assign(id, meId), "")}
          />
        ) : othersLetter && !conversation.archived ? (
          <View testID="letter-not-yours" style={{ padding: space[4], gap: space[3], borderTopWidth: 1, borderTopColor: theme.hair, backgroundColor: theme.s1 }}>
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
        ) : (
          <View
            testID="letter-composer"
            style={{
              padding: space[4],
              gap: space[3],
              borderTopWidth: 1,
              borderTopColor: theme.hair,
              backgroundColor: theme.s1,
            }}
          >
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
              editable={!queued && !conversation.archived}
              onChangeText={edit}
            />
            {queued ? (
              <Txt variant="caption" tone="muted" testID="letter-queued">{`${t("officer_app.outbox.pending")} · ${t("officer_app.outbox.auto")}`}</Txt>
            ) : null}
            {outboxEntry?.state === "failed" && !failure ? (
              <Notice tone="neg" testID="letter-outbox-failed">{t(`officer_app.outbox.${outboxEntry.reason ?? "retry"}`)}</Notice>
            ) : null}
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
              disabled={queued || conversation.archived}
              title={t("soul_inbox.send")}
              onPress={send}
            />
          </View>
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

/** One letter: the author and time on a line, the words under it; the hall's go to the right. */
function LetterLine({
  message,
  soulName,
  onOpenImage,
  onReloadImages,
}: {
  message: InboxMessage;
  soulName: string;
  onOpenImage: (id: string) => void;
  onReloadImages: () => void;
}) {
  const { t } = useI18n();
  const { back } = useOnline(); // a picture that failed offline tries again once the network is back
  const mine = message.from_officer;
  const who = mine
    ? [
        message.sender_name || t("soul_inbox.officer_reply"),
        message.officer_title,
      ]
        .filter(Boolean)
        .join(" · ")
    : message.sender_name || soulName;
  return (
    <View
      testID={`letter-${mine ? "hall" : "soul"}-${message.event_id}`}
      style={{
        alignSelf: mine ? "flex-end" : "flex-start",
        maxWidth: "85%",
        gap: space[1],
        alignItems: mine ? "flex-end" : "flex-start",
      }}
    >
      <OneLine
        variant="caption"
        tone="muted"
      >{`${who} · ${formatWhen(new Date(message.timestamp).toISOString())}`}</OneLine>
      {message.image ? (
        // A picture is its own letter, without words ("[图片]" is only what an older reader shows).
        <LetterImage
          key={`${message.image.url}:${back}`}
          image={message.image}
          onOpen={() => onOpenImage(message.image!.id)}
          onReload={onReloadImages}
        />
      ) : (
        <Txt variant="body" style={{ textAlign: mine ? "right" : "left" }}>
          {message.body}
        </Txt>
      )}
    </View>
  );
}
