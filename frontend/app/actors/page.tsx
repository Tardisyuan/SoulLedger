"use client";
import { useQuery } from "@tanstack/react-query";
import { actorsApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";

export default function ActorsPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: actors = [], isLoading } = useQuery({
    queryKey: ["actors"],
    queryFn: () => actorsApi.list().then(r => r.data.results || []),
    enabled: !!user,
  });

  if (isLoading) return <div className="p-6">{t("common.loading")}</div>;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{t("actors.title")}</h1>
        <p className="text-ink-subtle mt-1">{t("actors.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {actors.map((actor: any) => (
          <div key={actor.id} className="bg-surface-1 border border-hairline rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{actor.icon || "👤"}</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-ink truncate">{actor.name}</h3>
                <p className="text-sm text-ink-subtle">{actor.name_zh || actor.name}</p>
                <p className="text-xs text-ink-muted mt-1">{actor.title || actor.role}</p>
              </div>
              <span className={`px-2 py-1 rounded text-xs ${
                actor.role === 'JUDGE' ? 'bg-amber-500/20 text-amber-400' :
                actor.role === 'GUARDIAN' ? 'bg-blue-500/20 text-blue-400' :
                'bg-gray-500/20 text-gray-400'
              }`}>
                {actor.role}
              </span>
            </div>
            {actor.description && (
              <p className="mt-2 text-sm text-ink-muted line-clamp-2">{actor.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}