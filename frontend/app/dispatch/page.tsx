"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dispatchApi, type DispatchRecord } from "@soulledger/core/api";
import { useTenantNames } from "@soulledger/core/hooks/useTenants";
import { useDebouncedValue } from "@soulledger/core/hooks/useDebouncedValue";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useCourtOffice, useHall } from "@/src/components/plaque/useHall";
import { useMenuButtonConfig } from "@/src/hooks/useMenuButtonConfig";
import { PageSection } from "@/components/ui/page-section";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { DataTable, ROW_LINK, type DataTableColumn } from "@/components/ui/data-table";
import { ColumnMenu, useColumnVisibility, type ColumnVisibility } from "@/components/ui/data-grid";
import { PAGE_SIZE } from "@soulledger/core/api/client";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { fieldControl } from "@/src/components/ui/Field";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { useRememberedFilters } from "@/src/lib/rememberedFilters";
import { cn } from "@/lib/utils";
import { type BadgeTone } from "@/src/components/ui/Badge";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { ExportCsvButton } from "@/src/components/ExportCsvButton";
import { CancelDispatchButton } from "@/src/components/dispatch/CancelDispatchButton";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

/**
 * Dispatch state → badge tone, for the two lists on this page.
 *
 * The detail route keeps a `--color-status-*` map instead, because that one is
 * registered by name in `src/__tests__/statusTokenLayering.test.ts` and moving
 * it would delete a record rather than settle it. This map is new, so it takes
 * the route the tone table exists for. 规范 v1 起徽章没有底色,每个 tone 另配
 * 一枚字形(`StatusBadge`),所以列表不只靠颜色说状态。
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  // 规范 v3:警示色只给「可撤回的风险」,危险色只给错误。等待审批不是风险,被驳回不是错误 ——
  // 两者都是请求走到的一个状态,所以是中性;文字与字形照样把它们分开。
  PROPOSED: "neutral",
  APPROVED: "success",
  REJECTED: "neutral",
  EXECUTED: "info",
  RETURNED: "success",
  CANCELLED: "neutral",
};

function DispatchPageContent() {
  const { t } = useI18n();
  const hall = useHall(useCourtOffice());
  usePlaque({ hall });
  const buttonOn = useMenuButtonConfig();
  const { user } = useTenant();

  // `isError` on both. The `= []` defaults mean a failed request lands on the
  // same empty array an empty tenant produces, so both sections rendered
  // "no pending dispatches" / "no history" when the server was down.
  /**
   * Both lists were `.then(r => r.data.results)` with no `page` param and no
   * pagination control. The server paginates at 20 (`packages/core/src/api/client.ts:28`),
   * so **everything past the twentieth record was invisible and unreachable**,
   * with nothing on screen saying so — on the page where cross-tenant
   * approvals are triaged. The count is rendered now as well: "20 of 137" is
   * the part that was missing even more than the controls.
   */
  const [proposedPage, setProposedPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);

  // 筛选栏(`DispatchFilter`):搜索(灵魂姓名 / 理由)、状态、来源 / 目标租户、发起日期范围;两张表同一套。
  // 状态与两个租户记在本浏览器;搜索框的字和日期属于一次到访,不记。
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sourceTenant, setSourceTenant] = useState("");
  const [targetTenant, setTargetTenant] = useState("");
  const [proposedFrom, setProposedFrom] = useState("");
  const [proposedTo, setProposedTo] = useState("");
  useRememberedFilters(
    DISPATCH_FILTERS_KEY,
    DISPATCH_FILTER_FIELDS,
    { status, source_tenant: sourceTenant, target_tenant: targetTenant },
    (saved) => {
      if (saved.status) setStatus(saved.status);
      if (saved.source_tenant) setSourceTenant(saved.source_tenant);
      if (saved.target_tenant) setTargetTenant(saved.target_tenant);
    }
  );
  const tenantsQuery = useTenantNames({ enabled: !!user, staleTime: 60_000 });
  const tenantOptions = [
    { value: "", label: t("dispatch.filter.all_tenants") },
    ...(tenantsQuery.data ?? []).map(({ id, display_name, code }) => ({ value: String(id), label: display_name || code })),
  ];
  const debouncedSearch = useDebouncedValue(search.trim());
  const filterParams: Record<string, string> = {};
  if (debouncedSearch) filterParams.search = debouncedSearch;
  if (status) filterParams.status = status;
  if (sourceTenant) filterParams.source_tenant = sourceTenant;
  if (targetTenant) filterParams.target_tenant = targetTenant;
  // 后端是 DateTimeFilter:截止日要到当天结束,否则当天发起的被排除。
  if (proposedFrom) filterParams.proposed_after = proposedFrom;
  if (proposedTo) filterParams.proposed_before = `${proposedTo} 23:59:59`;
  const isFiltered = Object.keys(filterParams).length > 0;
  const filterKey = JSON.stringify(filterParams);
  const changeFilter = (apply: () => void) => {
    apply();
    setProposedPage(1);
    setHistoryPage(1);
  };

  const {
    data: proposedData, isLoading: loadingProposed,
    isPlaceholderData: proposedStale,
    isError: proposedError, refetch: refetchProposed,
  } = useQuery({
    queryKey: ["dispatch", "proposed", proposedPage, filterKey],
    queryFn: () => dispatchApi.proposed({ page: String(proposedPage), ...filterParams }).then(r => r.data),
    enabled: !!user,
    // Pushed: dispatch events invalidate ["dispatch"].
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const proposed = proposedData?.results ?? [];

  const {
    data: historyData, isLoading: loadingHistory,
    isPlaceholderData: historyStale,
    isError: historyError, refetch: refetchHistory,
  } = useQuery({
    queryKey: ["dispatch", "history", historyPage, filterKey],
    queryFn: () => dispatchApi.history({ page: String(historyPage), ...filterParams }).then(r => r.data),
    enabled: !!user,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const history = historyData?.results ?? [];

  const columnVis = useColumnVisibility(DISPATCH_COLUMNS_KEY, dispatchColumns(t));

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("dispatch.title")}
          <MenuGloss path="/dispatch" />
        </>
      }
      subtitle={t("dispatch.subtitle")}
      filters={
        <>
          <input
            type="text"
            data-testid="dispatch-search"
            placeholder={t("dispatch.filter.search")}
            aria-label={t("dispatch.filter.search")}
            value={search}
            onChange={(e) => changeFilter(() => setSearch(e.target.value))}
            className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[200px]")}
          />
          <FilterChipSelect
            label={t("dispatch.status")}
            value={status}
            options={[
              { value: "", label: t("dispatch.filter.all_status") },
              ...Object.keys(STATUS_TONES).map((v) => ({ value: v, label: t(`dispatch.states.${v}`) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("dispatch.status") })}
            onChange={(v) => changeFilter(() => setStatus(v))}
          />
          <FilterChipSelect
            label={t("dispatch.source_tenant")}
            value={sourceTenant}
            options={tenantOptions}
            clearLabel={t("filter.clear_one", { name: t("dispatch.source_tenant") })}
            onChange={(v) => changeFilter(() => setSourceTenant(v))}
          />
          <FilterChipSelect
            label={t("dispatch.target_tenant")}
            value={targetTenant}
            options={tenantOptions}
            clearLabel={t("filter.clear_one", { name: t("dispatch.target_tenant") })}
            onChange={(v) => changeFilter(() => setTargetTenant(v))}
          />
          <input
            type="date"
            data-testid="dispatch-from"
            aria-label={t("dispatch.filter.from")}
            title={t("dispatch.filter.from")}
            value={proposedFrom}
            max={proposedTo || undefined}
            onChange={(e) => changeFilter(() => setProposedFrom(e.target.value))}
            className={fieldControl({ size: "md" })}
          />
          <input
            type="date"
            data-testid="dispatch-to"
            aria-label={t("dispatch.filter.to")}
            title={t("dispatch.filter.to")}
            value={proposedTo}
            min={proposedFrom || undefined}
            onChange={(e) => changeFilter(() => setProposedTo(e.target.value))}
            className={fieldControl({ size: "md" })}
          />
          {isFiltered ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                changeFilter(() => {
                  setSearch("");
                  setStatus("");
                  setSourceTenant("");
                  setTargetTenant("");
                  setProposedFrom("");
                  setProposedTo("");
                })
              }
            >
              {t("dispatch.filter.clear")}
            </Button>
          ) : null}
        </>
      }
      actions={
        /* `buttonVariants` and not `<Button>`: this navigates, so it has to be
           an anchor. The skin is shared; the element is not. */
        <div className="flex items-center gap-3">
          {/* 两张表(待批、历史)共用一份列偏好;「取消移交」列只在历史一张里有。 */}
          <ColumnMenu
            columns={dispatchColumns(t).map((c) => ({ key: c.key, header: String(c.header), pinned: c.pinned }))}
            visibility={columnVis}
            buttonLabel={t("list.columns.button", { shown: String(columnVis.shown), total: String(columnVis.total) })}
            pinnedLabel={t("list.columns.pinned")}
            hintLabel={t("list.columns.hint")}
            resetLabel={t("list.columns.reset")}
          />
          <Link href="/dispatch/propose" className={buttonVariants({ variant: "primary" })}>
            {t("dispatch.propose")}
          </Link>
        </div>
      }
    >
      {/* 账页表格(规范 v1 §2):整行点进详情,不再是一叠卡片。加载、失败、空与分页交给
          DataTable —— 失败仍与空分开(「! 加载失败」+ 重试,不是「暂无」)。 */}
      <PageSection
        title={t("dispatch.pending")}
        isRefreshing={proposedStale}
        className="mb-6"
        actions={buttonOn("dispatch.export") ? <RequirePermission permissions="dispatch.export"><ExportCsvButton size="sm" fetchCsv={() => dispatchApi.exportCsv({ section: "proposed", ...filterParams })} page={t("dispatch.title")} hall={hall} /></RequirePermission> : undefined}
      >
        <DispatchTable
          rows={proposed}
          isLoading={loadingProposed}
          isError={proposedError}
          onRetry={() => refetchProposed()}
          emptyMessage={t("dispatch.no_pending")}
          page={proposedPage}
          count={proposedData?.count ?? 0}
          onPageChange={setProposedPage}
          caption={t("dispatch.pending")}
          columnVis={columnVis}
        />
      </PageSection>

      <PageSection
        title={t("dispatch.history")}
        isRefreshing={historyStale}
        actions={buttonOn("dispatch.export") ? <RequirePermission permissions="dispatch.export"><ExportCsvButton size="sm" fetchCsv={() => dispatchApi.exportCsv({ section: "history", ...filterParams })} page={t("dispatch.title")} hall={hall} /></RequirePermission> : undefined}
      >
        <DispatchTable
          rows={history}
          isLoading={loadingHistory}
          isError={historyError}
          onRetry={() => refetchHistory()}
          emptyMessage={t("dispatch.no_history")}
          page={historyPage}
          count={historyData?.count ?? 0}
          onPageChange={setHistoryPage}
          caption={t("dispatch.history")}
          columnVis={columnVis}
          cancelable
        />
      </PageSection>
    </PageShell>
  );
}

const DISPATCH_COLUMNS_KEY = "soulledger.dispatch.columns";
const DISPATCH_FILTERS_KEY = "soulledger.dispatch.filters";
const DISPATCH_FILTER_FIELDS = ["status", "source_tenant", "target_tenant"] as const;

/** 两张表的列并集;灵魂列与行末的「取消移交」钉住(前者是这行是谁,后者是行上的操作)。 */
function dispatchColumns(t: (key: string) => string): DataTableColumn[] {
  return [
    { key: "soul", header: t("dispatch.soul"), pinned: true },
    { key: "route", header: `${t("dispatch.source_tenant")} → ${t("dispatch.target_tenant")}` },
    { key: "proposed_at", header: t("dispatch.proposed_at") },
    { key: "status", header: t("dispatch.status") },
    { key: "cancel", header: t("dispatch.cancel_dispatch"), pinned: true },
  ];
}

function DispatchTable({
  rows, isLoading, isError, onRetry, emptyMessage, page, count, onPageChange, caption, columnVis, cancelable = false,
}: {
  rows: DispatchRecord[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyMessage: string;
  page: number;
  count: number;
  onPageChange: (_page: number) => void;
  caption: string;
  columnVis: ColumnVisibility;
  /** 「我方发起的」那一段:本殿发起、还没被批准的行末尾有「取消移交」。 */
  cancelable?: boolean;
}) {
  const { t, formatDateTime } = useI18n();
  return (
    <DataTable<DispatchRecord>
      linkedRows
      caption={caption}
      columns={dispatchColumns(t).filter((c) => (cancelable || c.key !== "cancel") && columnVis.isVisible(c.key))}
      data={rows}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      emptyMessage={emptyMessage}
      skeletonRows={3}
      keyExtractor={(d) => String(d.id)}
      renderRow={(d) => (
        <>
          {/* 393 px 下自动布局的表把中文名挤成一字一行;名字、路由、时间、状态都不折行,
              表在自己的 `overflow-x-auto` 里横滚。理由一行截断,完整的在 title 里。 */}
          <td className="px-3 py-2 font-medium whitespace-nowrap text-[oklch(var(--color-ink))]">
            {/* `soul_name` is in the same response and was going unread;
                the card printed the primary key instead. */}
            {/* A draft (only its author is ever sent one) reopens in the form,
                pre-filled; everything else opens the record. */}
            <Link
              href={d.status === "DRAFT" ? `/dispatch/propose?draft=${d.id}` : `/dispatch/${d.id}`}
              className={ROW_LINK}
            >
              {d.soul_name || <MissingValue kind="unrecorded" />}
            </Link>
            {d.reason && (
              <p className="max-w-80 truncate text-xs font-normal text-[oklch(var(--color-ink-muted))]" title={d.reason}>{d.reason}</p>
            )}
          </td>
          {columnVis.isVisible("route") && <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">
            {d.source_tenant_code} → {d.target_tenant_code ?? <MissingValue kind="unrecorded" />}
          </td>}
          {/* `proposed_at` was in the response and unread, so the queue could
              not be triaged by age. Mono + tabular-nums so the timestamps line
              up digit for digit down the column. */}
          {columnVis.isVisible("proposed_at") && <td className="px-3 py-2 font-mono text-xs tabular-nums whitespace-nowrap text-[oklch(var(--color-ink-subtle))]">
            {d.proposed_at ? formatDateTime(d.proposed_at) : <MissingValue kind="unrecorded" />}
          </td>}
          {columnVis.isVisible("status") && <td className="px-3 py-2 whitespace-nowrap">
            <StatusBadge namespace="dispatch.states" value={d.status} tone={STATUS_TONES[d.status] ?? "neutral"} />
          </td>}
          {cancelable && (
            <td className="px-3 py-2 whitespace-nowrap">
              {/* 不满足条件时渲染空(整格留空):不是本殿的、已被处理的、没有 dispatch.manage 的都不出按钮。 */}
              <CancelDispatchButton dispatch={d} size="sm" triggerClassName="relative z-10" />
            </td>
          )}
        </>
      )}
      page={page}
      totalPages={Math.max(1, Math.ceil(count / PAGE_SIZE))}
      totalCount={count}
      onPageChange={onPageChange}
    />
  );
}


/* 页级门。后端才是正解(这几个 viewset 都挂了 `CodenamePermission`),这里是纵深:
   侧边栏的菜单过滤**只藏链接、不挡路由**,所以在补上这道门之前,直接输 URL 就能
   打开一个功能完整的页面。码名与后端 `permission_codename` 对齐,不是猜的角色名 ——
   `tests/test_page_gates_match_the_backend.py` 会因为路由没有门而红。 */
export default function DispatchPage() {
  return (
    <RequirePermission permissions="dispatch.read" fallback={<PermissionDenied />}>
      <DispatchPageContent />
    </RequirePermission>
  );
}
