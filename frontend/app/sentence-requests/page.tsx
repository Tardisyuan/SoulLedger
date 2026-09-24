"use client";

import { useState } from "react";
import Link from "next/link";
import { useSentencePlans } from "@soulledger/core/hooks/useSentencePlans";
import { PAGE_SIZE } from "@soulledger/core/api/client";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Pagination } from "@/src/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PLAN_TONES, RequestChanges, TenantName } from "@/src/components/sentence-plan/sentencePlanDisplay";
import { SentenceRequestActions } from "@/src/components/sentence-plan/SentenceRequestActions";

/*
 * 受刑请求收件箱:加减项 / 重开审判请求,待原审判官决定的那些
 * (`sentence-plans/?pending_request=true`,docs/ARCHITECTURE-sentence-plan.md §4)。
 *
 * 一份计划同一时刻至多一条 PENDING 请求(约束 `unique_pending_sentence_request`),所以一行一份计划。
 * 列表里有两种:本租户是原属的(等我决定)与本租户提出的(可撤回);哪种由行上的按钮说明,
 * 按钮规则在 `SentenceRequestActions`。已决定的请求留在灵魂详情的计划面板里看。
 */

const PANEL = "border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-1))]";
const MUTED = "text-xs text-[oklch(var(--color-ink-subtle))]";

function SentenceRequestsContent() {
  const { t, formatDateTime } = useI18n();
  const { user } = useTenant();
  const [page, setPage] = useState(1);
  const list = useSentencePlans({ pending_request: true, page });
  const plans = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  const mine = user?.tenant?.code;

  return (
    <PageShell variant="page" title={t("sentence_plan.inbox_title")} subtitle={t("sentence_plan.inbox_subtitle")}>
      {list.isLoading ? (
        <ListSkeleton count={3} />
      ) : list.isError && !list.data ? (
        <QueryError onRetry={() => list.refetch()} />
      ) : plans.length === 0 ? (
        <EmptyState title={t("sentence_plan.inbox_empty")} reason={t("sentence_plan.inbox_empty_reason")} />
      ) : (
        <>
          <ul aria-label={t("sentence_plan.inbox_title")} className="space-y-4">
            {plans.map((plan) => {
              const request = plan.requests.find((r) => r.status === "PENDING");
              if (!request) return null;
              return (
                <li key={plan.id} data-plan-id={plan.id} className={`${PANEL} p-4 space-y-2`}>
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/souls/${plan.soul}`} className="text-sm font-medium text-[oklch(var(--color-accent-ink))] underline underline-offset-2">
                      {plan.soul_name}
                    </Link>
                    <Badge tone={PLAN_TONES[plan.status] ?? "neutral"}>
                      <DomainEnum namespace="sentence_plan.plan_states" value={plan.status} />
                    </Badge>
                    {mine === plan.tenant_code && <Badge tone="accent">{t("sentence_plan.awaiting_you")}</Badge>}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <DomainEnum namespace="sentence_plan.request_kinds" value={request.kind} />
                    <span className={MUTED}>
                      {t("sentence_plan.request_from")} <TenantName code={request.from_tenant_code} />
                      {" · "}
                      {t("sentence_plan.home")} <TenantName code={plan.tenant_code} />
                      {" · "}
                      {formatDateTime(request.create_time)}
                    </span>
                  </p>
                  <RequestChanges request={request} plan={plan} />
                  {request.reason && <p className="text-sm text-[oklch(var(--color-ink-muted))]">{request.reason}</p>}
                  <SentenceRequestActions plan={plan} request={request} />
                </li>
              );
            })}
          </ul>
          {count > PAGE_SIZE && (
            <Pagination page={page} totalPages={Math.ceil(count / PAGE_SIZE)} count={count} onPageChange={setPage} />
          )}
        </>
      )}
    </PageShell>
  );
}

export default function SentenceRequestsPage() {
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied />}>
      <SentenceRequestsContent />
    </RequirePermission>
  );
}
