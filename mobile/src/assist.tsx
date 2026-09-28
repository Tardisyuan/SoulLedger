/**
 * 「问一问」 — the in-app help assistant (canvas「灵魂簿 App · 问一问」,
 * docs/ARCHITECTURE-soul-assist.md). This file holds the state and the header
 * entry; the drawer itself is `assistPanel.tsx`, mounted beside the navigator.
 *
 * The state lives above the navigator, not in the drawer: closing the drawer
 * while an answer is on its way does not lose it (1e「抽屉可关,关后回答仍会到」).
 *
 * WHEN THE ENTRY SHOWS. `/me/`'s `assistant_enabled` false → never rendered
 * (1a 三). Shown, and the server then answers 503 `assistant_not_configured`
 * (the profile was stale) → the drawer says so (1g ①) and the entry is hidden
 * for the rest of this session.
 */
import type { MeProfile } from "@soulledger/core/api/soul";
import {
  ASSIST_TIMEOUT_MS,
  soulAssistApi,
  soulAssistErrorCode,
  soulAssistRetryAt,
  type AssistConversation,
  type AssistMessage,
  type AssistScreen,
} from "@soulledger/core/api/soul-assist";
import { platform } from "@soulledger/core/platform";
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

export interface Pending {
  question: string;
  at: string;
}

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
  cancel: () => void;
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

const TIMEOUT = "assist-timeout";
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
      setPending({ question, at });
      setFailure(null);
      setDraft("");
      AccessibilityInfo.announceForAccessibility(t("soul_app.assist.waiting"));
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Our own 25 s, not axios's `timeout`: that one lives in the platform adapter.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(TIMEOUT)), ASSIST_TIMEOUT_MS);
      });
      Promise.race([soulAssistApi.ask({ question, screen, conversation_id: id ?? undefined }, controller.signal), timeout])
        .then(
          (res) => {
            if (waiting.current !== controller) return;
            const mine: AssistMessage = { id: -Date.now(), role: "user", content: question, created_at: at };
            setThread((th) => ({ id: res.conversation_id, screen, messages: [...(th.messages ?? []), mine, res.answer] }));
            AccessibilityInfo.announceForAccessibility(t("soul_app.assist.answered"));
          },
          (error: unknown) => {
            if (waiting.current !== controller) return;
            controller.abort();
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
            setFailure({ kind: "unanswered", question, at, timeout: error instanceof Error && error.message === TIMEOUT });
          }
        )
        .finally(() => {
          clearTimeout(timer);
          if (waiting.current === controller) {
            waiting.current = null;
            setPending(null);
          }
        });
    },
    [thread, t]
  );

  /** Stop waiting. The server still answers and stores it; reopening shows it. */
  const cancel = useCallback(() => {
    waiting.current?.abort();
    waiting.current = null;
    setPending(null);
  }, []);

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
      cancel,
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
        setThread({ id: c.id, screen: c.screen, messages: c.messages });
      },
      startNew: () => {
        setFailure(null);
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
      <Text style={[styles.glyphText, { color }]}>{glyph}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  entry: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  glyph: { width: 20, height: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  glyphText: { fontSize: 12, lineHeight: 14 },
});
