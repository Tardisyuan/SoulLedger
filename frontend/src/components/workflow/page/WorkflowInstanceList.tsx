"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflowListItem } from "@soulledger/core/api";
import { PAGE_SIZE } from "@soulledger/core/api/client";
import { useI18n } from "@/src/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { fieldControl } from "@/src/components/ui/Field";
import { FilterChipSelect, filterChipClass } from "@/src/components/ui/FilterChip";
import { Pagination } from "@/src/components/ui/Pagination";
import { Button } from "@/src/components/ui/Button";
import { QueryError } from "@/src/components/ui/PageError";
import { ExportCsvButton } from "@/src/components/ExportCsvButton";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { StartWorkflowDialog } from "@/src/components/workflow/StartWorkflowDialog";
import { workflowTitle } from "@/src/components/workflow/workflowTitle";
import { ListSkeleton } from "@/components/ui/skeleton";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { Badge } from "@/src/components/ui/Badge";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { PickNodesGroup } from "@/src/components/workflow/segments/PickNodesGroup";

/** 与后端 `ApprovalWorkflowStatus` / `CaseType` / `Civilization` 的取值一一对应(`apps/workflow/filters.py` 认这几个)。 */
const STATUSES = ["PENDING", "IN_PROGRESS", "APPROVED", "REJECTED", "APPEAL", "EXCEPTION", "COMPLETED"] as const;
const CASE_TYPES = [
  "ROUTINE", "APPEAL", "CROSS_REALM", "SPECIAL", "CANONIZATION", "PURGATORY_REVIEW", "HERESY_TRIAL",
  "HEART_WEIGHING", "DIVINE_TRIAL", "REBIRTH_APPLICATION",
] as const;
const CIVILIZATIONS = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"] as const;
const PRIORITIES = [["0", "normal"], ["1", "urgent"], ["2", "critical"]] as const;

/**
 * 「实例」页签的整块:筛选条 + 列表 + 翻页。此前只取第一页(20 条)、只有「已超时」一枚签,
 * 第 21 条以后的实例在 Web 上找不到。筛选照调拨列表(`app/dispatch/page.tsx`)的样子:
 * 搜索框、状态 / 案件类型 / 文明 / 优先级四个下拉签、创建日期起止;「只看已超时」照旧。
 * 导出带同一组筛选,不带页码。
 */
export function WorkflowInstancesPanel({ hall }: { hall?: string }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [caseType, setCaseType] = useState("");
  const [civilization, setCivilization] = useState("");
  const [priority, setPriority] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // 「发起审批」(W-11):实例页签右上角,持 `workflow.create` 才有。
  const [startOpen, setStartOpen] = useState(false);

  const filterParams: Record<string, string> = {};
  if (overdueOnly) filterParams.overdue = "true";
  if (search.trim()) filterParams.search = search.trim();
  if (status) filterParams.status = status;
  if (caseType) filterParams.case_type = caseType;
  if (civilization) filterParams.civilization = civilization;
  // 后端只有 priority_min / priority_max;选一档就两端取同一个值。
  if (priority) Object.assign(filterParams, { priority_min: priority, priority_max: priority });
  // 后端是 DateTimeFilter:截止日要到当天结束,否则当天创建的被排除。
  if (from) filterParams.created_after = from;
  if (to) filterParams.created_before = `${to} 23:59:59`;
  const isFiltered = Object.keys(filterParams).some((k) => k !== "overdue");
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const { data, isLoading, isError, refetch } = useQuery({
    // Pushed: workflow events invalidate `workflowKeys.all` (["workflows"]) —— 前缀匹配,带参数的键也会刷新。
    queryKey: ["workflows", page, filterParams],
    queryFn: async () => (await workflowApi.list({ page: String(page), ...filterParams })).data,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });

  if (isError) return <QueryError onRetry={() => refetch()} />;

  const count = data?.count ?? 0;
  const option = (ns: string, values: readonly string[]) => [
    { value: "", label: t("workflow.filter.all") },
    ...values.map((v) => ({ value: v, label: t(`${ns}.${v}`) })),
  ];

  return (
    <>
      {/* 待我选站(W-2):审批页最上面一组,有才显示。 */}
      <PickNodesGroup />
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <input
          type="text"
          data-testid="workflow-search"
          placeholder={t("workflow.filter.search")}
          aria-label={t("workflow.filter.search")}
          value={search}
          onChange={(e) => changeFilter(() => setSearch(e.target.value))}
          className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[200px]")}
        />
        <FilterChipSelect
          label={t("workflow.detail.status")}
          value={status}
          options={option("workflow.status", STATUSES)}
          clearLabel={t("filter.clear_one", { name: t("workflow.detail.status") })}
          onChange={(v) => changeFilter(() => setStatus(v))}
        />
        <FilterChipSelect
          label={t("workflow.detail.case_type")}
          value={caseType}
          options={option("workflow.case_types", CASE_TYPES)}
          clearLabel={t("filter.clear_one", { name: t("workflow.detail.case_type") })}
          onChange={(v) => changeFilter(() => setCaseType(v))}
        />
        <FilterChipSelect
          label={t("workflow.filter.civilization")}
          value={civilization}
          options={option("souls.civilizations", CIVILIZATIONS)}
          clearLabel={t("filter.clear_one", { name: t("workflow.filter.civilization") })}
          onChange={(v) => changeFilter(() => setCivilization(v))}
        />
        <FilterChipSelect
          label={t("workflow.detail.priority")}
          value={priority}
          options={[
            { value: "", label: t("workflow.filter.all") },
            ...PRIORITIES.map(([v, k]) => ({ value: v, label: t(`workflow.detail.${k}`) })),
          ]}
          clearLabel={t("filter.clear_one", { name: t("workflow.detail.priority") })}
          onChange={(v) => changeFilter(() => setPriority(v))}
        />
        <input
          type="date"
          data-testid="workflow-from"
          aria-label={t("workflow.filter.from")}
          title={t("workflow.filter.from")}
          value={from}
          max={to || undefined}
          onChange={(e) => changeFilter(() => setFrom(e.target.value))}
          className={fieldControl({ size: "md" })}
        />
        <input
          type="date"
          data-testid="workflow-to"
          aria-label={t("workflow.filter.to")}
          title={t("workflow.filter.to")}
          value={to}
          min={from || undefined}
          onChange={(e) => changeFilter(() => setTo(e.target.value))}
          className={fieldControl({ size: "md" })}
        />
        <button
          type="button"
          aria-pressed={overdueOnly}
          onClick={() => changeFilter(() => setOverdueOnly((v) => !v))}
          className={filterChipClass(overdueOnly)}
        >
          {overdueOnly && <span aria-hidden="true">✓</span>}
          {t("workflow.filter_overdue")}
        </button>
        {isFiltered ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              changeFilter(() => {
                setSearch("");
                setStatus("");
                setCaseType("");
                setCivilization("");
                setPriority("");
                setFrom("");
                setTo("");
              })
            }
          >
            {t("workflow.filter.clear")}
          </Button>
        ) : null}
        <div className="ml-auto flex items-center justify-end gap-3">
          <ExportCsvButton
            size="sm"
            fetchCsv={() => workflowApi.exportCsv(filterParams)}
            page={t("workflow.title")}
            hall={hall}
            count={data?.count}
          />
          <RequirePermission permissions="workflow.create">
            <Button type="button" variant="primary" size="sm" onClick={() => setStartOpen(true)}>
              {t("workflow.start.action")}
            </Button>
          </RequirePermission>
        </div>
      </div>
      <WorkflowInstanceList workflows={data?.results ?? []} isLoading={isLoading} />
      {count > PAGE_SIZE && (
        <div className="pt-3">
          <Pagination page={page} totalPages={Math.ceil(count / PAGE_SIZE)} count={count} onPageChange={setPage} />
        </div>
      )}
      <StartWorkflowDialog isOpen={startOpen} onClose={() => setStartOpen(false)} />
    </>
  );
}

/**
 * /workflow 的「实例」页签：审批流实例列表。原先长在 app/workflow/page.tsx 的
 * return 里，那个文件越过仓库 500 行的上限之后搬到这里。
 *
 * 每一行仍然是 `<Link>`，不是 `<div onClick>` —— 那一行下面的注释记着为什么，
 * 而 src/__tests__/WorkflowPage.test.tsx 钉着锚点的 `href` 和「没有
 * tabindex="-1"」。标记逐字未改，只把 `isWorkflowsLoading` 换成 prop `isLoading`。
 */
export function WorkflowInstanceList({
  workflows,
  isLoading,
}: {
  workflows: ApprovalWorkflowListItem[];
  isLoading: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      {isLoading ? (
        <ListSkeleton count={5} />
      ) : workflows.length === 0 ? (
        /* `py-12` (48px) is not a step on the ladder, and a centred
           "nothing here" reads as the page's subject rather than as the
           absence of one. EmptyState is left-aligned for that reason. */
        <EmptyState title={t("workflow.no_instances")} />
      ) : (
        workflows.map((wf) => (
          /* This row used to be a <div onClick={router.push}> with
             cursor-pointer and nothing else: no role, no tabIndex, no
             key handler. It looked clickable and was clickable, but Tab
             never reached it and Enter was bound to nothing, so the
             instance detail page had no keyboard route in at all. A
             <Link> is the fix rather than role="button" + tabIndex +
             onKeyDown, because this is navigation: the anchor is
             focusable natively, announces as a link, and restores
             middle-click-to-new-tab and copy-link-address, none of which
             a keyboard-emulating div gives back. The card holds no other
             interactive element, so there is no nested-<a> problem.
             `block` is what keeps the layout identical — an <a> is
             inline by default and p-4 would collapse. */
          <Link
            key={wf.id}
            href={`/workflow/${wf.id}`}
            className="block bg-[oklch(var(--color-surface-1))] p-4 border border-[oklch(var(--color-hairline))] hover:border-[oklch(var(--color-accent))]/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-[oklch(var(--color-ink))]">{workflowTitle(wf, t)}</div>
                <div className="text-xs text-[oklch(var(--color-ink-muted))] mt-1">
                  {wf.number ? (
                    <>
                      <span data-workflow-number="" className="font-mono">{wf.number}</span>{" · "}
                    </>
                  ) : null}
                  <DomainEnum namespace="workflow.case_types" value={wf.case_type} />{" · "}
                  {/* `wf.soul` is the primary key. This row used to print the
                      UUID as though it were the soul's name. */}
                  {wf.soul_name || <MissingValue kind="unrecorded" />}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Tints unchanged, geometry moved onto Badge — which is
                    also what keeps the row's `py-0.5` legal, since that
                    class is granted to Badge.tsx alone. <DomainEnum>
                    still renders the inner span carrying title={raw},
                    which `WorkflowPage.test.tsx` selects on
                    (`getByTitle("IN_PROGRESS")`). */}
                <Badge
                  className={
                    wf.status === "COMPLETED"
                      ? "bg-[oklch(var(--color-status-success)/0.1)] text-[oklch(var(--color-status-success))]"
                      : wf.status === "IN_PROGRESS"
                      ? "bg-[oklch(var(--color-accent))]/20 text-[oklch(var(--color-accent-ink))]"
                      : "bg-[oklch(var(--color-surface-3))] text-[oklch(var(--color-ink-muted))]"
                  }
                >
                  <DomainEnum namespace="workflow.status" value={wf.status} />
                </Badge>
                {wf.is_overdue && (
                  <Badge className="bg-[oklch(var(--color-status-warning)/0.1)] text-[oklch(var(--color-status-warning))]">
                    {t("workflow.overdue_badge")}
                  </Badge>
                )}
                {wf.is_appeal && (
                  <Badge className="bg-[oklch(var(--color-verdict-retry)/0.1)] text-[oklch(var(--color-verdict-retry))]">
                    {t("workflow.appeal_badge")}
                  </Badge>
                )}
              </div>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
