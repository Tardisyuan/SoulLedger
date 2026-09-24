"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dispatchApi, type DispatchRecord } from "@soulledger/core/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { DataTable, ROW_LINK } from "@/components/ui/data-table";
import { PAGE_SIZE } from "@soulledger/core/api/client";
import { buttonVariants } from "@/src/components/ui/Button";
import { type BadgeTone } from "@/src/components/ui/Badge";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
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
  PROPOSED: "warning",
  APPROVED: "success",
  REJECTED: "error",
  EXECUTED: "info",
  RETURNED: "success",
  CANCELLED: "neutral",
};

function DispatchPageContent() {
  const { t } = useI18n();
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

  const {
    data: proposedData, isLoading: loadingProposed,
    isPlaceholderData: proposedStale,
    isError: proposedError, refetch: refetchProposed,
  } = useQuery({
    queryKey: ["dispatch", "proposed", proposedPage],
    queryFn: () => dispatchApi.proposed({ page: String(proposedPage) }).then(r => r.data),
    enabled: !!user,
    placeholderData: (previous) => previous,
  });
  const proposed = proposedData?.results ?? [];

  const {
    data: historyData, isLoading: loadingHistory,
    isPlaceholderData: historyStale,
    isError: historyError, refetch: refetchHistory,
  } = useQuery({
    queryKey: ["dispatch", "history", historyPage],
    queryFn: () => dispatchApi.history({ page: String(historyPage) }).then(r => r.data),
    enabled: !!user,
    placeholderData: (previous) => previous,
  });
  const history = historyData?.results ?? [];

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
      actions={
        /* `buttonVariants` and not `<Button>`: this navigates, so it has to be
           an anchor. The skin is shared; the element is not. */
        <Link href="/dispatch/propose" className={buttonVariants({ variant: "primary" })}>
          {t("dispatch.propose")}
        </Link>
      }
    >
      {/* 账页表格(规范 v1 §2):整行点进详情,不再是一叠卡片。加载、失败、空与分页交给
          DataTable —— 失败仍与空分开(「! 加载失败」+ 重试,不是「暂无」)。 */}
      <PageSection title={t("dispatch.pending")} isRefreshing={proposedStale} className="mb-6">
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
        />
      </PageSection>

      <PageSection title={t("dispatch.history")} isRefreshing={historyStale}>
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
        />
      </PageSection>
    </PageShell>
  );
}

function DispatchTable({
  rows, isLoading, isError, onRetry, emptyMessage, page, count, onPageChange, caption,
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
}) {
  const { t, formatDateTime } = useI18n();
  return (
    <DataTable<DispatchRecord>
      linkedRows
      caption={caption}
      columns={[
        { key: "soul", header: t("dispatch.soul") },
        { key: "route", header: `${t("dispatch.source_tenant")} → ${t("dispatch.target_tenant")}` },
        { key: "proposed_at", header: t("dispatch.proposed_at") },
        { key: "status", header: t("dispatch.status") },
      ]}
      data={rows}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      emptyMessage={emptyMessage}
      skeletonRows={3}
      keyExtractor={(d) => String(d.id)}
      renderRow={(d) => (
        <>
          <td className="px-3 py-2 font-medium text-[oklch(var(--color-ink))]">
            {/* `soul_name` is in the same response and was going unread;
                the card printed the primary key instead. */}
            <Link href={`/dispatch/${d.id}`} className={ROW_LINK}>
              {d.soul_name || <MissingValue kind="unrecorded" />}
            </Link>
            {d.reason && (
              <p className="text-xs font-normal text-[oklch(var(--color-ink-muted))]">{d.reason}</p>
            )}
          </td>
          <td className="px-3 py-2 font-mono text-xs text-[oklch(var(--color-ink-muted))]">
            {d.source_tenant_code} → {d.target_tenant_code}
          </td>
          {/* `proposed_at` was in the response and unread, so the queue could
              not be triaged by age. Mono + tabular-nums so the timestamps line
              up digit for digit down the column. */}
          <td className="px-3 py-2 font-mono text-xs tabular-nums text-[oklch(var(--color-ink-subtle))]">
            {d.proposed_at ? formatDateTime(d.proposed_at) : <MissingValue kind="unrecorded" />}
          </td>
          <td className="px-3 py-2">
            <StatusBadge namespace="dispatch.states" value={d.status} tone={STATUS_TONES[d.status] ?? "neutral"} />
          </td>
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
