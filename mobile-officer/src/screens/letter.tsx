/**
 * 待回书信's thread: one soul's letters, oldest at the top. The soul's letters sit at the left, the
 * hall's replies at the right -- told apart by alignment and a line of author and time, never by a
 * bubble colour. Below: 「模板」 (a bottom sheet whose pick is FILLED INTO the box, still editable,
 * never sent), the box, 「发出后不能撤回」, and 「发送」. A reply cannot be taken back, so the line is
 * said above the button instead of asking again after it; there is no picture to attach here.
 *
 * Bodies are plain text everywhere: a letter, a template and the box are drawn and sent as typed.
 * Nothing here writes a body to a log or into an error message.
 */
import { INBOX_REPLY_MAX, inboxTemplatesApi, soulInboxApi, type InboxMessage } from "@soulledger/core/api/soul-inbox";
import { useCallback, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import { formatWhen } from "../format";
import { ActionButton, Row, StateView, viewStateOf } from "../kit";
import { hallLabel, isDenied, lettersUnavailable, replyFailureKey, replyReady, withTemplate } from "../rules";
import { useSession } from "../session";
import { Input, Notice, Screen, Sheet, SmallButton, Txt, space, useI18n, useRemote, useTheme, useToast } from "../shared";

export function LetterThread({ id, onSettled }: { id: string; onSettled: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { state } = useSession();
  const user = state.status === "signedIn" ? state.user : null;
  const load = useCallback(async () => {
    const [conversation, messages] = await Promise.all([soulInboxApi.get(id), soulInboxApi.messages(id)]);
    return { conversation: conversation.data, messages: messages.data };
  }, [id]);
  const thread = useRemote(load);
  // A failed template list only hides the 模板 row; the letter can still be answered.
  const loadTemplates = useCallback(() => inboxTemplatesApi.list().then((r) => r.data), []);
  const templates = useRemote(loadTemplates);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Two quick taps must not make two replies: `busy` is state (a render behind), this is not.
  const sending = useRef(false);

  const send = () => {
    if (sending.current || !replyReady(text)) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    soulInboxApi
      .reply(id, text.trim())
      .then(() => {
        setText("");
        toast(t("soul_inbox.sent"), "success");
        void thread.reload();
        onSettled();
      })
      // The text stays; the key says why (closed / unavailable / try again) without quoting anything.
      .catch((e: unknown) => setFailure(replyFailureKey(e)))
      .finally(() => {
        sending.current = false;
        setBusy(false);
      });
  };

  if (thread.error && lettersUnavailable(thread.error)) {
    return (
      <Screen testID="letter-unavailable" edges={["left", "right"]}>
        <View style={{ padding: space[5] }}>
          <Txt variant="body" tone="muted">{t("officer_app.letter.unavailable")}</Txt>
        </View>
      </Screen>
    );
  }
  const view = viewStateOf({ data: thread.data, error: thread.error }, () => false, isDenied);
  if (view || !thread.data) return <StateView state={view ?? "loading"} onRetry={thread.reload} />;

  const { conversation, messages } = thread.data;
  const closed = conversation.closed_at != null;
  const values = { soul_name: conversation.soul_name, hall_name: hallLabel(t, user?.tenant) ?? "" };
  // The server sends the newest first; the screen reads from the top down.
  const ordered = [...messages].reverse();

  return (
    <KeyboardAvoidingView testID="letter-thread" style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen edges={["left", "right"]}>
        <View style={{ padding: space[5], gap: space[4] }}>
          <Txt variant="title">{conversation.soul_name}</Txt>
          {ordered.length === 0 ? <Txt variant="caption" tone="muted">{t("soul_inbox.no_messages")}</Txt> : null}
          {ordered.map((m) => (
            <LetterLine key={m.event_id} message={m} soulName={conversation.soul_name} />
          ))}
        </View>
      </Screen>
      {closed ? (
        <View style={{ padding: space[4] }}>
          <Notice tone="neutral" testID="letter-closed">{`○ ${t("soul_inbox.closed")}`}</Notice>
        </View>
      ) : (
        <View testID="letter-composer" style={{ padding: space[4], gap: space[3], borderTopWidth: 1, borderTopColor: theme.hair, backgroundColor: theme.s1 }}>
          {templates.data && !templates.error ? (
            <View style={{ flexDirection: "row" }}>
              <SmallButton testID="letter-template" title={t("soul_inbox.template.label")} onPress={() => setPicking(true)} />
            </View>
          ) : null}
          <Input
            testID="letter-input"
            label={t("soul_inbox.reply_label")}
            multiline
            maxLength={INBOX_REPLY_MAX}
            value={text}
            onChangeText={setText}
          />
          {failure ? <Notice tone="neg" testID="letter-failed">{`! ${t(failure)}`}</Notice> : null}
          <Txt variant="caption" tone="muted" testID="letter-irreversible">{t("officer_app.letter.irreversible")}</Txt>
          <ActionButton testID="letter-send" kind="primary" busy={busy} title={t("soul_inbox.send")} onPress={send} />
        </View>
      )}
      <Sheet open={picking} onClose={() => setPicking(false)} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
        <View testID="sheet-templates" style={{ paddingVertical: space[5] }}>
          <View style={{ paddingHorizontal: space[5], paddingBottom: space[3] }}>
            <Txt variant="title">{t("soul_inbox.template.pick")}</Txt>
          </View>
          {(templates.data ?? []).length === 0 ? (
            <Txt variant="caption" tone="muted" style={{ paddingHorizontal: space[5] }}>{t("soul_inbox.template.none")}</Txt>
          ) : null}
          {(templates.data ?? []).map((tpl) => (
            <Row
              key={tpl.id}
              testID={`template-${tpl.id}`}
              minHeight={56}
              title={tpl.title}
              onPress={() => {
                // Into the box, not out of the door: the officer reads it, edits it, and presses 发送.
                setText((current) => withTemplate(current, tpl.body, values));
                setPicking(false);
              }}
            />
          ))}
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

/** One letter: the author and time on a line, the words under it; the hall's go to the right. */
function LetterLine({ message, soulName }: { message: InboxMessage; soulName: string }) {
  const { t } = useI18n();
  const mine = message.from_officer;
  const who = mine
    ? [message.sender_name || t("soul_inbox.officer_reply"), message.officer_title].filter(Boolean).join(" · ")
    : message.sender_name || soulName;
  return (
    <View
      testID={`letter-${mine ? "hall" : "soul"}-${message.event_id}`}
      style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", gap: space[1], alignItems: mine ? "flex-end" : "flex-start" }}
    >
      <Txt variant="caption" tone="muted">{`${who} · ${formatWhen(new Date(message.timestamp).toISOString())}`}</Txt>
      <Txt variant="body" style={{ textAlign: mine ? "right" : "left" }}>{message.body}</Txt>
    </View>
  );
}
