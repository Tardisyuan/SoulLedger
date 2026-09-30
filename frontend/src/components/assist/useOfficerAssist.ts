"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ASSIST_TIMEOUT_MS,
  officerAssistApi,
  officerAssistErrorCode,
  officerAssistRetryAt,
  officerAssistScreen,
  type OfficerAssistConversation,
  type OfficerAssistMessage,
  type OfficerAssistScreen,
} from "@soulledger/core/api/officer-assist";
import { officerAssistKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";

/**
 * 「问一问」 on the officer console (canvas 「灵魂簿 官员端 · 问一问」). The state
 * lives in AppLayout, not in the panel: closing the panel while an answer is on
 * its way does not lose it (1d「关掉面板回答仍会到」), and navigating keeps it
 * open (1a 一「换页不关」).
 *
 * WHEN THE ENTRY SHOWS. The officer side has no profile flag like the soul
 * side's `assistant_enabled`, and this deliberately adds none: the entry is
 * shown to every signed-in officer, and the first 503 `assistant_not_configured`
 * shows notice ① (1f) and hides the entry for the rest of the tab's session.
 * One wasted question per session per unconfigured hall, and no backend or
 * schema change.
 */

/** Decision A4: the same page within 30 minutes continues the last conversation. */
export const ASSIST_CONTINUE_MS = 30 * 60 * 1000;
/** 1d: past this the waiting line adds 「还在查」 and a cancel. */
export const ASSIST_SLOW_MS = 6_000;

const OPEN_KEY = (userId: number) => `soulledger.officer_assist.open.${userId}`;
const OFF_KEY = (userId: number) => `soulledger.officer_assist.off.${userId}`;
const TIMEOUT = "officer-assist-timeout";

export type OfficerAssistFailure =
  | { kind: "not_configured" }
  | { kind: "limited"; retryAt: string | null }
  | { kind: "unanswered"; question: string; at: string; timeout: boolean };

export interface OfficerAssistThread {
  id: string | null;
  messages: OfficerAssistMessage[];
}

const EMPTY: OfficerAssistThread = { id: null, messages: [] };

function readStore(store: () => Storage, key: string): boolean {
  try {
    return store().getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeStore(store: () => Storage, key: string, on: boolean) {
  try {
    if (on) store().setItem(key, "1");
    else store().removeItem(key);
  } catch {
    // storage unavailable (private mode): the state just does not outlive the tab
  }
}

export function useOfficerAssist(wide: boolean) {
  const { t } = useI18n();
  const { user } = useTenant();
  const userId = user?.id ?? null;
  const screen: OfficerAssistScreen = officerAssistScreen(usePathname() ?? "/");
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [thread, setThread] = useState<OfficerAssistThread>(EMPTY);
  const [pending, setPending] = useState<{ question: string; at: string; slow: boolean } | null>(null);
  const [failure, setFailure] = useState<OfficerAssistFailure | null>(null);
  const [draft, setDraft] = useState("");
  const [unseen, setUnseen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [hidden, setHidden] = useState(false);

  const entryRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  /** The request being waited for; a cancelled or timed-out one is dropped when it lands. */
  const waiting = useRef<AbortController | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const focusNext = useRef<"input" | "entry" | null>(null);

  // A different officer (or none): nothing of the previous one's carries over.
  const [owner, setOwner] = useState(userId);
  if (owner !== userId) {
    setOwner(userId);
    setOpen(false);
    setView("chat");
    setThread(EMPTY);
    setPending(null);
    setFailure(null);
    setDraft("");
    setUnseen(false);
    setHidden(false);
  }
  useEffect(() => {
    if (userId === null) return;
    // After mount, not during render: storage does not exist on the server.
    setHidden(readStore(() => sessionStorage, OFF_KEY(userId)));
    if (wide && readStore(() => localStorage, OPEN_KEY(userId))) setOpen(true);
    return () => {
      waiting.current?.abort();
      waiting.current = null;
    };
    // `wide` is read once per officer: the remembered state restores on load, not on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!open && focusNext.current === "entry") entryRef.current?.focus();
    if (open && focusNext.current === "input") inputRef.current?.focus();
    focusNext.current = null;
  }, [open]);

  const listKey = officerAssistKeys.conversations(userId ?? 0);
  const fetchList = useCallback(
    () => queryClient.fetchQuery({ queryKey: listKey, queryFn: officerAssistApi.conversations, staleTime: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, userId]
  );

  const show = useCallback(() => {
    focusNext.current = "input";
    setOpen(true);
    setUnseen(false);
    if (userId !== null) writeStore(() => localStorage, OPEN_KEY(userId), true);
    // Resume a 30-minute-fresh conversation from this page (A4) — the server
    // would continue it anyway, and an empty panel over a continued thread misleads.
    if (waiting.current || thread.messages.length > 0 || thread.id || failure) return;
    fetchList()
      .then((list) => {
        const recent = list.find(
          (c) => c.screen === screen && Date.now() - Date.parse(c.last_active_at) < ASSIST_CONTINUE_MS
        );
        if (recent) setThread((th) => (th.id || th.messages.length ? th : { id: recent.id, messages: recent.messages }));
      })
      .catch(() => {});
  }, [userId, thread, failure, fetchList, screen]);

  const close = useCallback(() => {
    focusNext.current = "entry";
    setOpen(false);
    setView("chat");
    if (userId !== null) writeStore(() => localStorage, OPEN_KEY(userId), false);
    if (failure?.kind === "not_configured") {
      setHidden(true);
      if (userId !== null) writeStore(() => sessionStorage, OFF_KEY(userId), true);
    }
  }, [failure, userId]);

  const toggle = useCallback(() => (openRef.current ? close() : show()), [close, show]);

  const ask = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question || waiting.current) return;
      const controller = new AbortController();
      waiting.current = controller;
      const at = new Date().toISOString();
      setPending({ question, at, slow: false });
      setFailure(null);
      setDraft("");
      setAnnounce("");
      const slow = setTimeout(() => setPending((p) => (p ? { ...p, slow: true } : p)), ASSIST_SLOW_MS);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(TIMEOUT)), ASSIST_TIMEOUT_MS);
      });
      Promise.race([
        officerAssistApi.ask({ question, screen, conversation_id: thread.id ?? undefined }, controller.signal),
        timeout,
      ])
        .then(
          (res) => {
            if (waiting.current !== controller) return;
            const mine: OfficerAssistMessage = { id: -Date.now(), role: "user", content: question, created_at: at };
            setThread((th) => ({ id: res.conversation_id, messages: [...th.messages, mine, res.answer] }));
            setAnnounce(t("officer_assist.answered"));
            if (!openRef.current) setUnseen(true);
            void queryClient.invalidateQueries({ queryKey: officerAssistKeys.all });
          },
          (error: unknown) => {
            if (waiting.current !== controller) return;
            controller.abort();
            const code = officerAssistErrorCode(error);
            if (code === "assistant_not_configured") {
              setFailure({ kind: "not_configured" });
              return;
            }
            // Every refusal the officer can wait out keeps the question in the box.
            setDraft(question);
            if (code === "rate_limited") {
              setFailure({ kind: "limited", retryAt: officerAssistRetryAt(error) });
              return;
            }
            // The conversation was deleted meanwhile: the retry starts a new one.
            if (code === "not_found") setThread((th) => ({ ...th, id: null }));
            setFailure({ kind: "unanswered", question, at, timeout: error instanceof Error && error.message === TIMEOUT });
          }
        )
        .finally(() => {
          clearTimeout(slow);
          clearTimeout(timer);
          if (waiting.current === controller) {
            waiting.current = null;
            setPending(null);
          }
        });
    },
    [screen, thread.id, t, queryClient]
  );

  /** Stop waiting. The server still answers and stores it; it shows up in 历史. */
  const cancel = useCallback(() => {
    waiting.current?.abort();
    waiting.current = null;
    setPending(null);
  }, []);

  // ⌘/Ctrl+J anywhere; F6 between the page and the pushed panel (1a 三).
  useEffect(() => {
    if (userId === null || hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
        return;
      }
      // Esc from inside the pushed panel (the drawer's own Dialog handles it there). A
      // confirm dialog opened from the panel is portalled outside it, so its Esc stays its own.
      if (e.key === "Escape" && openRef.current && wide && !e.defaultPrevented &&
          panelRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "F6" && openRef.current && wide) {
        e.preventDefault();
        const inPanel = panelRef.current?.contains(document.activeElement) ?? false;
        (inPanel ? mainRef.current : inputRef.current ?? panelRef.current)?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [userId, hidden, toggle, close, wide]);

  return {
    /** The header entry is rendered at all. */
    visible: userId !== null && !hidden,
    open,
    pushed: open && wide,
    screen,
    role: user?.role ?? "VIEWER",
    view,
    setView,
    thread,
    pending,
    failure,
    draft,
    setDraft,
    unseen,
    announce,
    entryRef,
    inputRef,
    panelRef,
    mainRef,
    show,
    close,
    toggle,
    ask,
    cancel,
    retry: () => failure?.kind === "unanswered" && ask(failure.question),
    edit: () => {
      if (failure?.kind === "unanswered") setDraft(failure.question);
      setFailure(null);
      inputRef.current?.focus();
    },
    startNew: () => {
      setFailure((f) => (f?.kind === "not_configured" ? f : null));
      setThread(EMPTY);
      setView("chat");
    },
    openConversation: (c: OfficerAssistConversation) => {
      setFailure(null);
      setThread({ id: c.id, messages: c.messages });
      setView("chat");
    },
    remove: async (id: string) => {
      await officerAssistApi.deleteConversation(id);
      await queryClient.invalidateQueries({ queryKey: officerAssistKeys.all });
      setThread((th) => (th.id === id ? EMPTY : th));
    },
    listKey,
  };
}

export type OfficerAssist = ReturnType<typeof useOfficerAssist>;
