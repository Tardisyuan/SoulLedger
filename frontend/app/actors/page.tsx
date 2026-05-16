"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { actorsApi, Actor } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";

const CIVILIZATION_LABELS: Record<string, { name: string; icon: string }> = {
  CHINESE: { name: "中国地府", icon: "🏯" },
  EUROPEAN: { name: "欧洲天堂地狱", icon: "⛪" },
  EGYPTIAN: { name: "埃及冥界", icon: "𓋴" },
};

export default function ActorsPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: actors = [], isLoading } = useQuery({
    queryKey: ["actors"],
    queryFn: () => actorsApi.list().then(r => r.data.results || []),
    enabled: !!user,
  });

  // Group by civilization
  const grouped: Record<string, Actor[]> = actors.reduce((acc: Record<string, Actor[]>, actor: Actor) => {
    const civ = actor.civilization || "UNKNOWN";
    if (!acc[civ]) acc[civ] = [];
    acc[civ].push(actor);
    return acc;
  }, {});

  const toggleCollapse = (civ: string) => {
    setCollapsed(prev => ({ ...prev, [civ]: !prev[civ] }));
  };

  return (
    <div className="p-6">
      {/* Page header - realms style */}
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[hsl(var(--color-accent))]">{t("actors.title")}</h1>
        <p className="text-sm sm:text-base text-[hsl(var(--color-ink-subtle))] mt-1 hidden sm:block">{t("actors.subtitle")}</p>
      </div>

      <PageSection title={t("actors.section.actors")} isLoading={isLoading}>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <div key={i} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-8 w-8" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-6 w-12" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([civ, civActors]: [string, Actor[]]) => {
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
                      <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{civActors.length} actors</p>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-[hsl(var(--color-ink-muted))] transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>

                  {/* Actor Cards Grid */}
                  {!isCollapsed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {civActors.map((actor) => (
                        <div key={actor.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4 hover:border-[hsl(var(--color-accent))]/30 transition-colors">
                          <div className="flex items-start gap-3">
                            <span className="text-2xl">{actor.icon || "👤"}</span>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-[hsl(var(--color-ink))] truncate">{actor.name}</h3>
                              <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{actor.name_zh || actor.name}</p>
                              <p className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">{actor.title || actor.role}</p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs shrink-0 ${
                              actor.role === 'JUDGE' ? 'bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]' :
                              actor.role === 'GUARDIAN' ? 'bg-blue-500/20 text-blue-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>
                              {actor.role}
                            </span>
                          </div>
                          {actor.description && (
                            <p className="mt-2 text-sm text-[hsl(var(--color-ink-muted))] line-clamp-2">{actor.description}</p>
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
