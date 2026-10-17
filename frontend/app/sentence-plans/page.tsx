"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSentencePlans } from "@soulledger/core/hooks/useSentencePlans";
import type { SentencePlanFilters, SentencePlanStatus } from "@soulledger/core/api/sentence-plans";
import { PAGE_SIZE } from "@soulledger/core/api/client";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { cn } from "@/lib/utils";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Pagination } from "@/src/components/ui/Pagination";
import { fieldControl } from "@/src/components/ui/Field";
import { FilterChipSelect, FilterChipToggle } from "@/src/components/ui/FilterChip";
import { ListSkeleton } from "@/components/ui/skeleton";
import { CURRENT_NODE_STATUSES, NODE_TONES, PLAN_TONES, TenantName } from "@/src/components/sentence-plan/sentencePlanDisplay";

/*
 * 受刑计划列表(审计 2026-10-17 第 8 条):本殿原属、或本殿有一站的计划(`SentencePlanViewSet.get_queryset`)。
 * 此前只有受刑请求收件箱与灵魂详情的计划卡;首页「待重发的调拨」只能链到第一份计划的灵魂,其余找不到。
 *
 * 筛选都是服务端已有的:状态、`awaiting_redispatch`、`pending_request`、`search`(灵魂姓名)。
 * `?awaiting_redispatch=true` 是首页那一格带来的。版式照受刑请求收件箱(账页的行,不装框);
 * 行上的动作(重发、撤销、决定请求)都在灵魂详情的计划卡上,这里只链过去。
 */

const STATUSES: SentencePlanStatus[] = ["ACTIVE", "RETRIAL", "HELD", "COMPLETED", "CANCELLED"];
const MUTED = "text-xs text-[oklch(var(--color-ink-subtle))]";

function SentencePlansContent() {
  const { t, formatDateTime } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.trials")) });
  const urlParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [awaitingRedispatch, setAwaitingRedispatch] = useState(urlParams?.get("awaiting_redispatch") === "true");
  const [pendingRequest, setPendingRequest] = useState(false);
  const change = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const filters: SentencePlanFilters = { page };
  if (search.trim()) filters.search = search.trim();
  if (status) filters.status = status as SentencePlanStatus;
  if (awaitingRedispatch) filters.awaiting_redispatch = true;
  if (pendingRequest) filters.pending_request = true;
  const isFiltered = Object.keys(filters).length > 1;
  const list = useSentencePlans(filters);
  const plans = list.data?.results ?? [];
  const count = list.data?.count ?? 0;

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("sentence_plan.list_title")}
          <MenuGloss path="/sentence-plans" />
        </>
      }
      subtitle={t("sentence_plan.list_subtitle")}
    >
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <input
          type="text"
          data-testid="sentence-plan-search"
          placeholder={t("sentence_plan.filter.search")}
          aria-label={t("sentence_plan.filter.search")}
          value={search}
          onChange={(e) => change(() => setSearch(e.target.value))}
          className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[200px]")}
        />
        <FilterChipSelect
          label={t("sentence_plan.filter.status")}
          value={status}
          options={[
            { value: "", label: t("filter.all") },
            ...STATUSES.map((s) => ({ value: s, label: t(`sentence_plan.plan_states.${s}`) })),
          ]}
          clearLabel={t("filter.clear_one", { name: t("sentence_plan.filter.status") })}
          onChange={(v) => change(() => setStatus(v))}
        />
        <FilterChipToggle pressed={awaitingRedispatch} onPressedChange={(v) => change(() => setAwaitingRedispatch(v))}>
          {t("sentence_plan.filter.awaiting_redispatch")}
        </FilterChipToggle>
        <FilterChipToggle pressed={pendingRequest} onPressedChange={(v) => change(() => setPendingRequest(v))}>
          {t("sentence_plan.filter.pending_request")}
        </FilterChipToggle>
        {isFiltered && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              change(() => {
                setSearch("");
                setStatus("");
                setAwaitingRedispatch(false);
                setPendingRequest(false);
              })
            }
          >
            {t("filter.clear_all")}
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <ListSkeleton count={3} />
      ) : list.isError && !list.data ? (
        <QueryError onRetry={() => list.refetch()} />
      ) : plans.length === 0 ? (
        <EmptyState title={t("sentence_plan.list_empty")} />
      ) : (
        <>
          <ul aria-label={t("sentence_plan.list_title")} className="border-t border-[oklch(var(--color-block))]">
            {plans.map((plan) => {
              const current = plan.nodes.find((n) => CURRENT_NODE_STATUSES.includes(n.status));
              return (
                <li key={plan.id} data-plan-id={plan.id} className="px-3 py-3 space-y-1 border-b border-[oklch(var(--color-rule))]">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/souls/${plan.soul}`} className="text-sm font-medium text-[oklch(var(--color-ink))] hover:underline underline-offset-2">
                      {plan.soul_name}
                    </Link>
                    <StatusBadge namespace="sentence_plan.plan_states" value={plan.status} tone={PLAN_TONES[plan.status] ?? "neutral"} />
                    {current && (
                      <span className="flex items-center gap-2 text-sm">
                        {t("sentence_plan.stop", { order: String(current.order) })}
                        <TenantName code={current.tenant_code} />
                        <StatusBadge namespace="sentence_plan.node_states" value={current.status} tone={NODE_TONES[current.status] ?? "neutral"} />
                      </span>
                    )}
                  </p>
                  <p className={MUTED}>
                    {t("sentence_plan.cycle", { cycle: String(plan.cycle) })}
                    {" · "}
                    {t("sentence_plan.home")} <TenantName code={plan.tenant_code} />
                    {" · "}
                    <span className="font-mono">{formatDateTime(plan.create_time)}</span>
                  </p>
                </li>
              );
            })}
          </ul>
          {count > PAGE_SIZE && (
            <div className="pt-3">
              <Pagination page={page} totalPages={Math.ceil(count / PAGE_SIZE)} count={count} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

export default function SentencePlansPage() {
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied permission="judgment.read" />}>
      {/* `useSearchParams` 要在 Suspense 里(静态预渲染时它会挂起)。 */}
      <Suspense fallback={<ListSkeleton count={3} />}>
        <SentencePlansContent />
      </Suspense>
    </RequirePermission>
  );
}
