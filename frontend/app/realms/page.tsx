"use client";
import { useQuery } from "@tanstack/react-query";
import { realmsApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";

export default function RealmsPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: realms = [], isLoading } = useQuery({
    queryKey: ["realms"],
    queryFn: () => realmsApi.list().then(r => r.data.results || []),
    enabled: !!user,
  });

  if (isLoading) return <div className="p-6">{t("common.loading")}</div>;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{t("realms.title")}</h1>
        <p className="text-ink-subtle mt-1">{t("realms.subtitle")}</p>
      </div>

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
    </div>
  );
}