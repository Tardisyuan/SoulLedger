"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { EnumBadge } from "@/components/ui/data-grid";
import { useJudgmentQueue, UNDO_WINDOW_MS, type VerdictCode } from "@/src/hooks/useJudgmentQueue";
import {
  LedgerPanel,
  PriorCyclesPanel,
  RealmOptionsPanel,
  SoulIdentityPanel,
} from "./JudgmentQueueContext";

/**
 * The judgment triage queue (BRIEF §4.2, the one item in the brief marked
 * "Decided": a queue, not multi-select).
 *
 * One case on screen at a time, the whole decision surface with it, a verdict
 * is one keystroke, and giving one advances to the next without a navigation.
 * The list at /judgment still exists and is still the right tool for "find a
 * particular judgment"; this is the tool for "work through the pending ones",
 * which is what the operator does all day.
 *
 * Keyboard map — the queue is keyboard-first, so this is the interface, not a
 * shortcut layer over it:
 *
 *   1 / 2 / 3 / 4   render PASSED / FAILED / PURGATORY / RETRY and advance
 *   S               defer this case for the rest of this sitting
 *   U               take back the verdict still inside its undo window
 *   W               toggle "also open an approval workflow"
 *   R               bring deferred cases back to the queue
 *   ?               show / hide this map
 *   Esc             leave the queue
 *
 * Keys are ignored while focus is in the notes field (and any other text
 * input), so typing "1" in a note never files a verdict. Esc still works
 * there, and blurs first.
 */

const VERDICTS: { code: VerdictCode; key: string; token: string }[] = [
  { code: "PASSED", key: "1", token: "--color-verdict-passed" },
  { code: "FAILED", key: "2", token: "--color-verdict-failed" },
  { code: "PURGATORY", key: "3", token: "--color-verdict-purgatory" },
  { code: "RETRY", key: "4", token: "--color-verdict-retry" },
];

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Live seconds left in the undo window, recomputed on a 1s tick. */
function useCountdown(dueAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (dueAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [dueAt]);
  if (dueAt === null) return 0;
  return Math.max(0, Math.ceil((dueAt - now) / 1000));
}

export function JudgmentQueueConsole({ at }: { at?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const queue = useJudgmentQueue({ at });
  const [notes, setNotes] = useState("");
  const [createWorkflow, setCreateWorkflow] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

  const { cursor, progress, pending, submitVerdict, undo, defer, restoreDeferred } = queue;
  const judgment = cursor.judgment;
  const secondsLeft = useCountdown(pending?.dueAt ?? null);

  // Notes belong to the case in front of the operator, never to the next one.
  useEffect(() => {
    setNotes("");
  }, [judgment?.id]);

  const rule = useCallback(
    (verdict: VerdictCode) => {
      if (!judgment) return;
      submitVerdict({ verdict, notes, createWorkflow });
    },
    [judgment, submitVerdict, notes, createWorkflow]
  );

  const leave = useCallback(() => {
    // Anything held is sent on the way out — see useJudgmentQueue's header.
    queue.flush();
    router.push("/judgment");
  }, [queue, router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        if (isTextEntry(event.target)) {
          (event.target as HTMLElement).blur();
          return;
        }
        event.preventDefault();
        leave();
        return;
      }
      if (isTextEntry(event.target)) return;

      const verdict = VERDICTS.find((v) => v.key === event.key);
      if (verdict) {
        event.preventDefault();
        rule(verdict.code);
        return;
      }
      switch (event.key.toLowerCase()) {
        case "s":
          event.preventDefault();
          defer();
          break;
        case "u":
          event.preventDefault();
          undo();
          break;
        case "w":
          event.preventDefault();
          setCreateWorkflow((prev) => !prev);
          break;
        case "r":
          event.preventDefault();
          restoreDeferred();
          break;
        case "?":
          event.preventDefault();
          setShowKeys((prev) => !prev);
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rule, defer, undo, restoreDeferred, leave]);

  const progressLabel = useMemo(
    () =>
      t("judgment.queue.progress", {
        position: String(progress.position),
        total: String(progress.total),
      }),
    [t, progress.position, progress.total]
  );

  return (
    <div className="text-[hsl(var(--color-ink))]">
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent-ink))] flex-1">
          {t("judgment.queue.title")}
        </h1>
        <p
          className="text-sm font-mono tabular-nums text-[hsl(var(--color-ink-muted))]"
          aria-live="polite"
        >
          {progressLabel}
        </p>
        <button
          type="button"
          onClick={() => setShowKeys((prev) => !prev)}
          aria-expanded={showKeys}
          className="text-sm text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] underline"
        >
          {t("judgment.queue.keyboard_help")}
        </button>
        <button
          type="button"
          onClick={leave}
          className="text-sm text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
        >
          {t("judgment.queue.leave")}
        </button>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {/* Progress bar. Denominator is latched at session start, so it does
            not slide out from under the operator as verdicts land. */}
        <div
          role="progressbar"
          aria-valuenow={progress.position}
          aria-valuemin={0}
          aria-valuemax={Math.max(progress.total, 1)}
          aria-label={progressLabel}
          className="h-1 rounded bg-[hsl(var(--color-surface-3))] overflow-hidden"
        >
          <div
            className="h-full bg-[hsl(var(--color-accent))] transition-all"
            style={{ width: `${Math.min(100, (progress.position / Math.max(progress.total, 1)) * 100)}%` }}
          />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--color-ink-muted))]">
          <span>{t("judgment.queue.stat_decided", { n: String(progress.decided) })}</span>
          <span>{t("judgment.queue.stat_deferred", { n: String(progress.deferred) })}</span>
          <span>{t("judgment.queue.stat_remaining", { n: String(progress.remaining) })}</span>
          {progress.deferred > 0 && (
            <button
              type="button"
              onClick={restoreDeferred}
              className="text-[hsl(var(--color-accent-ink))] hover:underline"
            >
              {t("judgment.queue.restore_deferred")}
            </button>
          )}
        </div>

        {showKeys && <KeyboardMap />}

        {pending && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[hsl(var(--color-accent)/0.3)] bg-[hsl(var(--color-accent)/0.1)] px-4 py-3"
          >
            <span className="text-sm text-[hsl(var(--color-ink))]">
              {t("judgment.queue.pending_verdict", {
                soul: pending.soulName,
                verdict: t(`judgment.verdicts.${pending.verdict.toLowerCase()}`),
              })}
            </span>
            <span className="font-mono tabular-nums text-sm text-[hsl(var(--color-ink-muted))]">
              {t("judgment.queue.undo_countdown", { seconds: String(secondsLeft) })}
            </span>
            <button
              type="button"
              onClick={undo}
              className="px-3 py-1 rounded-md border border-[hsl(var(--color-hairline-strong))] text-sm font-medium text-[hsl(var(--color-ink))] hover:bg-[hsl(var(--color-surface-2))]"
            >
              {t("judgment.queue.undo")}
            </button>
          </div>
        )}

        {queue.isError ? (
          <ConsoleNotice
            title={t("judgment.queue.error_title")}
            body={t("judgment.queue.error_body")}
            action={
              <button
                type="button"
                onClick={() => queue.refetch()}
                className="px-3 py-1.5 rounded-md bg-[hsl(var(--color-accent))] text-black text-sm font-medium"
              >
                {t("common.retry")}
              </button>
            }
          />
        ) : queue.isLoading ? (
          <ConsoleNotice title={t("judgment.queue.loading")} body="" />
        ) : !judgment || !cursor.soul || !cursor.ledger ? (
          <ConsoleNotice
            title={
              progress.deferred > 0
                ? t("judgment.queue.exhausted_with_deferred_title")
                : t("judgment.queue.exhausted_title")
            }
            body={t("judgment.queue.exhausted_body", { n: String(progress.decided) })}
            action={
              progress.deferred > 0 ? (
                <button
                  type="button"
                  onClick={restoreDeferred}
                  className="px-3 py-1.5 rounded-md bg-[hsl(var(--color-accent))] text-black text-sm font-medium"
                >
                  {t("judgment.queue.restore_deferred")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={leave}
                  className="px-3 py-1.5 rounded-md bg-[hsl(var(--color-accent))] text-black text-sm font-medium"
                >
                  {t("judgment.queue.leave")}
                </button>
              )
            }
          />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <SoulIdentityPanel soul={cursor.soul} />
                <CaseFactsPanel court={judgment.court} confession={judgment.confession} />
                <RealmOptionsPanel realms={cursor.realm_options} />
              </div>
              <div className="space-y-4">
                <LedgerPanel ledger={cursor.ledger} />
                <PriorCyclesPanel cycles={cursor.prior_cycles} />
              </div>
            </div>

            <section
              aria-labelledby="queue-verdict-heading"
              className="rounded-lg border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] p-4"
            >
              <h2 id="queue-verdict-heading" className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--color-ink-muted))] mb-3">
                {t("judgment.queue.render_verdict")}
              </h2>
              <label htmlFor="queue-notes" className="block text-xs text-[hsl(var(--color-ink-muted))] mb-1">
                {t("judgment.queue.notes")}
              </label>
              <textarea
                id="queue-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder={t("judgment.queue.notes_placeholder")}
                className="w-full rounded-md border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-2))] px-3 py-2 text-sm text-[hsl(var(--color-ink))] mb-3"
              />
              <label className="flex items-center gap-2 text-sm text-[hsl(var(--color-ink-muted))] mb-3">
                <input
                  type="checkbox"
                  checked={createWorkflow}
                  onChange={(event) => setCreateWorkflow(event.target.checked)}
                  className="accent-[hsl(var(--color-accent))]"
                />
                {t("judgment.queue.create_workflow")}
                <kbd className="font-mono text-xs px-1 rounded bg-[hsl(var(--color-surface-3))]">W</kbd>
              </label>
              <div className="flex flex-wrap gap-2">
                {VERDICTS.map((verdict) => (
                  <button
                    key={verdict.code}
                    type="button"
                    onClick={() => rule(verdict.code)}
                    className="flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-semibold transition-colors border-[hsl(var(--color-hairline-strong))] hover:bg-[hsl(var(--color-surface-2))]"
                    style={{ color: `hsl(var(${verdict.token}))` }}
                  >
                    <kbd className="font-mono text-xs px-1.5 rounded bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]">
                      {verdict.key}
                    </kbd>
                    {t(`judgment.verdicts.${verdict.code.toLowerCase()}`)}
                  </button>
                ))}
                <span aria-hidden="true" className="w-px self-stretch bg-[hsl(var(--color-hairline))]" />
                <button
                  type="button"
                  onClick={defer}
                  className="flex items-center gap-2 px-4 py-2 rounded-md border border-[hsl(var(--color-hairline-strong))] text-sm font-medium text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))]"
                >
                  <kbd className="font-mono text-xs px-1.5 rounded bg-[hsl(var(--color-surface-3))]">S</kbd>
                  {t("judgment.queue.defer")}
                </button>
              </div>
              {/* The one place the two correction paths are named side by
                  side, so an operator learns the rule at the moment it
                  applies rather than after they need it. */}
              <p className="mt-3 text-xs text-[hsl(var(--color-ink-subtle))]">
                {t("judgment.queue.undo_scope_note", { seconds: String(Math.round(UNDO_WINDOW_MS / 1000)) })}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function CaseFactsPanel({ court, confession }: { court: string; confession: string }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="queue-case-heading" className="rounded-lg border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] p-4">
      <h3 id="queue-case-heading" className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--color-ink-muted))] mb-3">
        {t("judgment.queue.case")}
      </h3>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-[hsl(var(--color-ink-muted))]">{t("judgment.court")}</span>
        {court ? (
          <EnumBadge value={{ tone: "info", label: court }} />
        ) : (
          <span className="text-sm text-[hsl(var(--color-ink-tertiary))]">{t("judgment.queue.not_recorded")}</span>
        )}
      </div>
      <div>
        <div className="text-xs text-[hsl(var(--color-ink-muted))] mb-1">{t("judgment.detail.confession")}</div>
        <p className={confession ? "text-sm text-[hsl(var(--color-ink))] whitespace-pre-line" : "text-sm text-[hsl(var(--color-ink-tertiary))]"}>
          {confession || t("judgment.queue.no_confession")}
        </p>
      </div>
    </section>
  );
}

function ConsoleNotice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] px-6 py-12 text-center">
      <p className="text-base font-medium text-[hsl(var(--color-ink))]">{title}</p>
      {body && <p className="mt-1 text-sm text-[hsl(var(--color-ink-muted))]">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

function KeyboardMap() {
  const { t } = useI18n();
  const rows: [string, string][] = [
    ["1 · 2 · 3 · 4", t("judgment.queue.key_verdicts")],
    ["S", t("judgment.queue.key_defer")],
    ["U", t("judgment.queue.key_undo")],
    ["W", t("judgment.queue.key_workflow")],
    ["R", t("judgment.queue.key_restore")],
    ["?", t("judgment.queue.key_help")],
    ["Esc", t("judgment.queue.key_leave")],
  ];
  return (
    <div className="rounded-lg border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-2))] p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--color-ink-muted))] mb-2">
        {t("judgment.queue.keyboard_map")}
      </h2>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([keys, label]) => (
          <div key={keys} className="flex items-baseline gap-3 text-sm">
            <dt className="font-mono text-xs text-[hsl(var(--color-ink))] min-w-[7ch]">{keys}</dt>
            <dd className="text-[hsl(var(--color-ink-muted))]">{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
