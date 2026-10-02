"use client";

import Link from "next/link";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useI18n } from "@/src/contexts/I18nContext";
import { deathSyncApi, dispatchApi, judgmentApi } from "@soulledger/core/api";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/src/components/ui/Button";
import { RowMark } from "@/src/components/judgment/RowMark";
import { groupDigits } from "@/src/components/dashboard/numberFormat";
import { MissingValue } from "@/src/components/ui/DomainValue";

/**
 * 待办条 TodoStrip(Design A4):三格 —— 调派待批 / 审判队列 / 死亡同步异常。
 *
 * - 有数据:数字 + 去处;数字大于 0 的格子是「待我处理」,左边 3px 匾色竖条(`RowMark`,
 *   与审判队列同一个记号)。死亡同步那格的数字后再跟一句 danger「! 未入簿」。
 * - 没有数据:照常写 0,格子不隐藏,右侧换成「✓ 已清空」(同步那格「✓ 同步正常」),没有竖条。
 * - 单格加载失败:数字位「—」+「! 加载失败」,右侧「重试」只重取这一格;其他格照常。
 *
 * 每格的数取自它链接过去那一页自己读的接口,两边不会对不上:
 * `/dispatch/records/proposed/` 是审批收件箱(`target_tenant=<caller>`),`/judgment/next/`
 * 的 `total` 是队列自己的计数,`/death-sync/registrations/summary/` 还说出它数的是哪个状态,
 * 链接就落在那些行上。格子只给有权打开那一页的人:死亡同步的接口是 ADMIN-only
 * (`IsAdminPermission`,没有 codename),所以按角色而不是按权限判断。
 */
function TodoCell({
  label,
  query,
  href,
  linkText,
  clearText,
  alarm,
}: {
  label: string;
  query: UseQueryResult<number>;
  href: string;
  linkText: string;
  clearText: string;
  /** Words after a non-zero number (死亡同步:「! 未入簿」). */
  alarm?: string;
}) {
  const { t } = useI18n();
  const count = query.data;
  const failed = query.isError || (!query.isLoading && count === undefined);
  const mine = !failed && count !== undefined && count > 0;
  return (
    <div
      data-todo=""
      data-todo-mine={mine ? "" : undefined}
      className="relative flex min-h-20 items-center justify-between gap-4 bg-[oklch(var(--color-surface-1))] px-4 py-3"
    >
      {mine && <RowMark />}
      <div className="min-w-0">
        <div className="text-2xs text-[oklch(var(--color-ink-subtle))]">{label}</div>
        {query.isLoading ? (
          <Skeleton className="h-9 w-12" />
        ) : failed ? (
          <div className="flex h-9 items-baseline gap-2">
            <MissingValue kind="unrecorded" className="font-title text-xl text-[oklch(var(--color-ink-subtle))]" />
            <span role="alert" className="text-sm text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("dashboard.todo.load_error")}
            </span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span data-todo-count="" className="font-title text-xl text-[oklch(var(--color-ink))]">
              {groupDigits(count as number)}
            </span>
            {mine && alarm && (
              <span className="text-sm text-[oklch(var(--color-danger))]">
                <span aria-hidden="true">! </span>
                {alarm}
              </span>
            )}
          </div>
        )}
      </div>
      {query.isLoading ? null : failed ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      ) : mine ? (
        <Link href={href} className="shrink-0 text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] hover:underline">
          {linkText}
        </Link>
      ) : (
        <span className="shrink-0 text-sm text-[oklch(var(--color-ink-subtle))]">
          <span aria-hidden="true">✓ </span>
          {clearText}
        </span>
      )}
    </div>
  );
}

export function TodoStrip() {
  const { t } = useI18n();
  const { hasPermission, isAdmin } = usePermissions();
  const canDispatch = hasPermission("dispatch.read");
  const canJudge = hasPermission("judgment.read");
  const canDeathSync = isAdmin;
  const dispatchQ = useQuery({
    queryKey: ["dashboard", "todo", "dispatch-proposed"],
    queryFn: async () => (await dispatchApi.proposed({ page: "1" })).data.count,
    enabled: canDispatch,
    staleTime: 60_000,
  });
  const queueQ = useQuery({
    queryKey: ["dashboard", "todo", "judgment-queue"],
    queryFn: async () => (await judgmentApi.next()).data.total,
    enabled: canJudge,
    staleTime: 60_000,
  });
  const deathSyncQ = useQuery({
    queryKey: ["dashboard", "todo", "death-sync"],
    queryFn: async () => (await deathSyncApi.summary()).data,
    enabled: canDeathSync,
    staleTime: 60_000,
  });
  // The cell reads a number; the link also needs the status the server counted.
  const deathCountQ = { ...deathSyncQ, data: deathSyncQ.data?.anomaly_count } as UseQueryResult<number>;
  if (!canDispatch && !canJudge && !canDeathSync) return null;
  return (
    <div
      data-todo-strip=""
      className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-px border border-[oklch(var(--color-line))] bg-[oklch(var(--color-line))]"
    >
      {canDispatch && (
        <TodoCell
          label={t("dashboard.todo.approve_dispatch")}
          query={dispatchQ}
          href="/dispatch"
          linkText={t("dashboard.todo.go_approve")}
          clearText={t("dashboard.todo.none")}
        />
      )}
      {canJudge && (
        <TodoCell
          label={t("dashboard.todo.judgment_queue")}
          query={queueQ}
          href="/judgment/queue"
          linkText={t("dashboard.todo.enter")}
          clearText={t("dashboard.todo.none")}
        />
      )}
      {canDeathSync && (
        <TodoCell
          label={t("dashboard.todo.death_sync_anomaly")}
          query={deathCountQ}
          href={`/death-sync?status=${encodeURIComponent(deathSyncQ.data?.anomaly_status ?? "")}`}
          linkText={t("dashboard.todo.go_view")}
          clearText={t("dashboard.todo.sync_ok")}
          alarm={t("dashboard.todo.unbooked")}
        />
      )}
    </div>
  );
}
