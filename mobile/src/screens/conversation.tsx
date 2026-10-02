/**
 * One conversation (handoff 1c ①–⑦, 1d): a soul, or a hall.
 *
 * The state comes from `chatMode` (../chatRules): the server's facts for this
 * conversation plus what this device's timeline has seen. Each state changes
 * three things and nothing else — the band under the title, how the bubbles
 * look, and what sits where the composer would be:
 *
 *   free / incoming / outgoing_open / hall  → a composer
 *   outgoing_locked                         → a dotted line and the mono time it opens (never a disabled box)
 *   muted                                   → no composer; the hall button right under the reason
 *   closed / hall_sealed                    → no composer at all (as sealed past lives: no after-image)
 *
 * `chat_unavailable` is not a state of the conversation but of the service: the
 * composer stays and still takes text — it queues — and only the send key
 * steps down to secondary (1c ⑦).
 */
import { soulSocialApi } from "@soulledger/core/api/soul-social";
import { hasRead, type ChatMessage } from "@soulledger/core/api/matrix";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { useChat, type Outgoing } from "../chat";
import { useCommittedSend } from "../composing";
import { bubbleStamp, chatMode, dayOf, daysLeft, type ChatMode } from "../chatRules";
import { PlaqueFrame } from "../chrome";
import { CORNER, Icon } from "../emblems";
import { family, quoteFamily } from "../fonts";
import { useI18n } from "../i18n";
import { formatStamp, TAG_GLYPH } from "../rules";
import type { CivKey } from "../theme";
import { Button, Interp, Loader, Notice, Skeleton, SmallButton, Txt, shade, useReducedMotion, useTheme } from "../ui";
import type { AppStackParams } from "./applications";
import { useNow } from "./auth";
import { ANDROID, Glyph, Tag, hallOf, useCurrentHall, wash } from "./letters";

type Line =
  | { kind: "day"; key: string; day: string }
  | { kind: "message"; key: string; m: ChatMessage; mine: boolean }
  | { kind: "pending"; key: string; o: Outgoing };

const lineKey = (line: Line) => line.key;

const Mono = ({ children, tone = "muted" }: { children: string; tone?: "muted" | "negInk" }) => (
  <Txt variant="value" tone={tone} style={styles.inlineMono}>
    {children}
  </Txt>
);

export function ConversationScreen({ id, landed }: { id: string; landed?: boolean }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const chat = useChat();
  const insets = useSafeAreaInsets();
  const hallName = useCurrentHall();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const [draft, setDraft] = useState("");
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const list = useRef<FlatList<Line>>(null);
  // `gone`: it left the list while open — the server closed it; still readable (1c ⑥).
  const c = chat.conversations?.find((row) => row.id === id) ?? chat.gone[id] ?? null;
  const room = c ? chat.timeline.rooms[c.room_id] : undefined;
  const messages = room?.messages ?? [];
  const now = useNow();

  const mode: ChatMode | null = c
    ? chatMode(c, {
        now,
        peerHasSpoken: messages.some((m) => m.sender !== chat.me),
        iHaveSpoken: messages.some((m) => m.sender === chat.me),
        refused: chat.refused[c.id] ?? null,
      })
    : null;

  // Older history a page at a time: once when the room opens with only what sync
  // brought, then each time the reader nears the top. One request at a time — the
  // list's end-reached fires again and again while the reader lingers up there, and
  // a ref, because two of those can land before the re-render.
  const roomId = c?.room_id;
  const prevBatch = room?.prevBatch;
  const { loadOlder, markRead } = chat;
  const olderBusy = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const older = useCallback(() => {
    if (!roomId || !prevBatch || olderBusy.current) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    void loadOlder(roomId).finally(() => {
      olderBusy.current = false;
      setLoadingOlder(false);
    });
  }, [roomId, prevBatch, loadOlder]);
  const paged = useRef(false);
  useEffect(() => {
    if (paged.current || !prevBatch) return;
    paged.current = true;
    older();
  }, [prevBatch, older]);

  // A new newest letter (theirs, or a send of mine) brings the thread back down to it.
  // Keyed on the newest only: a page of older history must not pull the reader down.
  const newestId = messages.length ? messages[messages.length - 1].eventId : "";
  const outboxCount = chat.outbox.length;
  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: true });
  }, [newestId, outboxCount]);

  // Mark what the other side wrote as read while this screen is in front.
  const lastTheirs = [...messages].reverse().find((m) => m.sender !== chat.me);
  const lastTheirsId = lastTheirs?.eventId;
  const unread = room?.unread ?? 0;
  useFocusEffect(
    useCallback(() => {
      if (roomId && lastTheirsId && unread > 0) markRead(roomId, lastTheirsId);
    }, [roomId, lastTheirsId, unread, markRead])
  );

  useEffect(() => {
    if (mode?.kind !== "muted") return;
    let alive = true;
    soulSocialApi
      .status()
      .then((s) => alive && setMutedUntil(s.muted_until))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode?.kind]);

  const goHall = async () => {
    try {
      const inbox = await chat.openInbox();
      navigation.navigate("Conversation", { id: inbox.id });
    } catch {
      // chat_unavailable: the band at the top already says so.
    }
  };

  if (!c || !mode) {
    return (
      <View style={[styles.fill, { backgroundColor: t.s0 }]}>
        <PlaqueFrame testID="header">
          <Header onBack={navigation.goBack} title="" />
        </PlaqueFrame>
        <View style={styles.pad}>
          {chat.availability === "not_configured" ? (
            <Notice tone="neutral" testID="chat-not-configured">
              {tr("soul_app.chat.not_configured")}
            </Notice>
          ) : chat.conversations ? (
            <Notice tone="neutral" testID="conversation-gone">
              {tr("soul_app.chat.errors.closed")}
            </Notice>
          ) : (
            <Skeleton lines={3} />
          )}
        </View>
      </View>
    );
  }

  const inbox = c.kind === "OFFICER_INBOX";
  const sealed = mode.kind === "closed" || mode.kind === "hall_sealed";
  const unavailable = chat.availability === "unavailable";

  // Bubbles: the timeline, day dividers, and this device's sends not yet echoed back.
  // No "" in the set: a message without a txn id (theirs, history) must not match a send with no event id yet.
  const echoed = new Set(messages.flatMap((m) => (m.txnId ? [m.eventId, m.txnId] : [m.eventId])));
  const pending = chat.outbox.filter((o) => o.conversationId === c.id && !(o.eventId && echoed.has(o.eventId)) && !echoed.has(o.txnId));
  const lines: Line[] = [];
  let lastDay = "";
  for (const item of [...messages.map((m) => ({ ts: m.ts, m })), ...pending.map((o) => ({ ts: o.ts, o }))]) {
    const day = dayOf(item.ts);
    if (day !== lastDay) lines.push({ kind: "day", key: `d${day}`, day });
    lastDay = day;
    if ("m" in item) lines.push({ kind: "message", key: item.m.eventId, m: item.m, mine: item.m.sender === chat.me });
    else lines.push({ kind: "pending", key: item.o.txnId, o: item.o });
  }
  const landedOn = landed ? lastTheirs?.eventId : undefined;

  const send = (text: string) => {
    const body = text.trim();
    if (!body) return;
    chat.send(c, body);
    setDraft("");
  };

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: t.s0 }]}
      // Both platforms: Android draws edge-to-edge (SDK 57), so the window no longer shrinks for the
      // keyboard (adjustResize) and the composer would sit under it.
      behavior="padding"
      // The dock already pads for the home indicator / gesture bar; over the keyboard that inset is a gap.
      keyboardVerticalOffset={-insets.bottom}
      testID={`conversation-${mode.kind}`}
    >
      {/* v2 补足 C15: a sub-page's title bar is the simplified plaque. */}
      <PlaqueFrame testID="header">
        {inbox ? (
          <HallHeader hall={hallOf(c, locale)} sealed={mode.kind === "hall_sealed"} onBack={navigation.goBack} />
        ) : (
          <Header
            onBack={navigation.goBack}
            title={c.peer_name}
            muted={sealed}
            subtitle={sealed ? undefined : tr(c.mutual ? "soul_app.chat.badge.mutual" : "soul_app.chat.badge.not_mutual")}
            right={sealed ? <Tag testID="closed-tag" text={tr("soul_app.chat.badge.closed")} tone="quiet" glyph={TAG_GLYPH.closed.glyph} /> : null}
          />
        )}
      </PlaqueFrame>
      {unavailable ? (
        <View testID="chat-unavailable" style={[styles.unavailable, { backgroundColor: t.s1, borderBottomColor: t.hair }]}>
          <View style={[styles.square, { backgroundColor: t.neg }]} />
          <Txt variant="caption" tone="muted" style={styles.fill}>
            {tr("soul_app.chat.unavailable.banner")}
          </Txt>
          <Pressable testID="chat-reconnect" accessibilityRole="button" onPress={chat.reconnect} style={[styles.smallButton, { borderColor: t.hair2 }]}>
            <Txt variant="label" style={styles.noSpacing}>
              {tr("soul_app.chat.unavailable.retry")}
            </Txt>
          </Pressable>
        </View>
      ) : null}
      <Band mode={mode} mutedUntil={mutedUntil} hall={hallName} onHall={() => void goHall()} now={now} />
      {/* Inverted: offset 0 is the newest letter, so the thread opens there and stays there as the
          keyboard shrinks the view; older pages join at the far end (the top) without moving it.
          Muted: the history stays fully legible — not dimmed, not blurred (1c ⑤). Only sealed rooms recede. */}
      <FlatList
        ref={list}
        testID="thread"
        inverted
        data={[...lines].reverse()}
        keyExtractor={lineKey}
        style={[styles.fill, sealed && styles.sealed]}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        onEndReached={prevBatch ? older : undefined}
        onEndReachedThreshold={0.5}
        renderItem={({ item: line }) =>
          line.kind === "day" ? (
            <Txt variant="value" tone="subtle" style={styles.day}>
              {line.day}
            </Txt>
          ) : line.kind === "pending" ? (
            <PendingBubble o={line.o} onResend={() => chat.resend(line.o.txnId)} now={now} />
          ) : line.mine ? (
            <Bubble mine m={line.m} now={now} read={!inbox && Object.keys(room?.readUpTo ?? {}).some((u) => u !== chat.me && hasRead(room, u, line.m))} />
          ) : inbox ? (
            <OfficerBubble m={line.m} hall={hallOf(c, locale)} sealed={mode.kind === "hall_sealed"} now={now} />
          ) : (
            <Bubble m={line.m} now={now} landed={line.m.eventId === landedOn} />
          )
        }
        // Inverted, the header sits under the newest letter and the footer above the oldest.
        ListHeaderComponent={
          <>
            {/* Where the thread stops: the server's `closed_at` (the other soul's rebirth closed it). */}
            {!inbox && c.closed_at ? (
              <Txt testID="closed-marker" variant="value" tone="subtle" style={styles.day}>
                {tr("soul_app.chat.closed.marker", { date: dayOf(Date.parse(c.closed_at)) })}
              </Txt>
            ) : null}
            {mode.kind === "outgoing_locked" && mode.rejected ? (
              <View style={styles.rejected}>
                <Notice tone="neg" testID="request-throttled">
                  <Interp text={tr("soul_app.chat.request.throttled")} parts={{ time: <Mono tone="negInk">{formatStamp(mode.nextAt) ?? ""}</Mono> }} variant="caption" tone="negInk" />
                </Notice>
              </View>
            ) : null}
          </>
        }
        // Scrolling up reads the next page on its own; the button is for a screen reader, or a reader who stopped short.
        ListFooterComponent={
          !prevBatch ? null : loadingOlder ? (
            <View style={styles.older}>
              <Loader size={18} testID="chat-older-loading" />
            </View>
          ) : (
            <View style={styles.older}>
              <SmallButton testID="chat-older" title={tr("soul_app.chat.older")} onPress={older} />
            </View>
          )
        }
      />
      <Dock
        mode={mode}
        draft={draft}
        onDraft={setDraft}
        onSend={send}
        secondary={unavailable}
        hallName={hallName}
        onHall={() => void goHall()}
        bottom={insets.bottom}
      />
    </KeyboardAvoidingView>
  );
}

// ── header ─────────────────────────────────────────────────────────────

function BackButton({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Pressable testID="header-back" accessibilityRole="button" accessibilityLabel={tr("common.back")} onPress={onBack} hitSlop={6} style={styles.icon}>
      {/* 1e: Android's back is an arrow, iOS's the chevron. */}
      <Icon name={Platform.OS === "android" ? "arrow" : "back"} size={Platform.OS === "android" ? 20 : 17} color={t.inkMuted} strokeWidth={1.4} />
    </Pressable>
  );
}

function Header({ onBack, title, subtitle, muted, right }: { onBack: () => void; title: string; subtitle?: string; muted?: boolean; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <BackButton onBack={onBack} />
      {/* 1e: iOS centres the title, Android sets it left. */}
      <View style={[styles.fill, !ANDROID && styles.centered]}>
        <Txt accessibilityRole="header" variant="nav" tone={muted ? "muted" : "ink"} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt testID="relation" variant="value" tone="subtle" style={styles.subtitle}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right ?? (ANDROID ? null : <View style={styles.icon} />)}
    </View>
  );
}

function HallHeader({ hall, sealed, onBack }: { hall: string; sealed: boolean; onBack: () => void }) {
  const { t: tr } = useI18n();
  return (
    <View
      style={styles.hallHeader}
    >
      <BackButton onBack={onBack} />
      <Glyph text={tr("soul_app.chat.section.hall")} tone={sealed ? "subtle" : "ink"} dotted={sealed} />
      <View style={styles.fill}>
        <Txt accessibilityRole="header" variant="nav" tone={sealed ? "muted" : "ink"}>
          {tr("soul_app.chat.hall.title", { hall })}
        </Txt>
        <Txt variant="caption" tone={sealed ? "subtle" : "muted"} style={styles.hallSub}>
          {sealed ? tr("soul_app.chat.hall.not_current", { hall }) : tr("soul_app.chat.hall.subtitle")}
        </Txt>
      </View>
      {sealed ? <Tag testID="sealed-tag" text={tr("soul_app.chat.badge.sealed")} tone="quiet" glyph={TAG_GLYPH.sealed.glyph} /> : null}
    </View>
  );
}

// ── the band under the title ───────────────────────────────────────────

function Band({
  mode,
  mutedUntil,
  hall,
  onHall,
  now,
}: {
  mode: ChatMode;
  mutedUntil: string | null;
  hall: string;
  onHall: () => void;
  now: number;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const box = [styles.band, { backgroundColor: t.s1, borderBottomColor: t.hair }];
  const line = (icon: "info" | "lock", text: ReactNode, testID: string) => (
    <View style={styles.bandRow}>
      <View style={styles.nudge}>
        <Icon name={icon} size={15} color={t.inkSubtle} strokeWidth={1.2} />
      </View>
      <View style={styles.fill}>
        {typeof text === "string" ? (
          <Txt testID={testID} variant="caption" tone="muted">
            {text}
          </Txt>
        ) : (
          text
        )}
      </View>
    </View>
  );
  switch (mode.kind) {
    case "outgoing_open":
    case "outgoing_locked":
      return <View style={box}>{line("info", tr("soul_app.chat.request.outgoing_hint"), "hint-outgoing")}</View>;
    case "incoming":
      return <View style={box}>{line("info", tr("soul_app.chat.request.incoming_hint"), "hint-incoming")}</View>;
    case "closed":
      return (
        <View style={box}>
          {line("lock", tr(mode.reason === "peer_retired" ? "soul_app.chat.closed.peer_retired" : "soul_app.chat.closed.peer_reborn"), "closed-reason")}
        </View>
      );
    case "muted":
      return (
        <View style={box} testID="muted-band">
          {line(
            "lock",
            mutedUntil ? (
              <Interp
                testID="muted-reason"
                variant="caption"
                tone="muted"
                text={tr("soul_app.chat.muted.banner")}
                parts={{ days: <Mono>{String(daysLeft(mutedUntil, now))}</Mono>, time: <Mono>{formatStamp(mutedUntil) ?? ""}</Mono> }}
              />
            ) : (
              <Txt testID="muted-reason" variant="caption" tone="muted">
                {tr("soul_app.chat.errors.muted")}
              </Txt>
            ),
            "muted-reason"
          )}
          <Button testID="muted-to-hall" kind="secondary" title={tr("soul_app.chat.muted.to_hall", { hall })} onPress={onHall} style={styles.bandButton} />
        </View>
      );
    default:
      return null;
  }
}

// ── bubbles ────────────────────────────────────────────────────────────

function Bubble({ m, mine, read, landed, now }: { m: ChatMessage; mine?: boolean; read?: boolean; landed?: boolean; now: number }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const reduced = useReducedMotion();
  const [fade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!landed || reduced) return;
    const timer = setTimeout(() => Animated.timing(fade, { toValue: 0, duration: 400, useNativeDriver: true }).start(), 1200);
    return () => clearTimeout(timer);
  }, [landed, reduced, fade]);
  return (
    <View style={[styles.bubbleRow, mine && styles.mineRow]}>
      <View
        testID={landed ? "landing-highlight" : undefined}
        style={[
          styles.bubble,
          mine
            ? { borderColor: t.inkSubtle, backgroundColor: wash(t) }
            : landed
              ? { borderColor: t.ink, borderLeftWidth: 3, backgroundColor: t.s1 }
              : { borderColor: t.hair2, backgroundColor: t.s1 },
        ]}
      >
        {landed && !reduced ? (
          <Animated.View pointerEvents="none" style={[styles.newTag, { borderColor: t.ink, backgroundColor: t.s0, opacity: fade }]}>
            <Txt testID="landing-tag" style={[styles.newTagText, { color: t.ink }]}>
              {tr("soul_app.chat.new_marker")}
            </Txt>
          </Animated.View>
        ) : null}
        <Body text={m.body} />
        <View style={[styles.meta, mine && styles.metaMine]}>
          <Txt variant="value" tone="subtle" style={styles.metaTime}>
            {bubbleStamp(m.ts, now)}
          </Txt>
          {mine ? (
            <Txt testID={read ? "receipt-read" : "receipt-sent"} variant="label" tone="subtle" style={styles.metaText}>
              {tr(read ? "soul_app.chat.receipt.read" : "soul_app.chat.receipt.sent")}
            </Txt>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Body({ text, dim }: { text: string; dim?: boolean }) {
  const t = useTheme();
  return <Txt style={[styles.body, { fontFamily: quoteFamily(text), color: dim ? t.inkMuted : t.ink }]}>{text}</Txt>;
}

function PendingBubble({ o, onResend, now }: { o: Outgoing; onResend: () => void; now: number }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const failed = o.state === "failed";
  const queued = o.state === "queued";
  // A refused request may be sent again once its time has come; any other refusal is final here.
  const resendable = failed && (!o.refused || (o.refused.code === "request_throttled" && !!o.refused.retryAt && Date.parse(o.refused.retryAt) <= now));
  const receipt = { sending: "soul_app.chat.receipt.sending", sent: "soul_app.chat.receipt.sent", queued: "soul_app.chat.receipt.queued", failed: "soul_app.chat.receipt.failed" }[o.state];
  return (
    <View style={[styles.bubbleRow, styles.mineRow]}>
      <View
        testID={`pending-${o.state}`}
        style={[
          styles.bubble,
          failed
            ? { borderColor: t.negStrong, backgroundColor: t.negBg }
            : queued
              ? { borderColor: t.hair2, backgroundColor: t.s1, opacity: 0.7 }
              : { borderColor: t.inkSubtle, backgroundColor: wash(t) },
        ]}
      >
        <Body text={o.body} dim={failed || queued} />
        <View style={[styles.meta, styles.metaMine]}>
          {queued || o.state === "sending" ? <Loader size={14} /> : null}
          <Txt variant="label" tone={failed ? "negInk" : "subtle"} style={styles.metaText}>
            {tr(receipt)}
          </Txt>
          {resendable ? (
            <Pressable testID="resend" accessibilityRole="button" onPress={onResend} hitSlop={15}>
              <Txt variant="label" tone="ink" style={[styles.metaText, styles.underline]}>
                {tr("soul_app.chat.receipt.retry")}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function OfficerBubble({ m, hall, sealed, now }: { m: ChatMessage; hall: string; sealed: boolean; now: number }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const line = sealed ? t.hair2 : t.ink;
  // Who replied and their position, as the backend stamped them on the event (either may be missing).
  const byline = tr("soul_app.chat.hall.officer_byline", { hall, role: m.officerTitle ?? "", name: m.officer ?? "" }).replace(/\s+/g, " ").trim();
  return (
    <View style={styles.bubbleRow}>
      <View testID="officer-bubble" style={[styles.bubble, styles.officer, { borderColor: line, borderLeftWidth: 3, backgroundColor: t.s1 }]}>
        <LetterCorners civ={t.civ} stroke={line} />
        <View style={styles.byline}>
          {sealed ? null : <Glyph text={tr("soul_app.chat.section.hall")} tone="ink" size={16} />}
          <Txt style={[styles.bylineText, { color: sealed ? t.inkSubtle : t.ink }]}>{byline}</Txt>
        </View>
        <Txt style={[styles.officerBody, { fontFamily: quoteFamily(m.body), color: sealed ? t.inkMuted : t.ink }]}>{m.body}</Txt>
        <Txt variant="value" tone="subtle" style={[styles.metaTime, styles.officerTime]}>
          {bubbleStamp(m.ts, now)}
        </Txt>
      </View>
    </View>
  );
}

/**
 * 文明气质 1f: the officer's letter as paper — four 14pt corners of the
 * civilization's ornament, 4 in from the edges, mirrored per corner. The body's
 * padding (22) keeps the text clear of them; nothing sits under the text.
 */
const CORNERS = [
  { key: "tl", at: { left: 4, top: 4 }, flip: [] },
  { key: "tr", at: { right: 4, top: 4 }, flip: [{ scaleX: -1 }] },
  { key: "bl", at: { left: 4, bottom: 4 }, flip: [{ scaleY: -1 }] },
  { key: "br", at: { right: 4, bottom: 4 }, flip: [{ scaleX: -1 }, { scaleY: -1 }] },
] as const;

function LetterCorners({ civ, stroke }: { civ: CivKey; stroke: string }) {
  return CORNERS.map((c) => (
    <Svg
      key={c.key}
      testID={`letter-corner-${c.key}`}
      pointerEvents="none"
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      stroke={stroke}
      strokeWidth={1}
      style={[styles.corner, c.at, { transform: [...c.flip] }]}
    >
      <Path d={CORNER[civ]} />
    </Svg>
  ));
}

// ── the dock: composer, or what replaces it ────────────────────────────

function Dock({
  mode,
  draft,
  onDraft,
  onSend,
  secondary,
  hallName,
  onHall,
  bottom,
}: {
  mode: ChatMode;
  draft: string;
  onDraft: (v: string) => void;
  /** Called with the text to send — on iOS, what the field holds once the keyboard has committed it. */
  onSend: (text: string) => void;
  secondary: boolean;
  hallName: string;
  onHall: () => void;
  bottom: number;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const input = useRef<TextInput>(null);
  const pad = { paddingBottom: 16 + bottom, borderTopColor: t.hair };
  const { press, onEndEditing } = useCommittedSend(input, draft, onSend);
  switch (mode.kind) {
    case "outgoing_locked":
      return (
        <View testID="dock-locked" style={[styles.dock, pad, { backgroundColor: t.s1 }]}>
          <View style={[styles.lockedLine, { borderColor: t.hair2 }]}>
            <Txt variant="body" tone="subtle">
              {tr("soul_app.chat.request.locked")}
            </Txt>
          </View>
          <View style={styles.nextAt}>
            <View style={styles.nudge}>
              <Icon name="clock" size={14} color={t.inkSubtle} strokeWidth={1.3} />
            </View>
            <Interp
              testID="next-at"
              variant="caption"
              tone="muted"
              style={styles.fill}
              text={tr("soul_app.chat.request.next_at")}
              parts={{ time: <Mono>{formatStamp(mode.nextAt) ?? ""}</Mono> }}
            />
          </View>
        </View>
      );
    case "muted":
    case "closed":
      return <View style={{ height: bottom }} />;
    case "hall_sealed":
      return (
        <View style={[styles.dock, pad]}>
          <Button testID="go-current-hall" kind="secondary" title={tr("soul_app.chat.hall.go_current", { hall: hallName })} onPress={onHall} />
        </View>
      );
    default: {
      const placeholder =
        mode.kind === "incoming" ? "soul_app.chat.compose.reply_placeholder" : mode.kind === "hall" ? "soul_app.chat.compose.hall_placeholder" : "soul_app.chat.compose.placeholder";
      const size = ANDROID ? 48 : 44;
      return (
        <View testID="composer" style={[styles.dock, styles.composer, pad]}>
          <TextInput
            ref={input}
            testID="compose"
            accessibilityLabel={tr(placeholder)}
            value={draft}
            onChangeText={onDraft}
            onEndEditing={onEndEditing}
            placeholder={tr(placeholder)}
            placeholderTextColor={t.inkSubtle}
            multiline
            maxLength={4000}
            style={[styles.input, { minHeight: size, backgroundColor: t.s1, borderColor: t.hair, color: t.ink, fontFamily: quoteFamily(draft || tr(placeholder)) }]}
          />
          <Pressable
            testID="send"
            accessibilityRole="button"
            accessibilityLabel={tr("soul_app.chat.compose.send")}
            accessibilityState={{ disabled: !draft.trim() }}
            onPress={press}
            style={({ pressed }) => [
              styles.send,
              { minHeight: size, minWidth: size },
              secondary
                ? { borderWidth: 1, borderColor: t.hair2, backgroundColor: pressed ? t.s1 : "transparent" }
                : { backgroundColor: pressed ? shade(t.plaqueFill) : t.plaqueFill },
            ]}
          >
            {ANDROID ? (
              <Icon name="send" size={20} color={secondary ? t.inkSubtle : t.onPlaque} strokeWidth={1.5} />
            ) : (
              <Txt testID={secondary ? "send-secondary" : "send-primary"} style={[styles.sendText, { color: secondary ? t.inkSubtle : t.onPlaque }]}>
                {tr("soul_app.chat.compose.send")}
              </Txt>
            )}
          </Pressable>
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { alignItems: "center" },
  pad: { padding: 20 },
  noSpacing: { letterSpacing: 0 },
  underline: { textDecorationLine: "underline" },
  inlineMono: { fontSize: 12, lineHeight: 19 },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  icon: { width: ANDROID ? 48 : 44, height: ANDROID ? 48 : 44, alignItems: "center", justifyContent: "center" },
  subtitle: { fontSize: 11, lineHeight: 15 },
  hallHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingRight: 16 },
  hallSub: { fontSize: 11, lineHeight: 17, marginTop: 2 },
  unavailable: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  square: { width: 9, height: 9 },
  smallButton: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4, minHeight: ANDROID ? 48 : 32, justifyContent: "center" },
  band: { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  bandRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bandButton: { marginTop: 12 },
  nudge: { marginTop: 2 },
  // flex-end in the inverted list is the visual top: a short thread starts under the band, as before.
  thread: { paddingHorizontal: 20, paddingVertical: 16, flexGrow: 1, justifyContent: "flex-end" },
  sealed: { opacity: 0.88 },
  older: { alignItems: "center", paddingBottom: 16 },
  day: { textAlign: "center", fontSize: 11, marginBottom: 16 },
  bubbleRow: { flexDirection: "row", marginBottom: 16 },
  mineRow: { justifyContent: "flex-end" },
  bubble: { maxWidth: "76%", borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  officer: { maxWidth: "82%", padding: 24 },
  corner: { position: "absolute" },
  body: { fontSize: 15, lineHeight: 26 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  metaMine: { justifyContent: "flex-end" },
  metaTime: { fontSize: 11, lineHeight: 14 },
  metaText: { fontSize: 11, lineHeight: 14, letterSpacing: 0 },
  newTag: { position: "absolute", right: 10, top: -9, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  newTagText: { fontFamily: family.ui[500], fontSize: 11, lineHeight: 16, letterSpacing: 1.1 },
  byline: { flexDirection: "row", alignItems: "center", gap: 8 },
  bylineText: { fontFamily: family.ui[600], fontSize: 11, lineHeight: 16, letterSpacing: 1.1 },
  officerBody: { fontSize: 15, lineHeight: 28, marginTop: 8 },
  officerTime: { marginTop: 8 },
  rejected: { marginTop: 2 },
  dock: { paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1 },
  composer: { flexDirection: "row", gap: 12, alignItems: "flex-end" },
  input: { flex: 1, borderWidth: 1, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, fontSize: 15, lineHeight: 20, maxHeight: 140 },
  send: { paddingHorizontal: ANDROID ? 0 : 16, alignItems: "center", justifyContent: "center" },
  sendText: { fontFamily: family.ui[600], fontSize: 13, lineHeight: 18 },
  lockedLine: { minHeight: 44, borderWidth: 1, borderStyle: "dotted", justifyContent: "center", paddingHorizontal: 12 },
  nextAt: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 12 },
});
