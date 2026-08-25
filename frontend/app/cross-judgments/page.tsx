"use client";
import { useQuery } from "@tanstack/react-query";
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

  const { data: judgments = [], isLoading } = useQuery({
    queryKey: ["cross-judgments"],
    queryFn: () => crossTenantJudgmentsApi.list().then(r => r.data.results),
    enabled: !!user,
  });

  return (
    <PageShell
      variant="full"
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
        {isLoading ? (
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
