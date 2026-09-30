/**
 * 「问一问」 — the in-app help assistant (canvas「灵魂簿 App · 问一问」,
 * docs/ARCHITECTURE-soul-assist.md). This file holds the state and the header
 * entry; the drawer itself is `assistPanel.tsx`, mounted beside the navigator.
 *
 * The state lives above the navigator, not in the drawer: closing the drawer
 * while an answer is on its way does not lose it (1e「抽屉可关,关后回答仍会到」).
 *
 * ANSWERS STREAM (canvas「问一问 · 流式输出」, §13): the question goes out with
 * `stream: true` through `expo/fetch`. React Native's own `fetch` (whatwg-fetch
 * over XHR) exposes no readable `body`, so it can only hand over the whole
 * answer at the end; Expo's WinterCG `fetch` reads the body as it arrives and
 * aborts with an `AbortController` — which is how stop closes the connection.
 * It is already a dependency (expo 57) and installs `TextDecoder` for us, so
 * this is one import rather than an XHR `onprogress` reader.
 *
 * WHEN THE ENTRY SHOWS. `/me/`'s `assistant_enabled` false → never rendered
 * (1a 三). Shown, and the server then answers 503 `assistant_not_configured`
 * (the profile was stale) → the drawer says so (1g ①) and the entry is hidden
 * for the rest of this session.
 */
import type { MeProfile } from "@soulledger/core/api/soul";
import type { AssistStreamEnd, AssistStreamEvent, AssistStreamFetch } from "@soulledger/core/api/assist-stream";
import {
  soulAssistApi,
  soulAssistErrorCode,
  soulAssistRetryAt,
  type AssistConversation,
  type AssistMessage,
  type AssistScreen,
} from "@soulledger/core/api/soul-assist";
import { platform } from "@soulledger/core/platform";
import { fetch as expoFetch } from "expo/fetch";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "./i18n";
import { useTheme } from "./ui";

/** Decision A4: the same page within 30 minutes continues the last conversation. */
export const ASSIST_CONTINUE_MS = 30 * 60 * 1000;

/**
 * 1h「每个账号只显示一次」. There is no server field for it, so it is kept on
 * the device per soul account (soul code + life): a new device shows it again.
 */
export const assistAckKey = (profile: MeProfile) => `soulledger.assist.ack.${profile.soul_code}.${profile.account.cycle}`;

export type AssistFailure =
  | { kind: "not_configured" }
  | { kind: "limited"; retryAt: string | null }
  | { kind: "unanswered"; question: string; at: string; timeout: boolean };

/** The question being answered: the text streams into `text`; `slow` is 20 s with nothing yet (A1). */
export interface Pending {
  question: string;
  at: string;
  text: string;
  slow: boolean;
}

/** 流式输出 A1: past this with no text yet, the waiting line reads 「还在查……」. */
export const ASSIST_SLOW_MS = 20_000;

/** Expo's `fetch`, in the shape `streamAssist` takes. */
const streamFetch: AssistStreamFetch = (url, init) => expoFetch(url, init as Parameters<typeof expoFetch>[1]);

/** What the drawer is showing: `null` messages while the resumable conversation is looked up. */
export interface Thread {
  id: string | null;
  screen: AssistScreen;
  messages: AssistMessage[] | null;
}

export interface Assist {
  /** The header entry is rendered at all. */
  visible: boolean;
  /** The drawer is open, from this page. */
  openFrom: AssistScreen | null;
  open: (screen: AssistScreen) => void;
  close: () => void;
  thread: Thread;
  pending: Pending | null;
  failure: AssistFailure | null;
  draft: string;
  setDraft: (text: string) => void;
  ask: (question: string) => void;
  /** A5: close the connection; the server stores what was written, and so does the thread here. */
  stop: () => void;
  /** A9: the one answer 「重试」 shows on — interrupted here, the latest; never one from history. */
  retryable: number | null;
  /** A7: re-ask that answer's question; the new answer replaces it. */
  retryInterrupted: () => void;
  /** 1g ③「改一改再问」: the question back in the box. */
  edit: () => void;
  acked: boolean;
  ack: () => void;
  history: AssistConversation[] | null;
  loadHistory: () => void;
  openConversation: (c: AssistConversation) => void;
  startNew: () => void;
  remove: (id: string) => Promise<void>;
  openLetters: (() => void) | null;
}

const AssistContext = createContext<Assist | null>(null);
/** `null` outside a signed-in session: the header then has no entry. */
export const useAssist = () => useContext(AssistContext);

const EMPTY: Thread = { id: null, screen: "other", messages: [] };

export function AssistProvider({
  profile,
  onOpenLetters,
  children,
}: {
  /** `null` signed out: no entry. A different account starts from nothing. */
  profile: MeProfile | null;
  /** Letters · the hall inbox (1g ① / ④); `null` where this deployment has no letters. */
  onOpenLetters: (() => void) | null;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);
  const [openFrom, setOpenFrom] = useState<AssistScreen | null>(null);
  const [thread, setThread] = useState<Thread>(EMPTY);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failure, setFailure] = useState<AssistFailure | null>(null);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<AssistConversation[] | null>(null);
  const [retryable, setRetryable] = useState<number | null>(null);
  const ackKey = profile ? assistAckKey(profile) : null;
  const [ackedFor, setAckedFor] = useState<string | null>(null);
  const acked = ackKey !== null && (ackedFor === ackKey || !!platform().persistent.get(ackKey));
  /** The request being waited for; a cancelled or timed-out one is dropped when it lands. */
  const waiting = useRef<AbortController | null>(null);

  // Signed out, or another account: nothing of the previous one's carries over,
  // and an answer still on its way for it is dropped when it lands.
  const [owner, setOwner] = useState(ackKey);
  if (owner !== ackKey) {
    setOwner(ackKey);
    setHidden(false);
    setOpenFrom(null);
    setThread(EMPTY);
    setPending(null);
    setFailure(null);
    setDraft("");
    setHistory(null);
    setRetryable(null);
  }
  useEffect(
    () => () => {
      waiting.current?.abort();
      waiting.current = null;
    },
    [ackKey]
  );

  const fetchHistory = useCallback(async () => {
    const list = await soulAssistApi.conversations();
    setHistory(list);
    return list;
  }, []);

  const open = useCallback(
    (screen: AssistScreen) => {
      setOpenFrom(screen);
      // An answer on its way, or the not-open notice: keep what the drawer was showing.
      if (waiting.current || failure?.kind === "not_configured") return;
      setFailure(null);
      setThread({ id: null, screen, messages: null });
      // A 30-minute-fresh conversation from this page is continued (A4) — including
      // one whose answer arrived after a cancel (1e: reopening shows it).
      fetchHistory()
        .then((list) => {
          const recent = list.find((c) => c.screen === screen && Date.now() - Date.parse(c.last_active_at) < ASSIST_CONTINUE_MS);
          setThread({ id: recent?.id ?? null, screen, messages: recent?.messages ?? [] });
        })
        .catch(() => setThread({ id: null, screen, messages: [] }));
    },
    [failure, fetchHistory]
  );

  const close = useCallback(() => {
    setOpenFrom(null);
    if (failure?.kind === "not_configured") setHidden(true);
  }, [failure]);

  const ask = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question || waiting.current) return;
      const controller = new AbortController();
      waiting.current = controller;
      const at = new Date().toISOString();
      const { id, screen } = thread;
      let text = "";
      let conversationId = id;
      let ended: Extract<AssistStreamEvent, { event: "done" | "error" }> | null = null;
      setPending({ question, at, text: "", slow: false });
      setFailure(null);
      setRetryable(null);
      setDraft("");
      AccessibilityInfo.announceForAccessibility(t("soul_app.assist.waiting"));
      const slow = setTimeout(() => setPending((p) => (p && !p.text ? { ...p, slow: true } : p)), ASSIST_SLOW_MS);
      const mine: AssistMessage = { id: -Date.now(), role: "user", content: question, interruption: "", created_at: at };
      /** The answer as far as it got, kept with its marker (A6 / A7). */
      const keep = (interruption: "stopped" | "interrupted", messageId?: number) => {
        const answer: AssistMessage = { id: messageId ?? -Date.now() - 1, role: "assistant", content: text, interruption, created_at: new Date().toISOString() };
        setThread((th) => ({ id: conversationId, screen, messages: [...(th.messages ?? []), mine, answer] }));
        AccessibilityInfo.announceForAccessibility(`${t(`soul_app.assist.${interruption}`)} ${text}`.trim());
        if (interruption === "interrupted") setRetryable(answer.id);
      };
      const onEvent = (event: AssistStreamEvent) => {
        if (waiting.current !== controller) return;
        if (event.event === "meta") conversationId = event.conversation_id;
        if (event.event === "delta") {
          if (!text) AccessibilityInfo.announceForAccessibility(t("soul_app.assist.answering_aria"));
          text += event.text;
          setPending((p) => (p ? { ...p, text, slow: false } : p));
        }
        if (event.event === "done" || event.event === "error") ended = event;
      };
      const finish = (how: AssistStreamEnd) => {
        if (waiting.current !== controller) return;
        const end = ended;
        if (end?.event === "done") {
          setThread((th) => ({ id: end.conversation_id, screen, messages: [...(th.messages ?? []), mine, end.answer] }));
          AccessibilityInfo.announceForAccessibility(end.answer.content);
        } else if (how === "stopped") {
          keep("stopped");
        } else if (text) {
          // Broke after text: the server kept what was sent (A7) — an `interrupted` event or a lost connection alike.
          if (end?.event === "error" && end.conversation_id) conversationId = end.conversation_id;
          keep("interrupted", end?.event === "error" ? end.message_id : undefined);
        } else {
          // Nothing arrived: the backend already tried the backup (A8) — the old 「没有答上来」.
          setDraft(question);
          setFailure({ kind: "unanswered", question, at, timeout: how === "timeout" });
        }
      };
      soulAssistApi
        .stream(streamFetch, { question, screen, conversation_id: id ?? undefined }, controller, onEvent)
        .then(finish, (error: unknown) => {
          if (waiting.current !== controller) return;
          const code = soulAssistErrorCode(error);
          if (code === "assistant_not_configured") {
            setFailure({ kind: "not_configured" });
            return;
          }
          // The question goes back in the box for every refusal the soul can wait out.
          setDraft(question);
          if (code === "rate_limited") {
            setFailure({ kind: "limited", retryAt: soulAssistRetryAt(error) });
            return;
          }
          // The conversation was deleted meanwhile: the retry starts a new one.
          if (code === "not_found") setThread((th) => ({ ...th, id: null }));
          setFailure({ kind: "unanswered", question, at, timeout: false });
        })
        .finally(() => {
          clearTimeout(slow);
          if (waiting.current === controller) {
            waiting.current = null;
            setPending(null);
          }
        });
    },
    [thread, t]
  );

  const stop = useCallback(() => waiting.current?.abort(), []);

  const value: Assist = {
      visible: profile?.assistant_enabled === true && !hidden,
      openFrom,
      open,
      close,
      thread,
      pending,
      failure,
      draft,
      setDraft,
      ask,
      stop,
      retryable,
      retryInterrupted: () => {
        const messages = thread.messages ?? [];
        const at = messages.findIndex((m) => m.id === retryable);
        if (at < 1) return;
        const question = messages[at - 1].content;
        setThread((th) => ({ ...th, messages: (th.messages ?? []).slice(0, at - 1) }));
        ask(question);
      },
      edit: () => {
        if (failure?.kind === "unanswered") setDraft(failure.question);
        setFailure(null);
      },
      acked,
      ack: () => {
        if (!ackKey) return;
        platform().persistent.set(ackKey, "1");
        setAckedFor(ackKey);
      },
      history,
      loadHistory: () => void fetchHistory().catch(() => setHistory((h) => h ?? [])),
      openConversation: (c) => {
        setFailure(null);
        setRetryable(null);
        setThread({ id: c.id, screen: c.screen, messages: c.messages });
      },
      startNew: () => {
        setFailure(null);
        setRetryable(null);
        setThread((th) => ({ id: null, screen: openFrom ?? th.screen, messages: [] }));
      },
      remove: async (id) => {
        await soulAssistApi.deleteConversation(id);
        setHistory((h) => h?.filter((c) => c.id !== id) ?? null);
        setThread((th) => (th.id === id ? { id: null, screen: th.screen, messages: [] } : th));
      },
      openLetters: onOpenLetters
        ? () => {
            close();
            onOpenLetters();
          }
        : null,
  };

  return <AssistContext.Provider value={value}>{children}</AssistContext.Provider>;
}

/**
 * 1b: a 20pt line-drawn square with 问 in `--sub` — the account icon's weight,
 * never the accent. Pressed: the s2 ground for a moment, no ripple.
 */
export function AssistEntry({ screen }: { screen: AssistScreen }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const assist = useAssist();
  if (!assist?.visible) return null;
  return (
    <Pressable
      testID="assist-entry"
      accessibilityRole="button"
      accessibilityLabel={tr("soul_app.assist.entry_label")}
      onPress={() => assist.open(screen)}
      style={({ pressed }) => [styles.entry, pressed && { backgroundColor: t.s2 }]}
    >
      <AskGlyph color={t.inkSubtle} />
    </Pressable>
  );
}

/** The 问 square: the entry (in `--sub`) and the drawer head's seal (in the civilization's mark). */
export function AskGlyph({ color, glyph = "问" }: { color: string; glyph?: string }) {
  return (
    <View style={[styles.glyph, { borderColor: color }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {/* An icon, not prose: its 20pt box does not grow with the system font scale, so the
          character must not either — at 1.8× it overflowed the box and was clipped. */}
      <Text allowFontScaling={false} style={[styles.glyphText, { color }]}>
        {glyph}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  entry: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  glyph: { width: 20, height: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  glyphText: { fontSize: 12, lineHeight: 14 },
});
