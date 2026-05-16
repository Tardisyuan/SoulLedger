"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { realmsApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { CardSkeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";

const CIVILIZATION_LABELS: Record<string, { name: string; icon: string }> = {
  CHINESE: { name: "中国地府", icon: "🏯" },
  EUROPEAN: { name: "欧洲天堂与地狱", icon: "⛪" },
  EGYPTIAN: { name: "埃及杜阿特", icon: "𓋴" },
};

export default function RealmsPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: realms = [], isLoading } = useQuery({
    queryKey: ["realms"],
    queryFn: () => realmsApi.list().then(r => r.data.results || []),
    enabled: !!user,
  });

  // Group by civilization
  const grouped: Record<string, any[]> = realms.reduce((acc: Record<string, any[]>, realm: any) => {
    const civ = realm.civilization || "UNKNOWN";
    if (!acc[civ]) acc[civ] = [];
    acc[civ].push(realm);
    return acc;
  }, {});

  const toggleCollapse = (civ: string) => {
    setCollapsed(prev => ({ ...prev, [civ]: !prev[civ] }));
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--color-accent))]">{t("realms.title")}</h1>
        <p className="text-[hsl(var(--color-ink-subtle))] mt-1">{t("realms.subtitle")}</p>
      </div>

      <PageSection title={t("realms.listTitle") || "Realms"} isLoading={isLoading}>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([civ, civRealms]: [string, any[]]) => {
              const info = CIVILIZATION_LABELS[civ] || { name: civ, icon: "🌍" };
              const isCollapsed = collapsed[civ];

              return (
                <div key={civ}>
                  {/* Civilization Header */}
                  <button
                    onClick={() => toggleCollapse(civ)}
                    className="w-full flex items-center gap-3 mb-4 px-4 py-3 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg hover:bg-[hsl(var(--color-surface-3))] transition-colors text-left"
                  >
                    <span className="text-2xl">{info.icon}</span>
                    <div className="flex-1">
                      <h2 className="font-semibold text-[hsl(var(--color-ink))]">{info.name}</h2>
                      <p className="text-sm text-[hsl(var(--color-ink))]-subtle">{civRealms.length} realms</p>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-[hsl(var(--color-ink))]-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>

                  {/* Realm Cards Grid - responsive 4/3/2/1 */}
                  {!isCollapsed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {(civRealms as any[]).map((realm) => (
                        <div key={realm.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4 hover:border-[hsl(var(--color-accent))]/30 transition-colors">
                          <div className="flex items-start gap-3">
                            <span className="text-xl">{realm.icon || "🏛️"}</span>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-[hsl(var(--color-ink))] truncate">{realm.name_en}</h3>
                              <p className="text-sm text-[hsl(var(--color-ink))]-subtle truncate">{realm.name_zh || realm.name_en}</p>
                            </div>
                            <span className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${
                              realm.realm_type === 'HELL' ? 'bg-red-500/20 text-red-400' :
                              realm.realm_type === 'BLISS' ? 'bg-green-500/20 text-green-400' :
                              'bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]'
                            }`}>
                              {realm.realm_type}
                            </span>
                          </div>
                          {realm.description && (
                            <p className="mt-2 text-sm text-[hsl(var(--color-ink))]-muted line-clamp-2">{realm.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PageSection>
    </div>
  );
}