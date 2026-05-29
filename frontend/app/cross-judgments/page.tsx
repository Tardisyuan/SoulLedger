"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { crossTenantJudgmentsApi, type CrossTenantJudgment } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function CrossJudgmentsPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: judgments = [], isLoading, error } = useQuery({
    queryKey: ["cross-judgments"],
    queryFn: () => crossTenantJudgmentsApi.list().then(r => r.data),
    enabled: !!user,
  });

  const statusColors: Record<string, string> = {
    PROPOSED: "bg-yellow-500/20 text-yellow-400",
    ACTIVE: "bg-blue-500/20 text-blue-400",
    CONCLUDED: "bg-green-500/20 text-green-400",
    CANCELLED: "bg-gray-500/20 text-gray-400",
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--color-accent))]">
          {t("crossJudgments.title")}
        </h1>
        <p className="text-[hsl(var(--color-ink-subtle))] mt-1">
          {t("crossJudgments.subtitle")}
        </p>
      </div>

      <PageSection
        title={t("crossJudgments.list_title") || "Cross-Judgment Cases"}
        isLoading={isLoading}
      >
        {isLoading ? (
          <ListSkeleton count={3} />
        ) : judgments.length === 0 ? (
          <p className="text-[hsl(var(--color-ink-muted))] py-4 text-center">
            {t("crossJudgments.no_judgments") || "No cross-tenant judgments yet"}
          </p>
        ) : (
          <div className="space-y-4">
            {judgments.map((j: CrossTenantJudgment) => (
              <Link
                key={j.id}
                href={`/cross-judgments/${j.id}`}
                className="block bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4 hover:border-[hsl(var(--color-accent))]/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-[hsl(var(--color-ink))]">{j.title}</h3>
                    <p className="text-sm text-[hsl(var(--color-ink-subtle))]">
                      {t("crossJudgments.initiated_by") || "Initiated by"}: {j.initiating_tenant}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[j.status] || "bg-gray-500/20"}`}>
                    {j.status}
                  </span>
                </div>
                {j.description && (
                  <p className="mt-2 text-sm text-[hsl(var(--color-ink-muted))] line-clamp-2">{j.description}</p>
                )}
                {j.participants.length > 0 && (
                  <p className="mt-2 text-xs text-[hsl(var(--color-ink-muted))]">
                    {j.participants.length} {t("crossJudgments.participants") || "participants"}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}
