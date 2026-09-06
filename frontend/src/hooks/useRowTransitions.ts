"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Which rows just arrived, which just changed, and which are on their way out.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 *
 * Eight WebSocket soul events (`STATE_CHANGED`, `JUDGMENT_CONCLUDED`,
 * `REINCARNATION_TRIGGERED`, and five more — `lib/events/event_registry.ts`)
 * reach this app as a bare `invalidateQueries`. No toast, no highlight,
 * nothing: another operator concludes a case and a row in your table changes
 * its badge and its karma figure, or — under a `state=ALIVE` filter —
 * disappears, taking every row below it up by one. The table redrew and said
 * nothing about what it had redrawn.
 *
 * That is worse here than the usual "a nice transition would be nice", because
 * the thing being silently replaced is a ledger a person is *reading*. The
 * failure is not that it looks abrupt; it is that the number you just read is
 * no longer the number on the screen and nothing told you.
 *
 * ── WHY NOT A TOAST ───────────────────────────────────────────────────────
 *
 * Because a toast cannot say *which row*. Eight event types across a busy
 * tenant would also stack into a column of notices that the operator learns to
 * dismiss without reading, which is a worse outcome than silence. The
 * information belongs where the change happened.
 *
 * ── THE BASELINE PROBLEM, which is the whole of the design ────────────────
 *
 * A naive "diff against the last render" marks every row as changed on the
 * first load, on every page turn, and on every filter change — three moments
 * when nothing has been changed by anyone and the operator caused the change
 * themselves. That is not a smaller version of the right answer, it is noise
 * that would train people to ignore the signal.
 *
 * So `resetKey` is required, not optional: it carries whatever identifies the
 * *question* the table is asking (page number, filters, sort). When it moves,
 * the next snapshot becomes a new baseline and nothing highlights. When it
 * holds still and the data moves underneath, that is somebody else's doing,
 * and that is exactly what this reports.
 *
 * ── HOW LONG ──────────────────────────────────────────────────────────────
 *
 * `HIGHLIGHT_MS` is 2000, an order of magnitude above the 240ms `settle` token
 * because this is not a transition, it is a *notice* — it has to survive the
 * operator's eye arriving after the change rather than before it. The fade
 * itself still runs on the token.
 *
 * Under `prefers-reduced-motion`, `app/globals.css` collapses the fade to 1ms
 * and the highlight simply appears and disappears. The state is still
 * conveyed; only the tween goes. That is the correct degradation — this is
 * information, not decoration, and it is not the kind of thing to withhold
 * from someone who asked for less motion.
 */
const HIGHLIGHT_MS = 2000;

/**
 * How long a departed row stays on screen before it is dropped.
 *
 * Matched to `--transition-duration-settle` (240ms). It has to be a number
 * here rather than a class because the row is removed by JavaScript, not by
 * CSS: the exit is a real unmount on a timer, and a timer that is shorter than
 * the fade cuts it off mid-way.
 *
 * NOTE FOR REDUCED MOTION: the CSS collapses to 1ms but this timer does not,
 * so a departed row lingers 240ms either way. That is deliberate and it is the
 * conservative choice — the alternative is reading the media query here and
 * having rows vanish instantly for some operators and not others, which makes
 * "did that row leave, or did I misread it" depend on a system setting.
 */
export const ROW_EXIT_MS = 240;

const EMPTY: ReadonlySet<string> = new Set();

export interface RowTransitions<T> {
  /** Keys that were not in the previous snapshot of the same `resetKey`. */
  entered: ReadonlySet<string>;
  /** Keys whose serialised contents differ from the previous snapshot. */
  changed: ReadonlySet<string>;
  /**
   * Rows that have left the data but are still being drawn while they fade.
   * They are rendered inert by the table — `aria-hidden`, no pointer events —
   * because a row that is on its way out must not be clickable: the record it
   * refers to is already gone, and the buttons in it would act on nothing.
   */
  leaving: readonly { key: string; item: T }[];
}

/**
 * @param data        The rows as the query currently has them.
 * @param keyExtractor Same function the table uses for React keys.
 * @param resetKey    Identifies the question being asked — page, filters,
 *                    sort. Change it and the next snapshot is a silent
 *                    baseline. Getting this wrong makes the feature lie, so it
 *                    has no default.
 */
export function useRowTransitions<T>(
  data: T[] | undefined,
  keyExtractor: (item: T, index: number) => string,
  resetKey: string
): RowTransitions<T> {
  const [entered, setEntered] = useState<ReadonlySet<string>>(EMPTY);
  const [changed, setChanged] = useState<ReadonlySet<string>>(EMPTY);
  const [leaving, setLeaving] = useState<readonly { key: string; item: T }[]>([]);

  // Held in a ref so the effect below does not depend on it. Callers write
  // `keyExtractor={(s) => s.id}` inline, so its identity changes every render;
  // in the dependency list it would re-run the effect on renders where no data
  // moved. Harmless in outcome (the diff would be empty) but it would rewrite
  // the snapshot on every render, and a snapshot rewritten between a change
  // and the effect that reads it is a dropped notice.
  const keyRef = useRef(keyExtractor);
  keyRef.current = keyExtractor;

  const snapshotRef = useRef<Map<string, string> | null>(null);
  const itemsRef = useRef<Map<string, T>>(new Map());
  const resetRef = useRef<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!data) return;

    const next = new Map<string, string>();
    const nextItems = new Map<string, T>();
    data.forEach((item, index) => {
      const key = keyRef.current(item, index);
      next.set(key, JSON.stringify(item));
      nextItems.set(key, item);
    });

    const previous = snapshotRef.current;
    const previousItems = itemsRef.current;
    const isNewBaseline = previous === null || resetRef.current !== resetKey;

    resetRef.current = resetKey;
    snapshotRef.current = next;
    itemsRef.current = nextItems;

    if (isNewBaseline) {
      // A first load, a page turn or a filter change. Nothing here happened to
      // the operator; it happened because of them.
      setEntered(EMPTY);
      setChanged(EMPTY);
      setLeaving([]);
      return;
    }

    const arrived = new Set<string>();
    const edited = new Set<string>();
    next.forEach((serialised, key) => {
      if (!previous.has(key)) arrived.add(key);
      else if (previous.get(key) !== serialised) edited.add(key);
    });

    const departed: { key: string; item: T }[] = [];
    previous.forEach((_serialised, key) => {
      if (next.has(key)) return;
      const item = previousItems.get(key);
      if (item !== undefined) departed.push({ key, item });
    });

    if (arrived.size === 0 && edited.size === 0 && departed.length === 0) return;

    if (arrived.size > 0 || edited.size > 0) {
      setEntered(arrived);
      setChanged(edited);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => {
        setEntered(EMPTY);
        setChanged(EMPTY);
      }, HIGHLIGHT_MS);
    }

    if (departed.length > 0) {
      setLeaving((current) => [...current, ...departed]);
      for (const gone of departed) {
        const existing = exitTimers.current.get(gone.key);
        if (existing) clearTimeout(existing);
        exitTimers.current.set(
          gone.key,
          setTimeout(() => {
            exitTimers.current.delete(gone.key);
            setLeaving((current) => current.filter((row) => row.key !== gone.key));
          }, ROW_EXIT_MS)
        );
      }
    }
  }, [data, resetKey]);

  // Every timer here outlives a fast unmount otherwise — navigating away
  // mid-highlight would call `setEntered` on a gone component.
  useEffect(() => {
    const timers = exitTimers.current;
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { entered, changed, leaving };
}
