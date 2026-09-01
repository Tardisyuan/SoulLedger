"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pagination } from "@/src/components/ui/Pagination";
import { PAGE_SIZE } from "@/lib/api/client";
import Link from "next/link";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { crossTenantJudgmentsApi, type CrossTenantJudgmentListItem } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { ListSkeleton } from "@/components/ui/skeleton";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { badgeVariants, type BadgeTone } from "@/src/components/ui/Badge";

/**
 * Case state → badge tone.
 *
 * A TONE and not a token: the four members here describe how a joint case is
 * progressing, which is what the feedback layer means, but naming
 * `--color-status-*` in a map keyed by a domain enumeration is the exact shape
 * `src/__tests__/statusTokenLayering.test.ts` polices. Going through a tone
 * keeps the indirection the tone table was built for — the same route
 * `ENUM_TONE_CLASSES` takes in the shared data grid — instead of adding a
 * fifth hand-rolled offender to that file's register.
 *
 * CANCELLED is `neutral` rather than `error`: a case withdrawn is not a case
 * that failed.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  PROPOSED: "warning",
  ACTIVE: "info",
  CONCLUDED: "success",
  CANCELLED: "neutral",
};

export default function CrossJudgmentsPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  /**
   * Was `list()` with no `page` param and no pagination control, while the
   * server paginates at 20 (`lib/api/client.ts:28`) — so a tenant with more
   * than twenty cross-tenant cases had the rest invisible and unreachable,
   * with nothing on screen saying so.
   */
  const [page, setPage] = useState(1);
  const { data: pageData, isLoading, isError, refetch } = useQuery({
    queryKey: ["cross-judgments", page],
    queryFn: () => crossTenantJudgmentsApi.list({ page: String(page) }).then(r => r.data),
    placeholderData: (previous) => previous,
    enabled: !!user,
  });
  const judgments = pageData?.results ?? [];

  return (
    <PageShell
      variant="full"
      pagination={{
        count: (
          <p className="text-03 text-ink-muted">
            {t("pagination.info", {
              page: String(page),
              total: String(Math.max(1, Math.ceil((pageData?.count ?? 0) / PAGE_SIZE))),
              count: String(pageData?.count ?? 0),
            })}
          </p>
        ),
        controls: (
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil((pageData?.count ?? 0) / PAGE_SIZE))}
            count={pageData?.count ?? 0}
            onPageChange={setPage}
            showInfo={false}
          />
        ),
      }}
      title={
        <>
          {t("crossJudgments.title")}
          <MenuGloss path="/cross-judgments" />
        </>
      }
      subtitle={t("crossJudgments.subtitle")}
    >
      <PageSection
        title={t("crossJudgments.list_title") || "Cross-Judgment Cases"}
        isLoading={isLoading}
      >
        {/* A failed request used to fall through to the empty state, so
            "the server is down" and "there is nothing here" read the same. */}
        {isError ? (
          <QueryError onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton count={3} />
        ) : judgments.length === 0 ? (
          <EmptyState title={t("crossJudgments.no_judgments") || "No cross-tenant judgments yet"} />
        ) : (
          <div className="space-y-4">
            {judgments.map((j: CrossTenantJudgmentListItem) => (
              <Link
                key={j.id}
                href={`/cross-judgments/${j.id}`}
                className="block bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 hover:border-[hsl(var(--color-accent))]/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-04 font-semibold text-[hsl(var(--color-ink))]">{j.title}</h3>
                    <p className="text-03 text-[hsl(var(--color-ink-subtle))]">
                      {t("crossJudgments.initiated_by") || "Initiated by"}: {j.initiating_tenant_code}
                    </p>
                  </div>
                  {/* <DomainEnum> renders exactly one span, so it becomes the
                      badge itself and the raw member still reaches `title`. */}
                  <DomainEnum
                    namespace="crossJudgments.states"
                    value={j.status}
                    className={badgeVariants({ tone: STATUS_TONES[j.status] ?? "neutral" })}
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}
