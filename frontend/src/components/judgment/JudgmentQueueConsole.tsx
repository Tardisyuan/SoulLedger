"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { EnumBadge } from "@/components/ui/data-grid";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { useJudgmentQueue, UNDO_WINDOW_MS, type VerdictCode } from "@soulledger/core/hooks/useJudgmentQueue";
import { Button } from "@/src/components/ui/Button";
import { usePermissions } from "@/src/hooks/usePermissions";
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

  // `judgment.execute`, and the backend says so out loud. `views.py:82` maps
  // `conclude → judgment.execute` while `next_pending → judgment.read`, with
  // the comment: "an operator who may look at the queue but not rule on it
  // still gets the screen, AND THE VERDICT BUTTON IS THEN THE THING THEY
  // CANNOT USE". The screen half was built; the button half was not.
  //
  // What that cost: a `judgment.read`-only operator got four live verdict
  // buttons. Pressing one advanced the card, started the countdown, and eight
  // seconds later produced a 403 rendered as the generic `commit_error` —
  // "the verdict did not land; the case is back in the queue" — about a case
  // that had left the screen eight seconds earlier. There was no "you may
  // look but not rule" state anywhere.
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
      //     console: Escape closed the drawer AND ran `leave()` — flush the
      //     held verdict, navigate away;
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
      // `useJudgmentQueue.submitVerdict` also refuses a second verdict for the
      // case it is already holding, and that guard is the one that matters —
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

      // The four decision keys, undo, and the workflow toggle all end in a
      // POST. Gated together rather than one at a time: `u` with no verdict to
      // take back and `w` on a checkbox that is not on screen are the same
      // kind of nothing. `s` (defer) and `?` stay live — deferring is
      // session-local and writes nothing, and help is help.
      const verdict = canRule ? VERDICTS.find((v) => v.key === event.key) : undefined;
      if (verdict) {
        event.preventDefault();
        rule(verdict.code);
        return;
      }
      if (!canRule && ["u", "w", "n"].includes(event.key.toLowerCase())) return;
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
  }, [rule, defer, undo, restoreDeferred, leave, canRule, showKeys]);

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
    <div className="text-[hsl(var(--color-ink))]">
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-06 text-[hsl(var(--color-accent-ink))] flex-1">
          {t("judgment.queue.title")}
        </h1>
        <p
          className="text-02 font-mono tabular-nums text-[hsl(var(--color-ink-muted))]"
          aria-live="polite"
        >
          {progressText}
        </p>
        <button
          type="button"
          onClick={() => setShowKeys((prev) => !prev)}
          aria-expanded={showKeys}
          className="text-03 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] underline"
        >
          {t("judgment.queue.keyboard_help")}
        </button>
        <button
          type="button"
          onClick={leave}
          className="text-03 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
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
          className="h-1 bg-[hsl(var(--color-surface-3))] overflow-hidden"
        >
          <div
            className="h-full bg-[hsl(var(--color-accent))] transition-[width]"
            style={{ width: `${Math.min(100, (progress.position / Math.max(progress.total, 1)) * 100)}%` }}
          />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-02 text-[hsl(var(--color-ink-muted))]">
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
          /* `queue.isExhausted`, not `!judgment || !soul || !ledger`.
           *
           * The hook has exported this since it was written —
           * `query.isSuccess && cursor.judgment === null && pending === null` —
           * and had ZERO consumers: the `pending === null` clause is exactly
           * the guard this branch was missing, and it was sitting unused while
           * the console re-derived a worse version of it two lines from here.
           *
           * The difference is the last case of a sitting: with a verdict still
           * held, the queue is not clear, it is one undo away from not being
           * clear. Saying "queue is clear" there — and, with the old
           * expression, hiding the undo bar to say it — is a false statement
           * made at the only moment the operator can still act on it. */
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
              className="border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] p-4"
            >
              <h2 id="queue-verdict-heading" className="text-01 uppercase text-[hsl(var(--color-ink-muted))] mb-3">
                {t("judgment.queue.render_verdict")}
              </h2>
              <label htmlFor="queue-notes" className="block text-02 text-[hsl(var(--color-ink-muted))] mb-1">
                {t("judgment.queue.notes")}
              </label>
              <textarea
                id="queue-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder={t("judgment.queue.notes_placeholder")}
                className="w-full border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-2))] px-3 py-2 text-03 text-[hsl(var(--color-ink))] mb-3"
              />
              <label className="flex items-center gap-2 text-03 text-[hsl(var(--color-ink-muted))] mb-3">
                <input
                  type="checkbox"
                  checked={createWorkflow}
                  onChange={(event) => setCreateWorkflow(event.target.checked)}
                  className="accent-[hsl(var(--color-accent))]"
                />
                {t("judgment.queue.create_workflow")}
                <kbd className="font-mono text-02 px-1 bg-[hsl(var(--color-surface-3))]">W</kbd>
              </label>
              {/* The one place the two correction paths are named side by
                  side, so an operator learns the rule at the moment it
                  applies rather than after they need it. */}
              <p className="text-02 text-[hsl(var(--color-ink-subtle))]">
                {t("judgment.queue.undo_scope_note", { seconds: String(Math.round(UNDO_WINDOW_MS / 1000)) })}
              </p>
            </section>
          </>
        )}
      </div>

      {/**
       * The decision bar. Sticky, and it holds the undo strip.
       *
       * TWO PROBLEMS, ONE MECHANISM. The verdict controls used to be the last
       * block under a two-column grid of panels, so a long confession or a
       * long ledger pushed them below the fold — on the screen whose entire
       * job is deciding. And the pending-undo strip rendered ABOVE those
       * panels, so **every verdict shifted the whole case down**: the operator
       * reading the next case could not see the undo countdown for the
       * previous one, which is the only moment that countdown exists for.
       *
       * The slot is rendered whether or not a verdict is pending, at a fixed
       * height, so landing one does not move anything. Empty, it draws
       * nothing.
       *
       * WHAT STAYED IN THE SCROLL. Notes and "create workflow" are optional
       * per verdict and `N` reaches the notes field from anywhere, so keeping
       * them here would have doubled the bar's height for something the
       * operator asks for rather than always needs. The bar carries only what
       * is irreversible.
       */}
      {/* THE BAR IS GATED ON `pending` TOO, AND THAT `||` IS THE WHOLE FIX.
       *
       * It used to be `judgment && soul && ledger` alone — i.e. the undo
       * affordance was structurally coupled to there being a NEXT card. So on
       * the last case of every sitting the operator ruled, `holding` grew, the
       * refetch came back with `judgment: null`, and the console flipped to
       * "queue is clear" — taking the countdown, the Undo button and the
       * "PASSED recorded for 王氏" line with it, at the exact moment they meant
       * something. Same on any fetch error inside the window. `U` still
       * worked, because the key listener is unconditional, but nothing on
       * screen said so.
       *
       * The verdict row below keeps the old condition: with no card there is
       * nothing to rule on. Only the undo strip survives the card. */}
      {(pending || (judgment && cursor.soul && cursor.ledger)) && (
        <div className="sticky bottom-0 border-t border-[hsl(var(--color-hairline-strong))] bg-[hsl(var(--color-canvas))]">
          <div className="max-w-6xl mx-auto px-6 py-3">
            {/* No `aria-live` here. The strip inside already carries
                `role="status"`, which IS a live region — nesting a second one
                around it meant two regions announcing the same node. */}
            <div className="h-10 flex items-center">
              {pending ? (
                <div role="status" className="flex flex-wrap items-center gap-3 animate-undo-strip">
                  <span className="text-03 text-[hsl(var(--color-ink))]">
                    {/* The verdict name is interpolated INTO another
                        translation, so it has to be a string and cannot be
                        <DomainEnum>. It still must not be a bare `t()`
                        template: t() echoes its key back on a miss, so a
                        verdict the bundle does not cover would read
                        "judgment.verdicts.appealed recorded for 王氏". */}
                    {t("judgment.queue.pending_verdict", {
                      soul: pending.soulName,
                      verdict: resolveEnumDisplay(t, "judgment.verdicts", pending.verdict).label ?? "",
                    })}
                  </span>
                  {/* `aria-hidden`, and it is the whole of this fix.
                      The seconds tick every 250ms INSIDE a `role="status"`,
                      so the live region re-fired several times a second —
                      "sends in 7s / 6s / 5s…" talking over whatever else was
                      being read, including the verdict announcement two lines
                      up that the operator actually needs. The number stays on
                      screen; it is the re-announcement that was noise. */}
                  <span
                    aria-hidden="true"
                    className="font-mono tabular-nums text-02 text-[hsl(var(--color-ink-muted))]"
                  >
                    {t("judgment.queue.undo_countdown", { seconds: String(secondsLeft) })}
                  </span>
                  <Button type="button" variant="secondary" onClick={undo}>
                    {t("judgment.queue.undo")}
                  </Button>
                </div>
              ) : null}
            </div>

            {/* The verdict row stays hand-rolled, deliberately, while the four
                plain buttons on this screen moved to `Button`. Each verdict
                carries its own status token as an inline `color` and an
                embedded `<kbd>` hint; expressing that through the variant
                system would mean either a variant per verdict or a pile of
                className overrides fighting it. A shared primitive is for the
                shapes that repeat — these do not. */}
            {judgment && cursor.soul && cursor.ledger && !canRule && (
              /* Not a row of disabled buttons. A disabled control still says
                 "this is yours, just not now", and this is not a timing
                 problem — it is a standing fact about this operator. It also
                 gives assistive tech nothing to read, which is the same
                 complaint the repo has about disabled submit buttons
                 elsewhere. A sentence says the true thing instead. */
              <p role="note" className="text-03 text-[hsl(var(--color-ink-muted))] py-2">
                {t("judgment.queue.read_only")}
              </p>
            )}
            {judgment && cursor.soul && cursor.ledger && canRule && (
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
                  className="flex items-center gap-2 px-4 py-2 border text-03 font-semibold transition-[color,background-color,border-color,transform] duration-state border-[hsl(var(--color-hairline-strong))] hover:bg-[hsl(var(--color-surface-2))] active:translate-y-px motion-reduce:active:translate-y-0"
                  style={{ color: `hsl(var(${verdict.token}))` }}
                >
                  <kbd className="font-mono text-02 px-1.5 bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]">
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
              <span aria-hidden="true" className="w-px self-stretch bg-[hsl(var(--color-hairline))]" />
              <button
                type="button"
                onClick={defer}
                className="flex items-center gap-2 px-4 py-2 border border-[hsl(var(--color-hairline-strong))] text-03 font-medium text-[hsl(var(--color-ink-muted))] transition-[color,background-color,border-color,transform] duration-state hover:bg-[hsl(var(--color-surface-2))] active:translate-y-px motion-reduce:active:translate-y-0"
              >
                <kbd className="font-mono text-02 px-1.5 bg-[hsl(var(--color-surface-3))]">S</kbd>
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
    <section aria-labelledby="queue-case-heading" className="border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] p-4">
      <h3 id="queue-case-heading" className="text-01 uppercase text-[hsl(var(--color-ink-muted))] mb-3">
        {t("judgment.queue.case")}
      </h3>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-02 text-[hsl(var(--color-ink-muted))]">{t("judgment.court")}</span>
        {court ? (
          <EnumBadge value={{ tone: "info", label: court }} />
        ) : (
          <span className="text-03 text-[hsl(var(--color-ink-tertiary))]">{t("judgment.queue.not_recorded")}</span>
        )}
      </div>
      <div>
        <div className="text-02 text-[hsl(var(--color-ink-muted))] mb-1">{t("judgment.detail.confession")}</div>
        <p className={confession ? "text-03 text-[hsl(var(--color-ink))] whitespace-pre-line" : "text-03 text-[hsl(var(--color-ink-tertiary))]"}>
          {confession || t("judgment.queue.no_confession")}
        </p>
      </div>
    </section>
  );
}

function ConsoleNotice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] px-6 py-12 text-center">
      <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{title}</p>
      {body && <p className="mt-1 text-03 text-[hsl(var(--color-ink-muted))]">{body}</p>}
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
    ["N", t("judgment.queue.key_notes")],
    // Both spellings listed, because a help key nobody can find is not help:
    // `?` needs Shift on most non-US layouts.
    ["? · H", t("judgment.queue.key_help")],
    ["Esc", t("judgment.queue.key_leave")],
  ];
  return (
    <div className="border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-2))] p-4">
      <h2 className="text-01 uppercase text-[hsl(var(--color-ink-muted))] mb-2">
        {t("judgment.queue.keyboard_map")}
      </h2>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([keys, label]) => (
          <div key={keys} className="flex items-baseline gap-3 text-03">
            <dt className="font-mono text-02 text-[hsl(var(--color-ink))] min-w-[7ch]">{keys}</dt>
            <dd className="text-[hsl(var(--color-ink-muted))]">{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
