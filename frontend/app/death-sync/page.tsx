"use client";
import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { api } from "@/lib/api";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";

interface DeathRegistration {
  id: string;
  source_system: string;
  status: string;
  idempotency_key: string;
  source_reference_id: string;
  request_timestamp: string;
  processing_duration_ms: number | null;
  error_message: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-[hsl(var(--color-status-warning)/0.2)] text-[hsl(var(--color-status-warning))]",
  ACCEPTED: "bg-[hsl(var(--color-status-info)/0.2)] text-[hsl(var(--color-status-info))]",
  PROCESSED: "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]",
  FAILED: "bg-[hsl(var(--color-status-error)/0.2)] text-[hsl(var(--color-status-error))]",
  DUPLICATE: "bg-[hsl(var(--color-status-lost)/0.2)] text-[hsl(var(--color-status-lost))]",
  PARTIAL: "bg-[hsl(var(--color-status-warning)/0.2)] text-[hsl(var(--color-status-warning))]",
};

export default function DeathSyncPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ["death-sync", "registrations"],
    queryFn: () => api.get("/death-sync/registrations/").then(r => r.data),
    enabled: !!user,
  });

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--color-accent))]">{t("death_sync.title") || "Death Registration"}</h1>
          <p className="text-[hsl(var(--color-ink-subtle))] mt-1">{t("death_sync.subtitle") || "External death registration sync"}</p>
        </div>
      </div>

      <PageSection title={t("death_sync.registrations") || "Registrations"} isLoading={isLoading}>
        {isLoading ? (
          <ListSkeleton count={5} />
        ) : registrations.length === 0 ? (
          <p className="text-[hsl(var(--color-ink-muted))] bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">
            {t("death_sync.no_registrations") || "No death registrations found."}
          </p>
        ) : (
          <div className="space-y-3">
            {registrations.map((reg: DeathRegistration) => (
              <div key={reg.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-[hsl(var(--color-ink))]">{reg.source_system}</p>
                    <p className="text-sm text-[hsl(var(--color-ink-subtle))]">
                      {t("death_sync.reference") || "Ref"}: {reg.source_reference_id || reg.idempotency_key}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[reg.status] || ""}`}>
                    {reg.status}
                  </span>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-[hsl(var(--color-ink-muted))]">
                  <span>{t("death_sync.requested") || "Requested"}: {new Date(reg.request_timestamp).toLocaleString()}</span>
                  {reg.processing_duration_ms && (
                    <span>{t("death_sync.duration") || "Duration"}: {reg.processing_duration_ms}ms</span>
                  )}
                </div>
                {reg.error_message && (
                  <p className="mt-2 text-sm text-[hsl(var(--color-status-error))]">{reg.error_message}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}
