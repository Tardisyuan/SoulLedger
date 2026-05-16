"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { realmsApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { CardSkeleton } from "@/components/ui/skeleton";
import { ChevronDown, Castle, Cloud, Flame, CircleDot } from "lucide-react";

const CIVILIZATION_CONFIG: Record<string, { nameKey: string; icon: React.ReactNode }> = {
  CHINESE: { nameKey: "realms.civilizations.CHINESE", icon: <Castle className="w-6 h-6" /> },
  EUROPEAN: { nameKey: "realms.civilizations.EUROPEAN", icon: <Cloud className="w-6 h-6" /> },
  EGYPTIAN: { nameKey: "realms.civilizations.EGYPTIAN", icon: <CircleDot className="w-6 h-6" /> },
};

const REALM_TYPE_CONFIG: Record<string, { icon: React.ReactNode; className: string }> = {
  HELL: { icon: <Flame className="w-4 h-4" />, className: 'bg-red-500/10 border-red-500/30 text-red-400' },
  PURGATORY: { icon: <Cloud className="w-4 h-4" />, className: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  BLISS: { icon: <CircleDot className="w-4 h-4" />, className: 'bg-green-500/10 border-green-500/30 text-green-400' },
  NEUTRAL: { icon: <Castle className="w-4 h-4" />, className: 'bg-[hsl(var(--color-accent))]/10 border-[hsl(var(--color-accent))]/30 text-[hsl(var(--color-accent))]' },
};

export default function RealmsPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: realms = [], isLoading } = useQuery({
    queryKey: ["realms", user?.tenant?.code, user?.role],
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
            {Object.entries(grouped).map(([civ, civRealms]) => {
              const config = CIVILIZATION_CONFIG[civ] || { nameKey: `realms.civilizations.${civ}`, icon: <Castle className="w-6 h-6" /> };
              const isCollapsed = collapsed[civ];

              return (
                <div key={civ}>
                  <button
                    onClick={() => toggleCollapse(civ)}
                    className="w-full flex items-center gap-3 mb-4 px-4 py-3 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg hover:bg-[hsl(var(--color-surface-3))] transition-colors text-left"
                  >
                    <span className="text-[hsl(var(--color-ink-muted))]">{config.icon}</span>
                    <div className="flex-1">
                      <h2 className="font-semibold text-[hsl(var(--color-ink))]">{t(config.nameKey)}</h2>
                      <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{civRealms.length} {t("realms.count")}</p>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-[hsl(var(--color-ink-muted))] transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>

                  {!isCollapsed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {civRealms.map((realm) => {
                        const typeConfig = REALM_TYPE_CONFIG[realm.realm_type] || REALM_TYPE_CONFIG.NEUTRAL;
                        return (
                          <div key={realm.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4 hover:border-[hsl(var(--color-accent))]/50 hover:bg-[hsl(var(--color-surface-2))] transition-colors">
                            <div className="flex items-start gap-3">
                              <div className="text-[hsl(var(--color-ink-muted))]">{typeConfig.icon}</div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-[hsl(var(--color-ink))] truncate">{t(`realms.names.${realm.realm_code}`, realm.name_en)}</h3>
                                <p className="text-sm text-[hsl(var(--color-ink-tertiary))] truncate">{t(`realms.codes.${realm.realm_code}`, realm.name_local)}</p>
                              </div>
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                              <span className={`px-2 py-1 rounded text-xs font-medium border flex items-center gap-1 ${typeConfig.className}`}>
                                {typeConfig.icon}
                                {t(`realms.types.${realm.realm_type}`)}
                              </span>
                            </div>
                            {realm.description && (
                              <p className="mt-2 text-sm text-[hsl(var(--color-ink-muted))] line-clamp-2">{realm.description}</p>
                            )}
                          </div>
                        );
                      })}
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
