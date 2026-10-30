/**
 * 写给本殿 (Design 第二十八批 S5): the feedback form. It is not a new channel, it is a letter to the hall:
 *
 *   - the category rides on the letter (`feedback_tag`), and the hall's inbox lists it as 「反馈 · 类别」 until an
 *     officer replies -- in the letters, where every other reply to this soul already comes;
 *   - sending goes through the letters' own outbox (`chat.send` / `chat.sendImages`), so it works offline (queued and
 *     sent when the connection is back, kept across a restart) and the state under the form is the letters' own
 *     receipt (正在送出 / 已送达 / 等待送出 / 未送出) -- not a second kind of "sent";
 *   - screenshots are letter images: the same picker, the same compression, the same two-step upload.
 *
 * What the outbox cannot do is open the hall inbox while the phone has never seen it (the list is empty and there is no
 * network): then the form stays as it is, says so, and nothing is queued.
 */
import { soulChatErrorCode, type SoulConversation, type SoulFeedbackTag } from "@soulledger/core/api/soul-chat";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useRef, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { type Outgoing, useChat } from "../chat";
import { chatSections } from "../chatRules";
import { Icon } from "../emblems";
import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import { Button, Input, Notice, Screen, Txt, useLayout, useTheme } from "../ui";
import type { AppStackParams } from "../navTypes";
import { compressWithSize, pickImages } from "./circleMedia";
import { useDiscardGuard } from "./discardGuard";

/** Design: 「最多 3 张」. */
export const FEEDBACK_SHOT_MAX = 3;
/** The server's letter-length bound (`MessageSendSerializer.body`). */
const BODY_MAX = 4000;

/** [tag, label key]. The first is selected when the form opens, as in the design. */
const KINDS: readonly (readonly [SoulFeedbackTag, string])[] = [
  ["account", "soul_app.feedback.kind_account"],
  ["record", "soul_app.feedback.kind_record"],
  ["app", "soul_app.feedback.kind_app"],
  ["other", "soul_app.feedback.kind_other"],
];

/** `id` is for the list only: the same photo may be added twice, and two shots may share a file name or a uri. */
type Shot = { id: number; uri: string; name: string; type: string; width?: number; height?: number };

/** The receipt of what was sent: the letters' own words, the worst state among the text and its screenshots. */
function receiptOf(items: Outgoing[]): "sending" | "sent" | "queued" | "failed" {
  if (items.some((o) => o.state === "failed")) return "failed";
  if (items.some((o) => o.state === "queued")) return "queued";
  if (items.some((o) => o.state === "sending")) return "sending";
  return "sent";
}

function Chip({ tag, label, on, onPress }: { tag: string; label: string; on: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={`kind-${tag}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: on ? theme.ink : "transparent", borderColor: on ? theme.ink : theme.inkSubtle }]}
    >
      <Txt variant="body" style={{ color: on ? theme.s1 : theme.ink }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** After sending: the letters' receipt, a way to read the thread, a way to write another. */
function Sent({ txnIds, onAnother }: { txnIds: string[]; onAnother: () => void }) {
  const { t } = useI18n();
  const chat = useChat();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const items = chat.outbox.filter((o) => txnIds.includes(o.txnId));
  const state = receiptOf(items);
  const first = items[0];
  const receipt = {
    sending: "soul_app.chat.receipt.sending",
    sent: "soul_app.chat.receipt.sent",
    queued: "soul_app.chat.receipt.queued",
    failed: "soul_app.chat.receipt.failed",
  }[state];
  return (
    <View testID="feedback-sent" style={styles.sent}>
      <Txt testID="feedback-receipt" variant="section" tone={state === "failed" ? "negInk" : "ink"}>
        {receipt ? t(receipt) : ""}
      </Txt>
      <Txt variant="body" tone="muted">
        {t("soul_app.feedback.note")}
      </Txt>
      {state === "failed" && first ? (
        <Button testID="feedback-resend" kind="secondary" title={t("soul_app.chat.receipt.retry")} onPress={() => items.filter((o) => o.state === "failed").forEach((o) => chat.resend(o.txnId))} />
      ) : null}
      <Button testID="feedback-see-letters" title={t("soul_app.feedback.see_letters")} onPress={() => navigation.navigate("Tabs", { screen: "Letters" })} />
      <Button testID="feedback-another" kind="secondary" title={t("soul_app.feedback.another")} onPress={onAnother} />
    </View>
  );
}

export function FeedbackScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { gutter } = useLayout();
  const chat = useChat();
  const [kind, setKind] = useState<SoulFeedbackTag>("account");
  const [body, setBody] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const nextShot = useRef(0);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<string[] | null>(null);
  const guard = useDiscardGuard(!sent && (!!body.trim() || shots.length > 0), "feedback");

  const addShots = async () => {
    if (picking) return;
    const room = FEEDBACK_SHOT_MAX - shots.length;
    if (room <= 0) return toast(t("soul_app.feedback.shots_limit"), "failure");
    setPicking(true);
    try {
      const got = await pickImages(room);
      if (got === null) return toast(t("soul_app.circle.media.permission"), "failure");
      if (got.unreadable) {
        const key = got.images.length ? "soul_app.circle.media.unreadable_some" : "soul_app.circle.media.unreadable";
        toast(t(key, { n: String(got.unreadable) }), "failure");
      }
      const files = await Promise.all(got.images.map(compressWithSize));
      setShots((all) => [...all, ...files.map(({ file, width, height }) => ({ ...file, width, height, id: nextShot.current++ }))].slice(0, FEEDBACK_SHOT_MAX));
    } finally {
      setPicking(false);
    }
  };

  /** The hall the soul is in now: the one the phone already knows, else ask (which needs the network once). */
  const hall = async (): Promise<SoulConversation> => {
    const known = chat.conversations ? chatSections(chat.conversations).hall : null;
    return known ?? (await chat.openInbox());
  };

  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const c = await hall();
      const ids = [chat.send(c, text, kind)];
      if (shots.length) ids.push(...chat.sendImages(c, shots.map(({ uri, name, type, width, height }) => ({ uri, name, type, width, height }))));
      setSent(ids);
    } catch (error) {
      // chat_not_configured is said by the notice above the form; anything else is "not sent, try again".
      if (soulChatErrorCode(error) !== "chat_not_configured") setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen testID="feedback" belowHeader>
        <View style={{ paddingHorizontal: gutter }}>
          <Sent
            txnIds={sent}
            onAnother={() => {
              setSent(null);
              setBody("");
              setShots([]);
            }}
          />
        </View>
      </Screen>
    );
  }
  const unavailable = chat.availability === "not_configured";
  return (
    <Screen testID="feedback" belowHeader>
      {guard.sheet}
      <View style={[styles.form, { paddingHorizontal: gutter }]}>
        {unavailable ? (
          <Notice tone="neutral" testID="feedback-not-configured">
            {t("soul_app.chat.not_configured")}
          </Notice>
        ) : null}
        <View style={styles.group}>
          <Txt variant="bodyLg">{t("soul_app.feedback.kind_label")}</Txt>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {KINDS.map(([tag, key]) => (
              <Chip key={tag} tag={tag} label={t(key)} on={kind === tag} onPress={() => setKind(tag)} />
            ))}
          </View>
        </View>
        <Input
          testID="feedback-body"
          label={t("soul_app.feedback.body_label")}
          placeholder={t("soul_app.feedback.body_placeholder")}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={BODY_MAX}
          editable={!busy}
        />
        <View style={styles.group}>
          <Txt variant="bodyLg">
            {t("soul_app.feedback.shots_label")}
            <Txt variant="bodyLg" tone="muted">
              {` · ${t("soul_app.feedback.shots_hint")}`}
            </Txt>
          </Txt>
          <View style={styles.shots}>
            {shots.map((shot, i) => (
              <View key={shot.id} testID={`shot-${i}`} style={[styles.shot, { borderColor: theme.hair }]}>
                <Image source={{ uri: shot.uri }} style={styles.shotImage} accessibilityIgnoresInvertColors />
                <Pressable
                  testID={`shot-remove-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={t("soul_app.feedback.shots_remove")}
                  hitSlop={8}
                  onPress={() => setShots((all) => all.filter((_, j) => j !== i))}
                  style={[styles.shotRemove, { backgroundColor: theme.s1, borderColor: theme.inkSubtle }]}
                >
                  <Icon name="close" size={12} color={theme.ink} />
                </Pressable>
              </View>
            ))}
            {shots.length < FEEDBACK_SHOT_MAX ? (
              <Pressable
                testID="shot-add"
                accessibilityRole="button"
                accessibilityLabel={t("soul_app.feedback.shots_add")}
                onPress={() => void addShots()}
                style={[styles.shot, styles.add, { borderColor: theme.inkSubtle }]}
              >
                <Icon name="plus" size={20} color={theme.inkMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>
        <Txt testID="feedback-note" variant="body" tone="muted">
          {t("soul_app.feedback.note")}
        </Txt>
        {kind === "record" ? (
          <Txt testID="feedback-appeal-hint" variant="body" tone="muted">
            {t("soul_app.feedback.appeal_hint")}
          </Txt>
        ) : null}
        {failed ? (
          <Notice tone="neg" testID="feedback-failed">
            {t("soul_app.feedback.failed")}
          </Notice>
        ) : null}
        <Button testID="feedback-send" title={t("soul_app.feedback.send")} onPress={() => void send()} busy={busy} disabled={!body.trim() || unavailable} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { paddingVertical: 24, gap: 20 },
  group: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 12, borderWidth: 1, justifyContent: "center" },
  shots: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  shot: { width: 88, height: 88, borderWidth: 1 },
  shotImage: { width: "100%", height: "100%" },
  shotRemove: { position: "absolute", top: 0, right: 0, width: 28, height: 28, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  add: { borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  sent: { paddingVertical: 24, gap: 16 },
});
