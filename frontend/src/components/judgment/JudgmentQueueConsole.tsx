"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { EnumBadge } from "@/components/ui/data-grid";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { useJudgmentQueue, type VerdictCode } from "@soulledger/core/hooks/useJudgmentQueue";
import { Button } from "@/src/components/ui/Button";
import { usePermissions } from "@/src/hooks/usePermissions";
import { QUEUE_SHORTCUTS } from "@/src/lib/queueShortcuts";
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
 * The verdict is sent the moment it is given — no undo window (removed
 * 2026-09-25: 「落判即提交,不可撤回」, as on the desk).
 * The list at /judgment still exists and is still the right tool for "find a
 * particular judgment"; this is the tool for "work through the pending ones",
 * which is what the operator does all day.
 *
 * Keyboard map — the queue is keyboard-first, so this is the interface, not a
 * shortcut layer over it:
 *
 *   1 / 2 / 3 / 4   render PASSED / FAILED / PURGATORY / RETRY, send it, advance
 *   S               defer this case for the rest of this sitting
 *   W               toggle "also open an approval workflow"
 *   R               bring deferred cases back to the queue
 *   N               focus the notes field
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

export function JudgmentQueueConsole({ at }: { at?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const queue = useJudgmentQueue({ at });
  const [notes, setNotes] = useState("");
  const [createWorkflow, setCreateWorkflow] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

  const { cursor, progress, submitVerdict, defer, restoreDeferred } = queue;
  const judgment = cursor.judgment;

  // Notes belong to the case in front of the operator, never to the next one.
  //
  // AND SO DOES THE WORKFLOW CHECKBOX, which this effect used to leave alone.
  // The comment above stated the rule and the code applied it to one of the
  // two things the rule covers: `createWorkflow` was `useState(false)` at
  // mount and nothing ever put it back. So an operator who ticked W for one
  // soul then ruled on the next ten silently opened an approval workflow for
  // every one of them — `rule()` passes it straight through on every verdict.
  //
  // Deciding it is a per-sitting setting instead would be defensible, but
  // then it would have to say so on screen; a hidden sticky toggle that
  // creates a workflow per case is the one reading nobody chose.
  useEffect(() => {
    setNotes("");
    setCreateWorkflow(false);
  }, [judgment?.id]);

  const rule = useCallback(
    (verdict: VerdictCode) => {
      if (!judgment) return;
      void submitVerdict({ verdict, notes, createWorkflow });
    },
    [judgment, submitVerdict, notes, createWorkflow]
  );

  const leave = useCallback(() => {
    router.push("/judgment");
  }, [router]);

  // `judgment.execute`, and the backend says so out loud. `views.py:82` maps
  // `conclude → judgment.execute` while `next_pending → judgment.read`, with
  // the comment: "an operator who may look at the queue but not rule on it
  // still gets the screen, AND THE VERDICT BUTTON IS THEN THE THING THEY
  // CANNOT USE". The screen half was built; the button half was not.
  //
  // What that cost: a `judgment.read`-only operator got four live verdict
  // buttons, each of which produced a 403 rendered as the generic
  // `commit_error`. There was no "you may look but not rule" state anywhere.
  //
  // `RequirePermission` already does this shape on the detail page
  // (`app/judgment/[id]/page.tsx:494`), so this is that decision applied to
  // the console rather than a new one.
  const { hasPermission } = usePermissions();
  const canRule = hasPermission("judgment.execute");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // SOMEBODY ELSE ALREADY ANSWERED THIS KEY.
      //
      // This handler is on `window`, so it sees every keystroke in the app —
      // including ones an overlay above it has already handled. React
      // dispatches at the root container, so a handler that calls
      // `preventDefault()` without `stopPropagation()` still lets this one
      // run, and both do: `useDrawerA11y.ts:137-141` and
      // `useRovingPopupKeys.ts:56-59`.
      //
      // What that cost, concretely:
      //   - narrow viewport, the AppLayout mobile drawer open over the
      //     console: Escape closed the drawer AND ran `leave()`;
      //   - the keyboard map open (`?` / `h`): Escape left the queue instead
      //     of closing the map.
      //
      // `defaultPrevented` is the one question that answers all of them
      // without this handler having to know what else exists on the page.
      if (event.defaultPrevented) return;
      // AUTO-REPEAT IS NOT A SECOND DECISION. A held key fires `keydown` every
      // ~30ms after the initial delay, and every one of the shortcuts below is
      // a discrete command — there is no scroll or nudge here that repeating
      // would serve. `1` held down for half a second was a dozen calls to
      // `rule`, and `w` held down toggled the workflow checkbox to a value
      // nobody chose.
      //
      // `useJudgmentQueue.submitVerdict` also refuses a second verdict for a
      // case whose request is in flight, and that guard is the one that matters —
      // it covers a genuine double press and a double-click too, which look
      // identical from here. This line is the cheaper half: it stops the burst
      // at the source rather than filtering it downstream, and it is the only
      // one of the two that helps `w`, `s` and `?`.
      if (event.repeat) return;

      if (event.key === "Escape") {
        if (isTextEntry(event.target)) {
          (event.target as HTMLElement).blur();
          return;
        }
        // The keyboard map is the nearest thing to an overlay this console
        // owns, and it had no Escape of its own — so Escape over an open map
        // left the whole queue. Closing it is what Escape means when
        // something is open on top.
        if (showKeys) {
          event.preventDefault();
          setShowKeys(false);
          return;
        }
        event.preventDefault();
        leave();
        return;
      }
      if (isTextEntry(event.target)) return;

      // The four decision keys, the workflow toggle and the notes key all
      // feed a POST. Gated together: `w` on a checkbox that is not on screen
      // is nothing. `s` (defer) and `?` stay live — deferring is
      // session-local and writes nothing, and help is help.
      const verdict = canRule ? VERDICTS.find((v) => v.key === event.key) : undefined;
      if (verdict) {
        event.preventDefault();
        rule(verdict.code);
        return;
      }
      if (!canRule && ["w", "n"].includes(event.key.toLowerCase())) return;
      switch (event.key.toLowerCase()) {
        case "s":
          event.preventDefault();
          defer();
          break;
        case "w":
          event.preventDefault();
          setCreateWorkflow((prev) => !prev);
          break;
        case "r":
          event.preventDefault();
          restoreDeferred();
          break;
        case "n":
          // The notes textarea is the only text input on a keyboard-first
          // surface, and it had no key — the operator had to reach for the
          // mouse to add a note to a verdict they were about to file with a
          // single keystroke. `isTextEntry` above means `n` stops being a
          // shortcut the moment focus lands there, so typing "notes" works.
          event.preventDefault();
          document.getElementById("queue-notes")?.focus();
          break;
        case "?":
        case "h":
          // `h` as well as `?`. On most non-US layouts `?` needs Shift, so a
          // help key that is itself awkward to press is a help key nobody
          // finds. `h` is free here — no verdict claims it.
          event.preventDefault();
          setShowKeys((prev) => !prev);
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rule, defer, restoreDeferred, leave, canRule, showKeys]);

  // `progressText`, not `progressLabel`: "N of M" is a formatted count, not a
  // domain enum, and src/__tests__/domainDisplayContract.test.tsx reads any
  // `*Label` rendered in a JSX text position inside a declared string-context
  // file as an enum label owing a title={rawMember}. The name was the only
  // thing making it look like one.
  const progressText = useMemo(
    () =>
      t("judgment.queue.progress", {
        position: String(progress.position),
        total: String(progress.total),
      }),
    [t, progress.position, progress.total]
  );

  return (
    <div className="text-[oklch(var(--color-ink))]">
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[oklch(var(--color-hairline))]/50">
        <h1 className="text-md text-[oklch(var(--color-accent-ink))] flex-1">
          {t("judgment.queue.title")}
        </h1>
        <p
          className="text-xs font-mono tabular-nums text-[oklch(var(--color-ink-muted))]"
          aria-live="polite"
        >
          {progressText}
        </p>
        <button
          type="button"
          onClick={() => setShowKeys((prev) => !prev)}
          aria-expanded={showKeys}
          className="text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] underline"
        >
          {t("judgment.queue.keyboard_help")}
        </button>
        <button
          type="button"
          onClick={leave}
          className="text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
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
          aria-label={progressText}
          className="h-[3px] bg-[oklch(var(--color-surface-3))] overflow-hidden"
        >
          <div
            className="h-full bg-[oklch(var(--color-ink))] transition-[width]"
            style={{ width: `${Math.min(100, (progress.position / Math.max(progress.total, 1)) * 100)}%` }}
          />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[oklch(var(--color-ink-muted))]">
          <span>{t("judgment.queue.stat_decided", { n: String(progress.decided) })}</span>
          <span>{t("judgment.queue.stat_deferred", { n: String(progress.deferred) })}</span>
          <span>{t("judgment.queue.stat_remaining", { n: String(progress.remaining) })}</span>
          {progress.deferred > 0 && (
            <button
              type="button"
              onClick={restoreDeferred}
              className="text-[oklch(var(--color-accent-ink))] hover:underline"
            >
              {t("judgment.queue.restore_deferred")}
            </button>
          )}
        </div>

        {showKeys && <KeyboardMap />}

        {queue.isError ? (
          <ConsoleNotice
            title={t("judgment.queue.error_title")}
            body={t("judgment.queue.error_body")}
            action={
              <Button type="button" variant="primary" onClick={() => queue.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : queue.isLoading ? (
          <ConsoleNotice title={t("judgment.queue.loading")} body="" />
        ) : queue.isExhausted ? (
          <ConsoleNotice
            title={
              progress.deferred > 0
                ? t("judgment.queue.exhausted_with_deferred_title")
                : t("judgment.queue.exhausted_title")
            }
            body={t("judgment.queue.exhausted_body", { n: String(progress.decided) })}
            action={
              progress.deferred > 0 ? (
                <Button type="button" variant="primary" onClick={restoreDeferred}>
                  {t("judgment.queue.restore_deferred")}
                </Button>
              ) : (
                <Button type="button" variant="primary" onClick={leave}>
                  {t("judgment.queue.leave")}
                </Button>
              )
            }
          />
        ) : !judgment || !cursor.soul || !cursor.ledger ? (
          /* A card arrived with `judgment` set but a relation missing. NOT the
           * same fact as an empty queue, and it keeps its own notice rather
           * than borrowing the exhausted one — which is what it used to do,
           * telling the operator the sitting was over because one join came
           * back null. */
          <ConsoleNotice
            title={t("judgment.queue.incomplete_title")}
            body={t("judgment.queue.incomplete_body")}
            action={
              <Button type="button" variant="primary" onClick={() => queue.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : (
          <>
            {/* `min-w-0` on both columns: a flex/grid child defaults to
                `min-width: auto`, so one long unbroken value inside a panel
                widens its whole track rather than being contained. The
                evidence column already sets it (`JudgmentEvidenceColumn.tsx`
                :50,68) for exactly this; these two never did. */}
            {/* The handover: the just-ruled case stays rendered (placeholderData)
                until the next arrives, dimmed so it does not read as current.
                `isPlaceholderData`, not `isFetching` — see the hook. */}
            <div
              aria-busy={queue.isPlaceholderData || undefined}
              className={`grid gap-4 lg:grid-cols-2 transition-opacity duration-settle ${
                queue.isPlaceholderData ? "opacity-40 ease-exit" : "opacity-100 ease-enter"
              }`}
            >
              <div className="min-w-0 space-y-4">
                <SoulIdentityPanel soul={cursor.soul} />
                <CaseFactsPanel court={judgment.court} confession={judgment.confession} />
                <RealmOptionsPanel realms={cursor.realm_options} />
              </div>
              <div className="min-w-0 space-y-4">
                <LedgerPanel ledger={cursor.ledger} />
                <PriorCyclesPanel cycles={cursor.prior_cycles} />
              </div>
            </div>

            <section
              aria-labelledby="queue-verdict-heading"
              className="border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-1))] p-4"
            >
              <h2 id="queue-verdict-heading" className="text-2xs uppercase text-[oklch(var(--color-ink-muted))] mb-3">
                {t("judgment.queue.render_verdict")}
              </h2>
              <label htmlFor="queue-notes" className="block text-xs text-[oklch(var(--color-ink-muted))] mb-1">
                {t("judgment.queue.notes")}
              </label>
              <textarea
                id="queue-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder={t("judgment.queue.notes_placeholder")}
                className="w-full border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-2))] px-3 py-2 text-sm text-[oklch(var(--color-ink))] mb-3"
              />
              <label className="flex items-center gap-2 text-sm text-[oklch(var(--color-ink-muted))] mb-3">
                <input
                  type="checkbox"
                  checked={createWorkflow}
                  onChange={(event) => setCreateWorkflow(event.target.checked)}
                  className="accent-[oklch(var(--color-accent))]"
                />
                {t("judgment.queue.create_workflow")}
                <kbd className="font-mono text-xs px-1 bg-[oklch(var(--color-surface-3))]">W</kbd>
              </label>
            </section>
          </>
        )}
      </div>

      {/* The decision bar. Sticky, so the verdict controls stay on screen however
          long the confession or the ledger above them is. Notes and "create
          workflow" stay in the scroll: they are optional, and `N` reaches the
          notes field from anywhere. */}
      {judgment && cursor.soul && cursor.ledger && (
        <div className="sticky bottom-0 border-t border-[oklch(var(--color-hairline-strong))] bg-[oklch(var(--color-canvas))]">
          <div className="max-w-6xl mx-auto px-6 py-3">
            {/* The verdict row stays hand-rolled, deliberately, while the four
                plain buttons on this screen moved to `Button`. Each verdict
                carries its own status token as an inline `color` and an
                embedded `<kbd>` hint; expressing that through the variant
                system would mean either a variant per verdict or a pile of
                className overrides fighting it. A shared primitive is for the
                shapes that repeat — these do not. */}
            {!canRule && (
              /* Not a row of disabled buttons. A disabled control still says
                 "this is yours, just not now", and this is not a timing
                 problem — it is a standing fact about this operator. It also
                 gives assistive tech nothing to read, which is the same
                 complaint the repo has about disabled submit buttons
                 elsewhere. A sentence says the true thing instead. */
              <p role="note" className="text-sm text-[oklch(var(--color-ink-muted))] py-2">
                {t("judgment.queue.read_only")}
              </p>
            )}
            {canRule && (
            <div className="flex flex-wrap gap-2">
              {VERDICTS.map((verdict) => (
                <button
                  key={verdict.code}
                  type="button"
                  onClick={() => rule(verdict.code)}
                  /* `active:translate-y-px` and the motion tokens, matching
                     `Button`'s base — see its comment on the pressed nudge:
                     "shared by all four variants so 'pressed' is one gesture
                     in this UI rather than four". These four stayed
                     hand-rolled for a good reason (each carries its own status
                     token as an inline colour), and the cost of that was
                     shipping the most important buttons in the product with
                     no pressed state at all — the exact defect `Button`'s
                     header records as "0 of 190".

                     `transition-colors` on Tailwind's bare 150ms is also
                     replaced: `duration-state` is the token for a change in
                     place, and the transform needs to be in the property list
                     or the nudge is un-eased. NO overshoot, per globals.css —
                     a bounce on a verdict button would be the app being
                     pleased with itself while someone sentences a soul. */
                  className="flex items-center gap-2 px-4 py-2 border text-sm font-semibold transition-[color,background-color,border-color,transform] duration-state border-[oklch(var(--color-hairline-strong))] hover:bg-[oklch(var(--color-surface-2))] active:translate-y-px motion-reduce:active:translate-y-0"
                  style={{ color: `oklch(var(${verdict.token}))` }}
                >
                  <kbd className="font-mono text-xs px-1.5 bg-[oklch(var(--color-surface-3))] text-[oklch(var(--color-ink-muted))]">
                    {verdict.key}
                  </kbd>
                  {/* A JSX position, so the component rather than the string
                      helper: <DomainEnum> renders one span, carries the raw
                      member in `title` itself, and shows translated
                      "unrecognized" copy instead of a dotted key when a
                      verdict is missing from the bundle. */}
                  <DomainEnum namespace="judgment.verdicts" value={verdict.code} />
                </button>
              ))}
              <span aria-hidden="true" className="w-px self-stretch bg-[oklch(var(--color-hairline))]" />
              <button
                type="button"
                onClick={defer}
                className="flex items-center gap-2 px-4 py-2 border border-[oklch(var(--color-hairline-strong))] text-sm font-medium text-[oklch(var(--color-ink-muted))] transition-[color,background-color,border-color,transform] duration-state hover:bg-[oklch(var(--color-surface-2))] active:translate-y-px motion-reduce:active:translate-y-0"
              >
                <kbd className="font-mono text-xs px-1.5 bg-[oklch(var(--color-surface-3))]">S</kbd>
                {t("judgment.queue.defer")}
              </button>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CaseFactsPanel({ court, confession }: { court: string; confession: string }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="queue-case-heading" className="border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-1))] p-4">
      <h3 id="queue-case-heading" className="text-2xs uppercase text-[oklch(var(--color-ink-muted))] mb-3">
        {t("judgment.queue.case")}
      </h3>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("judgment.court")}</span>
        {court ? (
          <EnumBadge value={{ tone: "info", label: court }} />
        ) : (
          <span className="text-sm text-[oklch(var(--color-ink-tertiary))]">{t("judgment.queue.not_recorded")}</span>
        )}
      </div>
      {/* 忏悔在自己的框里滚,而不是把它下面的东西推走。
       *
       * `d53ede1` 用 `sticky bottom-0` 锚住了裁决按钮,那解决的是「按钮够不着」。
       * 它解决不了的是**按钮需要的上下文**够不着:`RealmOptionsPanel` —— 那块说
       * 每种裁决会把灵魂送去哪的面板,§4.2 列为必需的决策上下文 —— 就排在这段
       * 忏悔下面、同一左列里。而忏悔是调用方传进来的任意长文本,没有上限,
       * 所以一段长忏悔能把那块面板推到任意远。
       *
       * `max-h-64`(256px)= 十六行 `text-sm`,足够看清一段完整的陈述,而不足以
       * 把一整列吃掉。超出的部分在这个框里滚 —— 全文仍然在 DOM 里,读屏、复制、
       * 页内查找都够得着,和 `truncate` 是同一类保证。
       *
       * `overscroll-contain`:滚到底之后不把滚动传给整页。操作员正在读的是这
       * 一段,而这个控制台的下半部分是钉住的裁决条 —— 把页面顶走一下再弹回来,
       * 是在一个每一步都要精确的界面上制造一次意外移动。 */}
      <div className="min-w-0">
        <div className="text-xs text-[oklch(var(--color-ink-muted))] mb-1">{t("judgment.detail.confession")}</div>
        <p
          className={
            confession
              ? "text-sm text-[oklch(var(--color-ink))] whitespace-pre-line max-h-64 overflow-y-auto overscroll-contain"
              : "text-sm text-[oklch(var(--color-ink-tertiary))]"
          }
        >
          {confession || t("judgment.queue.no_confession")}
        </p>
      </div>
    </section>
  );
}

function ConsoleNotice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-1))] px-6 py-12 text-center">
      <p className="text-sm font-medium text-[oklch(var(--color-ink))]">{title}</p>
      {body && <p className="mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

function KeyboardMap() {
  const { t } = useI18n();
  // Design's six (`src/lib/queueShortcuts.ts`). `h` and Esc still work — see the keydown above.
  const rows = QUEUE_SHORTCUTS.map(({ key, label }) => [key, t(label)] as const);
  return (
    <div className="border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-2))] p-4">
      <h2 className="text-2xs uppercase text-[oklch(var(--color-ink-muted))] mb-2">
        {t("judgment.queue.keyboard_map")}
      </h2>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([keys, label]) => (
          <div key={keys} data-shortcut={keys} className="flex items-baseline gap-3 text-sm">
            <dt className="font-mono text-xs text-[oklch(var(--color-ink))] min-w-[7ch]">{keys}</dt>
            <dd className="text-[oklch(var(--color-ink-muted))]">{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
