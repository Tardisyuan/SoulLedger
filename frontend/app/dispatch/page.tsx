"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dispatchApi, type DispatchRecord } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Pagination } from "@/src/components/ui/Pagination";
import { PAGE_SIZE } from "@/lib/api/client";
import { buttonVariants } from "@/src/components/ui/Button";
import { badgeVariants, type BadgeTone } from "@/src/components/ui/Badge";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

/**
 * Dispatch state → badge tone, for the two lists on this page.
 *
 * The detail route keeps a `--color-status-*` map instead, because that one is
 * registered by name in `src/__tests__/statusTokenLayering.test.ts` and moving
 * it would delete a record rather than settle it. This map is new, so it takes
 * the route the tone table exists for. The two render the same colours: a tone
 * is the same token at the same 10% fill, plus the border the detail page's
 * pairs never named.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  PROPOSED: "warning",
  APPROVED: "success",
  REJECTED: "error",
  EXECUTED: "info",
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
   * pagination control. The server paginates at 20 (`lib/api/client.ts:28`),
   * so **everything past the twentieth record was invisible and unreachable**,
   * with nothing on screen saying so — on the page where cross-tenant
   * approvals are triaged. The count is rendered now as well: "20 of 137" is
   * the part that was missing even more than the controls.
   */
  const [proposedPage, setProposedPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);

  const {
    data: proposedData, isLoading: loadingProposed,
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
      {/* Pending Proposals - skeleton while loading */}
      <PageSection title={t("dispatch.pending")} isLoading={loadingProposed} className="mb-6">
        {loadingProposed ? (
          <ListSkeleton count={3} />
        ) : proposedError ? (
          <QueryError onRetry={() => refetchProposed()} />
        ) : proposed.length === 0 ? (
          <EmptyState title={t("dispatch.no_pending")} />
        ) : (
          <div className="space-y-3">
            {proposed.map((d: DispatchRecord) => (
              <DispatchCard key={d.id} dispatch={d} />
            ))}
          </div>
        )}
        <Pagination
          page={proposedPage}
          totalPages={Math.max(1, Math.ceil((proposedData?.count ?? 0) / PAGE_SIZE))}
          count={proposedData?.count ?? 0}
          onPageChange={setProposedPage}
        />
      </PageSection>

      {/* History - skeleton while loading */}
      <PageSection title={t("dispatch.history")} isLoading={loadingHistory}>
        {loadingHistory ? (
          <ListSkeleton count={5} />
        ) : historyError ? (
          <QueryError onRetry={() => refetchHistory()} />
        ) : history.length === 0 ? (
          <EmptyState title={t("dispatch.no_history")} />
        ) : (
          <div className="space-y-3">
            {history.map((d: DispatchRecord) => (
              <DispatchCard key={d.id} dispatch={d} />
            ))}
          </div>
        )}
        <Pagination
          page={historyPage}
          totalPages={Math.max(1, Math.ceil((historyData?.count ?? 0) / PAGE_SIZE))}
          count={historyData?.count ?? 0}
          onPageChange={setHistoryPage}
        />
      </PageSection>
    </PageShell>
  );
}

function DispatchCard({ dispatch }: { dispatch: DispatchRecord }) {
  const { t, formatDateTime } = useI18n();

  return (
    <Link href={`/dispatch/${dispatch.id}`} className="block">
      <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 hover:border-[hsl(var(--color-accent))] transition-colors cursor-pointer">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{t("dispatch.soul_prefix")}
              {/* `soul_name` is in the same response and was going unread;
                  the card printed the primary key instead. */}
              {dispatch.soul_name || <MissingValue kind="unrecorded" />}</p>
            <p className="text-03 text-[hsl(var(--color-ink-subtle))]">
              {dispatch.source_tenant_code} → {dispatch.target_tenant_code}
            </p>
            {/* `proposed_at` was in the response and unread, so this card
                carried no time at all — a queue that cannot be triaged by age.
                Mono + tabular-nums so the timestamps line up digit for digit
                down a column of cards, which is what makes "oldest first"
                readable at a glance. */}
            <p className="text-02 font-mono tabular-nums text-[hsl(var(--color-ink-subtle))] mt-1">
              {dispatch.proposed_at ? (
                formatDateTime(dispatch.proposed_at)
              ) : (
                <MissingValue kind="unrecorded" />
              )}
            </p>
          </div>
          {/* <DomainEnum> renders exactly one span, so passing the badge
              classes to it makes the badge itself the enum — no wrapper, and
              the raw member reaches `title` for free (BRIEF §4.6). */}
          <DomainEnum
            namespace="dispatch.states"
            value={dispatch.status}
            className={badgeVariants({ tone: STATUS_TONES[dispatch.status] ?? "neutral" })}
          />
        </div>
        {dispatch.reason && (
          <p className="mt-2 text-03 text-[hsl(var(--color-ink-muted))]">{dispatch.reason}</p>
        )}
      </div>
    </Link>
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
