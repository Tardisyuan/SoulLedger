"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { organizationsApi, type Organization } from "@/lib/api";
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

const CATEGORY_COLORS: Record<string, string> = {
  CHINESE: "bg-[hsl(38,92%,50%,0.2)] text-[hsl(38,92%,50%)]",
  EUROPEAN: "bg-[hsl(217,91%,52%,0.2)] text-[hsl(217,91%,52%)]",
  EGYPTIAN: "bg-[hsl(271,81%,56%,0.2)] text-[hsl(271,81%,56%)]",
};

export default function OrganizationsPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: organizations = [], isLoading } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => organizationsApi.list().then(r => r.data as Organization[]),
    enabled: !!user,
  });

  // Group by category (civilization)
  const grouped: Record<string, Organization[]> = organizations.reduce((acc, org) => {
    const category = org.category || "UNKNOWN";
    if (!acc[category]) acc[category] = [];
    acc[category].push(org);
    return acc;
  }, {} as Record<string, Organization[]>);

  // Build tree structure for display
  const buildTree = (orgs: Organization[]): Record<string, Organization[]> => {
    const tree: Record<string, Organization[]> = {};
    orgs.forEach(org => {
      const parentKey = String(org.parent_id ?? "root");
      if (!tree[parentKey]) tree[parentKey] = [];
      tree[parentKey].push(org);
    });
    // Sort by level and sort
    Object.keys(tree).forEach(key => {
      tree[key].sort((a, b) => a.sort ?? a.level - (b.sort ?? b.level));
    });
    return tree;
  };

  const toggleCollapse = (civ: string) => {
    setCollapsed(prev => ({ ...prev, [civ]: !prev[civ] }));
  };

  const renderOrg = (org: Organization, depth: number = 0) => (
    <div
      key={org.id}
      className="flex items-center gap-3 py-2 px-3 hover:bg-[hsl(var(--color-surface-2))] rounded transition-colors"
      style={{ paddingLeft: `${depth * 20 + 12}px` }}
    >
      <span className="text-lg">{depth === 0 ? "🏛️" : depth === 1 ? "⚖️" : "📋"}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-[hsl(var(--color-ink))] truncate">{org.name}</h4>
          <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[org.category] || "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]"}`}>
            {org.level === 0 ? "根" : `L${org.level}`}
          </span>
        </div>
        <p className="text-sm text-[hsl(var(--color-ink-subtle))] truncate">{org.code}</p>
      </div>
    </div>
  );

  const renderTree = (orgs: Organization[], parentId: number | null, depth: number): React.ReactNode => {
    const tree = buildTree(orgs);
    const parentKey = String(parentId ?? "root");
    const children = tree[parentKey] || [];
    return children.map(org => (
      <div key={org.id}>
        {renderOrg(org, depth)}
        {renderTree(orgs, org.id, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--color-accent))]">{t("organization.title")}</h1>
        <p className="text-[hsl(var(--color-ink-subtle))] mt-1">{t("organization.subtitle")}</p>
      </div>

      <PageSection title={t("organization.listTitle") || "Organizations"} isLoading={isLoading}>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([category, orgs]) => {
              const info = CIVILIZATION_LABELS[category] || { name: category, icon: "🌍" };
              const isCollapsed = collapsed[category];

              return (
                <div key={category}>
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCollapse(category)}
                    className="w-full flex items-center gap-3 mb-4 px-4 py-3 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg hover:bg-[hsl(var(--color-surface-3))] transition-colors text-left"
                  >
                    <span className="text-2xl">{info.icon}</span>
                    <div className="flex-1">
                      <h2 className="font-semibold text-[hsl(var(--color-ink))]">{info.name}</h2>
                      <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{orgs.length} organizations</p>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-[hsl(var(--color-ink-muted))] transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>

                  {/* Organization Tree */}
                  {!isCollapsed && (
                    <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg overflow-hidden">
                      {renderTree(orgs, null, 0)}
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
