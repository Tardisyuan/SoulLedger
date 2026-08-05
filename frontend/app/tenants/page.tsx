"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { api, PAGE_SIZE, type Tenant, type PaginatedResponse } from "@/lib/api";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";
import { Pagination } from "@/src/components/ui/Pagination";

export default function TenantsPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [page, setPage] = useState(1);

  // tenantsApi.list() (lib/api/tenants.ts) doesn't forward a `page` param, so this
  // calls the shared `api` client directly to reach `/tenants/?page=`.
  const { data, isLoading } = useQuery({
    queryKey: ["tenants", page],
    queryFn: () => api.get("/tenants/", { params: { page } }).then(r => r.data as PaginatedResponse<Tenant>),
    enabled: !!user,
  });

  const tenants = data?.results ?? [];
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;

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

      {!isLoading && tenants.length > 0 && (
        <Pagination page={page} totalPages={totalPages} count={data?.count ?? 0} onPageChange={setPage} />
      )}
    </div>
  );
}
