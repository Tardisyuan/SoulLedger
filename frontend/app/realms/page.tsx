"use client";
import { useQuery } from "@tanstack/react-query";
import { realmsApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { Skeleton, CardSkeleton } from "@/components/ui/skeleton";

export default function RealmsPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: realms = [], isLoading } = useQuery({
    queryKey: ["realms"],
    queryFn: () => realmsApi.list().then(r => r.data.results || []),
    enabled: !!user,
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{t("realms.title")}</h1>
        <p className="text-ink-subtle mt-1">{t("realms.subtitle")}</p>
      </div>

      <PageSection title={t("realms.listTitle") || "Realms"} isLoading={isLoading}>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid gap-4">
            {realms.map((realm: any) => (
              <div key={realm.id} className="bg-surface-1 border border-hairline rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{realm.icon || "🏛️"}</span>
                  <div>
                    <h3 className="font-semibold text-ink">{realm.name_en}</h3>
                    <p className="text-sm text-ink-subtle">{realm.name_zh || realm.name_en}</p>
                  </div>
                  <span className={`ml-auto px-2 py-1 rounded text-xs font-medium ${
                    realm.realm_type === 'HELL' ? 'bg-red-500/20 text-red-400' :
                    realm.realm_type === 'BLISS' ? 'bg-green-500/20 text-green-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {realm.realm_type}
                  </span>
                </div>
                {realm.description && (
                  <p className="mt-2 text-sm text-ink-muted">{realm.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}