"use client";

import Link from "next/link";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useI18n } from "@/src/contexts/I18nContext";
import { deathSyncApi, dispatchApi, judgmentApi, officerAppApi } from "@soulledger/core/api";
import { sentencePlansApi } from "@soulledger/core/api/sentence-plans";
import { socialModerationApi } from "@soulledger/core/api/social-moderation";
import { useImpersonation } from "@/src/components/impersonation/useImpersonation";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/src/components/ui/Button";
import { RowMark } from "@/src/components/judgment/RowMark";
import { groupDigits } from "@/src/components/dashboard/numberFormat";
import { MissingValue } from "@/src/components/ui/DomainValue";

/**
 * 待办条 TodoStrip(Design A4):三格 —— 调派待批 / 审判队列 / 死亡同步异常;
 * 第四格「待重发的调拨」(2026-10-11 用户加,Design 未画 —— 待确认版式),只给持有 `judgment.execute` 的人。
 *
 * - 有数据:数字 + 去处;数字大于 0 的格子是「待我处理」,左边 3px 匾色竖条(`RowMark`,
 *   与审判队列同一个记号)。死亡同步那格的数字后再跟一句 danger「! 未入簿」。
 * - 没有数据:照常写 0,格子不隐藏,右侧换成「✓ 已清空」(同步那格「✓ 同步正常」),没有竖条。
 * - 单格加载失败:数字位「—」+「! 加载失败」,右侧「重试」只重取这一格;其他格照常。
 *
 * 其后七格(2026-10-17 用户加,Design 未画,沿用同一格式):审批待我处理 / 转生申请 / 缩短冷却 / 待我回的书信 /
 * 未分配的书信 —— 一次 `/officer-app/todo/`(官员端 App「待我处理」同一个数,服务端逐组按权限给空),
 * 受刑请求(`sentence-plans/?pending_request=true`,收件箱页同一个过滤)、社区举报(默认只数 OPEN,与审核页同一个 key)。
 * 管理员「以此人身份查看」时 `/officer-app/` 一律 403,那五格不显示。
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
      className="relative flex min-h-20 min-w-0 flex-col items-start justify-center gap-1 bg-[oklch(var(--color-surface-1))] px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4"
    >
      {mine && <RowMark />}
      <div className="min-w-0">
        <div className="text-2xs text-[oklch(var(--color-ink-subtle))]">{label}</div>
        {query.isLoading ? (
          <Skeleton className="h-9 w-12" />
        ) : failed ? (
          <div className="flex min-h-9 flex-wrap items-baseline gap-x-2">
            <MissingValue kind="unrecorded" className="font-title text-xl text-[oklch(var(--color-ink-subtle))]" />
            <span role="alert" className="text-sm text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("dashboard.todo.load_error")}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2">
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
  // 被拒 / 取消后等着重新发起的调拨:口径在服务端(`?awaiting_redispatch=true`,本殿是原属的计划)。
  // 链接落到受刑计划列表的同一个筛选(此前只能链到第一份计划的灵魂,其余找不到);按钮在各灵魂的计划卡上。
  const canResend = hasPermission("judgment.execute");
  const resendQ = useQuery({
    queryKey: ["dashboard", "todo", "redispatch"],
    queryFn: async () => (await sentencePlansApi.list({ awaiting_redispatch: true, page: 1 })).data.count,
    enabled: canResend,
    staleTime: 60_000,
  });
  const viewing = useImpersonation() !== null;
  const canApprove = hasPermission("workflow.approve") && !viewing;
  const canLetters = hasPermission("soul_inbox.reply") && !viewing;
  const officerQ = useQuery({
    queryKey: ["dashboard", "todo", "officer"],
    queryFn: async () => (await officerAppApi.todo()).data,
    enabled: canApprove || canLetters,
    staleTime: 60_000,
  });
  const officerCount = (group: "approvals" | "rebirths" | "cooldowns" | "letters" | "unassigned_letters") =>
    ({ ...officerQ, data: officerQ.data?.[group].count }) as UseQueryResult<number>;
  const canSentenceRequests = hasPermission("judgment.execute");
  const sentenceRequestQ = useQuery({
    queryKey: ["dashboard", "todo", "sentence-requests"],
    queryFn: async () => (await sentencePlansApi.list({ pending_request: true, page: 1 })).data.count,
    enabled: canSentenceRequests,
    staleTime: 60_000,
  });
  const canModerate = hasPermission("social.moderate");
  const reportsQ = useQuery({
    queryKey: ["dashboard", "todo", "reports"],
    queryFn: async () => (await socialModerationApi.reports({})).data.count,
    enabled: canModerate,
    staleTime: 60_000,
  });
  // The cell reads a number; the link also needs the status the server counted.
  const deathCountQ = { ...deathSyncQ, data: deathSyncQ.data?.anomaly_count } as UseQueryResult<number>;
  if (!canDispatch && !canJudge && !canDeathSync && !canResend && !canApprove && !canLetters && !canSentenceRequests && !canModerate)
    return null;
  return (
    <div
      data-todo-strip=""
      className="grid grid-cols-2 gap-px max-lg:[&>*:last-child:nth-child(odd)]:col-span-2 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] border border-[oklch(var(--color-line))] bg-[oklch(var(--color-line))]"
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
      {canResend && (
        <TodoCell
          label={t("dashboard.todo.resend_dispatch")}
          query={resendQ}
          href="/sentence-plans?awaiting_redispatch=true"
          linkText={t("dashboard.todo.go_resend")}
          clearText={t("dashboard.todo.none")}
        />
      )}
      {canApprove && (
        <>
          <TodoCell
            label={t("dashboard.todo.approvals")}
            query={officerCount("approvals")}
            href="/workflow?tab=instances"
            linkText={t("dashboard.todo.go_approve")}
            clearText={t("dashboard.todo.none")}
          />
          <TodoCell
            label={t("dashboard.todo.rebirths")}
            query={officerCount("rebirths")}
            href="/rebirth-applications"
            linkText={t("dashboard.todo.go_approve")}
            clearText={t("dashboard.todo.none")}
          />
          <TodoCell
            label={t("dashboard.todo.cooldowns")}
            query={officerCount("cooldowns")}
            href="/rebirth-applications?tab=shortenings"
            linkText={t("dashboard.todo.go_approve")}
            clearText={t("dashboard.todo.none")}
          />
        </>
      )}
      {canLetters && (
        <>
          <TodoCell
            label={t("dashboard.todo.letters")}
            query={officerCount("letters")}
            href="/soul-inbox?folder=assigned_to_me"
            linkText={t("dashboard.todo.go_resend")}
            clearText={t("dashboard.todo.none")}
          />
          <TodoCell
            label={t("dashboard.todo.unassigned_letters")}
            query={officerCount("unassigned_letters")}
            href="/soul-inbox?folder=awaiting_reply"
            linkText={t("dashboard.todo.go_view")}
            clearText={t("dashboard.todo.none")}
          />
        </>
      )}
      {canSentenceRequests && (
        <TodoCell
          label={t("dashboard.todo.sentence_requests")}
          query={sentenceRequestQ}
          href="/sentence-requests"
          linkText={t("dashboard.todo.go_resend")}
          clearText={t("dashboard.todo.none")}
        />
      )}
      {canModerate && (
        <TodoCell
          label={t("dashboard.todo.reports")}
          query={reportsQ}
          href="/moderation"
          linkText={t("dashboard.todo.go_view")}
          clearText={t("dashboard.todo.none")}
        />
      )}
    </div>
  );
}
