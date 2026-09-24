"use client";

import type { Disposition, Judgment, LedgerSummary, Reincarnation, Soul, SoulEvent, SoulRecordEntry } from "@soulledger/core/api";
import { Skeleton } from "@/components/ui/skeleton";
import { DateProblemsPanel } from "@/src/components/souls/DateProblemsPanel";
import { SoulLifecycleTimeline } from "@/src/components/souls/SoulLifecycleTimeline";
import { SoulLedgerSections } from "./SoulLedgerSections";

/**
 * Right column: date problems, 丙 审判 / 丁 处置 / 戊 轮回 / 己 事件日志, and
 * 庚 the lifecycle spine. The 功过台账 ledger book moved to the left column,
 * under 乙 · 功过, where its totals are (规范 v1 灵魂详情).
 */
export function SoulTimelineColumn({
  soul,
  loading,
  records,
  ledger,
  judgments,
  dispositions,
  reincarnations,
  events,
  onChanged,
  onOpenJudgmentQueue,
}: {
  soul: Soul | null;
  loading: boolean;
  records: SoulRecordEntry[];
  ledger: LedgerSummary | null;
  judgments: Judgment[];
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
  events: SoulEvent[];
  onChanged: () => void;
  onOpenJudgmentQueue: (judgmentId: string) => void;
}) {
  return (
    <div className="min-w-0">
      {/* Date Problems — renders nothing when there are none, see
          DateProblemsPanel. Placed first: a bad date undermines every
          reading and record below it, so it's the thing worth seeing
          before anything else on this soul. */}
      {!loading && soul && (
        <DateProblemsPanel
          soulId={soul.id}
          soulProblems={soul.date_problems}
          records={records}
          onChanged={onChanged}
        />
      )}

      {loading ? (
        <div className="space-y-3 pt-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        soul && (
          <>
            <SoulLedgerSections
              judgments={judgments}
              dispositions={dispositions}
              reincarnations={reincarnations}
              events={events}
            />
            {/* Soul lifecycle spine — the one reverse-chronological story
                across lives (docs/design-handoff/BRIEF.md §4.1): karma entries,
                transition markers, the raw event feed behind a toggle, and
                the open-in-queue action. The four flat tables above are the
                ledger's per-kind view; this stays because it is the only place
                that bands records by life and offers the queue entry. */}
            <SoulLifecycleTimeline
                soul={soul}
                judgments={judgments}
                dispositions={dispositions}
                reincarnations={reincarnations}
                events={events}
                ledgerRecords={ledger?.records ?? []}
                // The label says "open in the judgment queue", and until the
                // queue existed this went to the read-only detail page
                // instead. `?at=` enters the real queue on this case; the
                // backend falls through to the head of the queue if it has
                // since been concluded, so a stale link is never a dead end.
                onOpenJudgmentQueue={onOpenJudgmentQueue}
              />
          </>
        )
      )}
    </div>
  );
}
