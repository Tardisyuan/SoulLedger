"use client";

import { useEffect } from "react";
import type { Disposition, Judgment, LedgerSummary, Reincarnation, Soul, SoulEvent } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { Skeleton } from "@/components/ui/skeleton";
import { SoulLifecycleTimeline } from "@/src/components/souls/SoulLifecycleTimeline";
import { SoulLedgerSections } from "./SoulLedgerSections";
import { SoulLedgerProgress } from "./SoulLedgerProgress";

/**
 * 生命周期时间线的锚点。「灵魂事件」页(/events)的灵魂链接带 `#lifecycle`。
 * 页面是取数后才渲染时间线的,浏览器自己的锚点滚动那一刻元素还不在,所以载入完成后补滚一次。
 */
export const LIFECYCLE_ANCHOR = "lifecycle";

/** 中栏卷宗面板:v3 的 surface 面,上沿留给 `LedgerHeading` 自己的 pt-6。 */
const PANEL = "min-w-0 bg-[oklch(var(--color-surface-1))] px-6 pb-6";

/**
 * 中栏账页标签之下的卷宗:户头进度 + 行程、处置 / 轮回 / 事件日志、灵魂账页。
 *
 * v3 原型的中栏只有两个标签;这几块是这一页原有的数据(规范:不丢功能),排在标签之下,
 * 首屏仍是身份与功过(原型注 01)。日期问题在页面顶上,不在这里 —— 坏日期影响下面每一条。
 */
export function SoulTimelineColumn({
  soul,
  loading,
  ledger,
  judgments,
  dispositions,
  reincarnations,
  events,
  hasMore = false,
  loadingMore = false,
  loadMoreFailed = false,
  onLoadMore,
  birthDisplay,
  deathDisplay,
  onOpenJudgmentQueue,
}: {
  soul: Soul | null;
  loading: boolean;
  ledger: LedgerSummary | null;
  judgments: Judgment[];
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
  events: SoulEvent[];
  /** 还有没取到的更早记录(任一种):显示「加载更多」。 */
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreFailed?: boolean;
  onLoadMore?: () => void;
  birthDisplay: string | null;
  deathDisplay: string | null;
  onOpenJudgmentQueue: (judgmentId: string) => void;
}) {
  const { t } = useI18n();
  const ready = !loading && soul !== null;
  useEffect(() => {
    if (ready && window.location.hash === `#${LIFECYCLE_ANCHOR}`) {
      document.getElementById(LIFECYCLE_ANCHOR)?.scrollIntoView();
    }
    // 转生登记簿带来的 `#reincarnation-<id>`:同一个理由,那一行也是载入后才在。
    if (ready && window.location.hash.startsWith("#reincarnation-")) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
    }
  }, [ready]);
  if (loading) {
    return (
      <div className={`${PANEL} space-y-3 pt-6`}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (!soul) return null;
  return (
    <>
      <div className={`${PANEL} pt-6`}>
        <SoulLedgerProgress
          soul={soul}
          judgments={judgments}
          dispositions={dispositions}
          reincarnations={reincarnations}
          birthDisplay={birthDisplay}
          deathDisplay={deathDisplay}
        />
      </div>
      <div className={PANEL}>
        <SoulLedgerSections dispositions={dispositions} reincarnations={reincarnations} events={events} />
      </div>
      {/* Soul lifecycle spine — the one reverse-chronological story
          across lives (docs/design-handoff/BRIEF.md §4.1): karma entries,
          transition markers, the raw event feed behind a toggle, and
          the open-in-queue action. The flat tables above are the
          ledger's per-kind view; this stays because it is the only place
          that bands records by life and offers the queue entry. */}
      <div id={LIFECYCLE_ANCHOR} className={`${PANEL} pt-1 scroll-mt-4`}>
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
        {hasMore && onLoadMore ? (
          <div className="mt-4 flex items-center gap-3">
            <Button type="button" variant="secondary" size="sm" data-testid="timeline-load-more" loading={loadingMore} onClick={onLoadMore}>
              {t("souls.detail.load_more")}
            </Button>
            {loadMoreFailed ? (
              <span role="alert" className="text-sm text-[oklch(var(--color-status-warning))]">{t("souls.detail.load_more_failed")}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
