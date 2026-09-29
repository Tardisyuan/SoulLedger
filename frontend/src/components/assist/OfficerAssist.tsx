"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import {
  isOfficerEmptyAnswer,
  officerAssistApi,
  type OfficerAssistConversation,
  type OfficerAssistMessage,
  type OfficerAssistScreen,
} from "@soulledger/core/api/officer-assist";
import { useI18n } from "@/src/contexts/I18nContext";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { officerAssistSuggestions } from "./officerAssistSuggestions";
import type { OfficerAssist } from "./useOfficerAssist";

/**
 * Canvas 「灵魂簿 官员端 · 问一问」: the header entry (1b) and the panel
 * (1c–1g). ≥ 1024 px the panel is pushed beside the page — a complementary
 * region that takes no focus on its own and locks nothing; below it is a right
 * drawer over a scrim, and then, only then, a modal dialog. The 1024–1279
 * narrower page padding lives on AppLayout's content wrapper.
 *
 * Colours are the console's tokens (ink / line / block / accent), not the
 * canvas's hex values. Nothing here approves, submits or assigns: the panel
 * only reads (1a 四).
 */

/** A page's title, from the page's own namespace; everything else is 「其他页」. */
const PAGE_TITLE: Partial<Record<OfficerAssistScreen, string>> = {
  judgment: "judgment.title",
  workflow: "workflow.title",
  dispatch: "dispatch.title",
  scheduler: "scheduler.title",
  "soul-inbox": "soul_inbox.title",
  "sentence-requests": "sentence_plan.inbox_title",
};

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The 问 / 答 square: decoration, the text beside it says the same. */
function Seal({ glyph }: { glyph: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center border border-[oklch(var(--color-accent-ink))] text-2xs text-[oklch(var(--color-accent-ink))]"
    >
      {glyph}
    </span>
  );
}

function AskIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2" width="16" height="16" />
      <path d="M7.6 7.4a2.4 2.4 0 1 1 3.6 2.1c-.8.5-1.2 1-1.2 1.9v.5M10 14.6h.01" strokeLinecap="square" />
    </svg>
  );
}

/** 1b: after the connection state, before notifications; outlined, never the accent fill. */
export function OfficerAssistEntry({ assist }: { assist: OfficerAssist }) {
  const { t } = useI18n();
  if (!assist.visible) return null;
  const shortcut = isMac() ? "⌘J" : "Ctrl+J";
  return (
    <button
      ref={assist.entryRef}
      type="button"
      data-testid="officer-assist-entry"
      onClick={assist.toggle}
      aria-expanded={assist.open}
      aria-label={t("officer_assist.entry_label", { shortcut })}
      title={shortcut}
      className="relative flex h-7 items-center gap-1.5 border border-[oklch(var(--color-line))] px-2 text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))] aria-expanded:bg-[oklch(var(--color-surface-2))] aria-expanded:text-[oklch(var(--color-ink))] max-lg:w-8 max-lg:justify-center max-lg:px-0"
    >
      <AskIcon />
      <span className="hidden lg:inline">{t("officer_assist.entry")}</span>
      {assist.unseen ? (
        <span data-testid="officer-assist-unseen" aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 bg-[oklch(var(--color-accent))]" />
      ) : null}
    </button>
  );
}

export function OfficerAssistPanel({ assist }: { assist: OfficerAssist }) {
  const { t } = useI18n();
  if (!assist.open) return null;
  const label = t("officer_assist.title");

  if (assist.pushed) {
    return (
      <aside
        ref={assist.panelRef}
        aria-label={label}
        data-testid="officer-assist-panel"
        className="fixed bottom-0 right-0 top-10 z-masthead flex w-[420px] flex-col border-l border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))]"
      >
        <PanelBody assist={assist} />
      </aside>
    );
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) assist.close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-dialog bg-[oklch(var(--color-scrim)/var(--scrim-alpha))]" />
        <Dialog.Popup
          ref={(node) => {
            assist.panelRef.current = node;
          }}
          aria-label={label}
          aria-modal="true"
          data-testid="officer-assist-panel"
          initialFocus={assist.inputRef}
          finalFocus={assist.entryRef}
          className="fixed inset-y-0 right-0 z-dialog flex w-[min(420px,100vw)] flex-col border-l border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] shadow-overlay"
        >
          <PanelBody assist={assist} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function useClock() {
  const { t, formatDateTime } = useI18n();
  const hm = (iso: string) => formatDateTime(iso, { hour: "2-digit", minute: "2-digit" });
  return {
    hm,
    /** 1e: 「今天 10:12」, or 「09-27 16:05」. */
    when: (iso: string) =>
      new Date(iso).toDateString() === new Date().toDateString()
        ? `${t("officer_assist.today")} ${hm(iso)}`
        : formatDateTime(iso, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  };
}

function usePageTitle() {
  const { t } = useI18n();
  return (screen: OfficerAssistScreen) => {
    const key = PAGE_TITLE[screen];
    return key ? t(key) : t("officer_assist.page_other");
  };
}

function HeadButton({ onClick, children, label }: { onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="h-7 px-2 text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))]"
    >
      {children}
    </button>
  );
}

function PanelBody({ assist }: { assist: OfficerAssist }) {
  const { t } = useI18n();
  const history = assist.view === "history";
  const hasThread = assist.thread.messages.length > 0 || assist.pending !== null;
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[oklch(var(--color-block))] px-3">
        {history ? (
          <HeadButton onClick={() => assist.setView("chat")} label={t("officer_assist.back_label")}>←</HeadButton>
        ) : (
          <Seal glyph="问" />
        )}
        <span className="text-sm text-[oklch(var(--color-ink))]">
          {history ? t("officer_assist.history_title") : t("officer_assist.title")}
        </span>
        {!history ? (
          <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("officer_assist.read_only")}</span>
        ) : null}
        <span className="flex-1" />
        {!history ? <HeadButton onClick={() => assist.setView("history")}>{t("officer_assist.history")}</HeadButton> : null}
        {history || hasThread ? <HeadButton onClick={assist.startNew}>{t("officer_assist.new")}</HeadButton> : null}
        <HeadButton onClick={assist.close} label={t("officer_assist.close")}>✕</HeadButton>
      </div>
      <p aria-live="polite" className="sr-only">
        {assist.announce}
      </p>
      {history ? <History assist={assist} /> : <Chat assist={assist} />}
    </>
  );
}

function Notice({ tone = "info", role, children }: { tone?: "info" | "warn"; role?: "alert"; children: ReactNode }) {
  const border = tone === "warn" ? "border-[oklch(var(--color-warning))]" : "border-[oklch(var(--color-line))]";
  return (
    <div role={role} className={`border-l-2 ${border} bg-[oklch(var(--color-surface-1))] px-3 py-2 text-sm text-[oklch(var(--color-ink-muted))]`}>
      {children}
    </div>
  );
}

function Chat({ assist }: { assist: OfficerAssist }) {
  const { t, locale } = useI18n();
  const { hm } = useClock();
  const pageTitle = usePageTitle();
  const scroller = useRef<HTMLDivElement>(null);
  const { thread, pending, failure } = assist;

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [thread.messages.length, pending, failure]);

  if (failure?.kind === "not_configured") {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <Notice role="alert">
          <p className="mb-1 text-sm text-[oklch(var(--color-ink))]">{t("officer_assist.not_configured_title")}</p>
          <p>{t("officer_assist.not_configured_body")}</p>
        </Notice>
      </div>
    );
  }

  const empty = thread.messages.length === 0 && pending === null && failure?.kind !== "unanswered";
  const suggestions = officerAssistSuggestions(assist.role, assist.screen, locale);
  const pageName = PAGE_TITLE[assist.screen] ? pageTitle(assist.screen) : t("officer_assist.this_page");

  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {empty ? (
          <div>
            <p className="mb-2 text-xs text-[oklch(var(--color-ink-subtle))]">
              {t("officer_assist.suggest_intro", { page: pageName })}
            </p>
            <Suggestions items={suggestions} onPick={assist.ask} />
            <p className="mt-3 text-xs text-[oklch(var(--color-ink-subtle))]">{t("officer_assist.suggest_hint")}</p>
          </div>
        ) : null}
        <ol className="flex flex-col gap-4">
          {thread.messages.map((m) => (
            <li key={m.id}>{m.role === "user" ? <Question text={m.content} meta={hm(m.created_at)} /> : <Answer message={m} />}</li>
          ))}
          {pending ? (
            <li>
              <Question text={pending.question} meta={`${hm(pending.at)} · ${t("officer_assist.sent")}`} />
              <div className="mt-3" data-testid="officer-assist-waiting">
                <div className="flex items-center gap-2">
                  <Seal glyph="答" />
                  <span className="text-sm text-[oklch(var(--color-ink-muted))]">{t("officer_assist.waiting")}</span>
                </div>
                {pending.slow ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("officer_assist.waiting_long")}</span>
                    <HeadButton onClick={assist.cancel}>{t("officer_assist.cancel")}</HeadButton>
                  </div>
                ) : null}
              </div>
            </li>
          ) : null}
          {failure?.kind === "unanswered" ? (
            <li>
              <Question text={failure.question} meta={`${hm(failure.at)} · ${t("officer_assist.unanswered_mark")}`} />
              <div className="mt-3">
                <Notice tone="warn" role="alert">
                  <p>{t(failure.timeout ? "officer_assist.unanswered_timeout" : "officer_assist.unanswered")}</p>
                  <div className="mt-2 flex gap-2">
                    <HeadButton onClick={assist.retry}>{t("officer_assist.retry")}</HeadButton>
                    <HeadButton onClick={assist.edit}>{t("officer_assist.edit")}</HeadButton>
                  </div>
                </Notice>
              </div>
            </li>
          ) : null}
        </ol>
        {failure?.kind === "limited" ? <Limited retryAt={failure.retryAt} /> : null}
      </div>
      <Composer assist={assist} />
    </>
  );
}

function Suggestions({ items, onPick }: { items: readonly string[]; onPick: (q: string) => void }) {
  const list = useRef<HTMLUListElement>(null);
  // 1c: ↑↓ move between suggestions, Enter sends (the button's own Enter).
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = Array.from(list.current?.querySelectorAll("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    buttons[(at + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  };
  return (
    <ul ref={list} className="border-t border-[oklch(var(--color-line))]">
      {items.map((q) => (
        <li key={q} className="border-b border-[oklch(var(--color-line))]">
          <button
            type="button"
            onClick={() => onPick(q)}
            onKeyDown={onKeyDown}
            className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
          >
            <span>{q}</span>
            <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">→</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Your question in the serif (1a 四): the one place the panel uses it. */
function Question({ text, meta }: { text: string; meta: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="whitespace-pre-wrap font-serif text-sm text-[oklch(var(--color-ink))]">{text}</p>
      <span className="shrink-0 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{meta}</span>
    </div>
  );
}

function Answer({ message }: { message: OfficerAssistMessage }) {
  const { t } = useI18n();
  const { hm } = useClock();
  return (
    <div className="border-l border-[oklch(var(--color-block))] pl-3">
      <div className="mb-1 flex items-center gap-2">
        <Seal glyph="答" />
        <span className="flex-1" />
        <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{hm(message.created_at)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-[oklch(var(--color-ink))]">{message.content}</p>
      {isOfficerEmptyAnswer(message.content) ? (
        <div className="mt-2" data-testid="officer-assist-ask-lead">
          <Notice>{t("officer_assist.cannot_answer")}</Notice>
        </div>
      ) : null}
      <p className="mt-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("officer_assist.footnote")}</p>
    </div>
  );
}

function Limited({ retryAt }: { retryAt: string | null }) {
  const { t } = useI18n();
  const { hm } = useClock();
  return (
    <div className="mt-4">
      <Notice tone="warn" role="alert">
        <p className="mb-1 text-sm text-[oklch(var(--color-ink))]">{t("officer_assist.limited_title")}</p>
        <p>{retryAt ? t("officer_assist.limited_body", { time: hm(retryAt) }) : t("officer_assist.limited_later")}</p>
      </Notice>
    </div>
  );
}

function Composer({ assist }: { assist: OfficerAssist }) {
  const { t } = useI18n();
  const busy = assist.pending !== null;
  const send = () => assist.ask(assist.draft);
  return (
    <div className="shrink-0 border-t border-[oklch(var(--color-block))] p-3">
      <div className="flex items-end gap-2 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] px-2 py-1.5">
        <textarea
          ref={assist.inputRef}
          rows={2}
          value={assist.draft}
          disabled={busy}
          aria-label={t("officer_assist.placeholder")}
          placeholder={busy ? t("officer_assist.wait_lock") : t("officer_assist.placeholder")}
          onChange={(e) => assist.setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Not while an IME is composing: Enter there picks the characters (zh input).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="min-h-10 flex-1 resize-none bg-transparent text-sm text-[oklch(var(--color-ink))] outline-none placeholder:text-[oklch(var(--color-ink-subtle))]"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !assist.draft.trim()}
          aria-label={t("officer_assist.send")}
          className="flex h-7 w-7 shrink-0 items-center justify-center text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] disabled:text-[oklch(var(--color-disabled-ink))]"
        >
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
          </svg>
        </button>
      </div>
      <p className="mt-1.5 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
        {t("officer_assist.input_hint", { enter: "Enter", shift_enter: "Shift+Enter", esc: "Esc" })}
      </p>
    </div>
  );
}

function History({ assist }: { assist: OfficerAssist }) {
  const { t } = useI18n();
  const { when } = useClock();
  const pageTitle = usePageTitle();
  const [doomed, setDoomed] = useState<OfficerAssistConversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const { data, isError } = useQuery({ queryKey: assist.listKey, queryFn: officerAssistApi.conversations });

  const confirm = async () => {
    if (!doomed) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await assist.remove(doomed.id);
      setDoomed(null);
    } catch {
      setDeleteFailed(true);
      setDoomed(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className="border-b border-[oklch(var(--color-line))] px-4 py-2 text-xs text-[oklch(var(--color-ink-subtle))]">
        {t("officer_assist.retention")}
      </p>
      {deleteFailed ? (
        <div className="px-4 pt-3">
          <Notice tone="warn" role="alert">{t("officer_assist.delete_failed")}</Notice>
        </div>
      ) : null}
      {isError ? (
        <p role="alert" className="px-4 py-4 text-sm text-[oklch(var(--color-ink-muted))]">{t("officer_assist.history_failed")}</p>
      ) : data && data.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[oklch(var(--color-ink-muted))]">{t("officer_assist.history_empty")}</p>
      ) : (
        <ul>
          {(data ?? []).map((c) => (
            <li key={c.id} className="flex items-stretch border-b border-[oklch(var(--color-line))]">
              <button
                type="button"
                onClick={() => assist.openConversation(c)}
                className="min-w-0 flex-1 px-4 py-2 text-left hover:bg-[oklch(var(--color-surface-2))]"
              >
                <span className="flex items-baseline justify-between gap-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                  <span>{pageTitle(c.screen)}</span>
                  <span>{when(c.last_active_at)}</span>
                </span>
                <span title={c.first_question} className="mt-0.5 block truncate font-serif text-sm text-[oklch(var(--color-ink))]">
                  {c.first_question}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setDoomed(c)}
                aria-label={t("officer_assist.delete_label")}
                className="flex w-10 shrink-0 items-center justify-center text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-danger))]"
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.length > 0 ? (
        <p className="px-4 py-3 text-xs text-[oklch(var(--color-ink-subtle))]">{t("officer_assist.history_end")}</p>
      ) : null}
      <ConfirmDialog
        isOpen={doomed !== null}
        title={t("officer_assist.delete_title")}
        message={doomed ? t("officer_assist.delete_body", { page: pageTitle(doomed.screen) }) : ""}
        confirmText={t("officer_assist.delete_confirm")}
        onConfirm={confirm}
        onCancel={() => setDoomed(null)}
        confirmLoading={deleting}
      />
    </div>
  );
}
