"use client";
import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { tenantsApi, type Tenant } from "@/lib/api";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";

export default function TenantsPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: tenantsResponse, isLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => tenantsApi.list().then(r => r.data),
    enabled: !!user,
  });

  const tenants = tenantsResponse?.results || tenantsResponse || [];

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--color-accent))]">{t("tenants.title") || "Tenants"}</h1>
        <p className="text-[hsl(var(--color-ink-subtle))] mt-1">{t("tenants.subtitle") || "Tenant management"}</p>
      </div>

      <PageSection title={t("tenants.list") || "All Tenants"} isLoading={isLoading}>
        {isLoading ? (
          <ListSkeleton count={5} />
        ) : tenants.length === 0 ? (
          <p className="text-[hsl(var(--color-ink-muted))] bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">
            {t("tenants.no_tenants") || "No tenants found."}
          </p>
        ) : (
          <div className="space-y-3">
            {tenants.map((tenant: Tenant) => (
              <div key={tenant.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-[hsl(var(--color-ink))]">{tenant.display_name}</p>
                    <p className="text-sm text-[hsl(var(--color-ink-subtle))]">
                      {t("tenants.code") || "Code"}: {tenant.code}
                    </p>
                  </div>
                  <span className="px-2 py-1 rounded text-xs font-medium bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]">
                    Active
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}
