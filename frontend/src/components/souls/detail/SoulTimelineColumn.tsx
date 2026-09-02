"use client";

import type { Disposition, Judgment, LedgerSummary, Reincarnation, Soul, SoulEvent, SoulRecordEntry } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { DateProblemsPanel } from "@/src/components/souls/DateProblemsPanel";
import { SoulLedgerBook } from "@/src/components/souls/SoulLedgerBook";
import { SoulLifecycleTimeline } from "@/src/components/souls/SoulLifecycleTimeline";

/** Right column: date problems, the 功过台账 ledger book, and the lifecycle spine. */
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
    <div className="lg:col-span-2 space-y-6">
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

      {/* 功过台账 —— 逐条账页。这一页原本有功过格的每一个部分,唯独没有
          「条」:左栏那张卡片收下 `records` 之后画的是五个合计数和一张图,
          于是一个逐条销算的账簿制度在整个产品里没有一处显示过它的条目。
          放在宽栏而不是左栏,因为六列定宽账页在 1/3 栏里会永远横向滚动;
          放在日期问题之下、生平脊线之上,因为一个坏日期会动摇它下面每一
          条账的日与序,而生平脊线讲的是比账簿更大的故事。 */}
      {!loading && ledger && (
        <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
          <SoulLedgerBook records={ledger.records} />
        </div>
      )}

      {/* Soul lifecycle spine — replaces the four judgment/disposition/
          reincarnation/event-log boxes that used to stack here, each with
          its own "暂无记录" empty state (docs/design-handoff/BRIEF.md
          §4.1, "clearest layout defect" per the Stage 3 design doc). One
          reverse-chronological timeline instead: karma entries, judgment/
          disposition/reincarnation transition markers, and (behind an
          opt-in toggle) the raw system event feed, plus dashed
          placeholder rows for stages the soul hasn't reached yet. */}
      {loading ? (
        <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))] space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        soul && (
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
        )
      )}
    </div>
  );
}
