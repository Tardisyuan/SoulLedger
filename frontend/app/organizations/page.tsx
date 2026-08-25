"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Organization, type PaginatedResponse } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { CardSkeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { MenuGloss } from "@/src/components/layout/MenuGloss";

// organizationsApi.list() (lib/api/organizations.ts) doesn't forward a `page` param and
// this page renders a parent/child tree (buildTree/renderTree below), so a paged view would
// split a node from its children onto different pages and break the tree. Fetch every page
// up front instead — confirmed via curl that `/organizations/` is standard DRF pagination
// (`{count,next,previous,results}`, page_size fixed at 20, `?page_size=` is ignored).
async function fetchAllOrganizations(): Promise<Organization[]> {
  const all: Organization[] = [];
  let page = 1;
  while (true) {
    const res = await api.get<PaginatedResponse<Organization>>("/organizations/", { params: { page } });
    const data = res.data;
    all.push(...data.results);
    if (!data.next) break;
    page += 1;
  }
  return all;
}

// GREEK: 冥界/HADES and 希腊冥界/HADES_GREEK were `category="EUROPEAN"` until
// org/0007 refiled them. Without an entry here the badge renders with no icon
// and no colour, which reads as a tree nobody owns rather than as a missing map.
//
// This map and CATEGORY_COLORS below stay hand-written four-member literals on
// purpose: `src/__tests__/civilizationMapCoverage.test.ts` reads BOTH of them
// out of this file AS TEXT (`const NAME … = {`, two-space keys) and holds their
// key sets against CIVILIZATION_OPTIONS. Deriving them from
// `CIVILIZATION_SHORT_CODES` would read better and would delete the guard —
// the parser throws "Could not find `const CATEGORY_COLORS`" rather than
// checking anything.
const CIVILIZATION_ICONS: Record<string, string> = {
  CHINESE: "🏯",
  EUROPEAN: "⛪",
  // U+132F4 (hieroglyph S029) sat here and rendered as tofu anywhere
  // `Noto Sans Egyptian Hieroglyphs` is absent — measured: it is in none of
  // Apple Color Emoji, Apple Symbols, Arial Unicode or DejaVu Sans. U+26B1 is
  // RGI emoji, so it is in every colour-emoji font; the trailing U+FE0F is
  // load-bearing because DejaVu Sans *does* cover bare U+26B1 and would draw
  // it monochrome next to three colour neighbours.
  EGYPTIAN: "⚱️",
  GREEK: "🏛",
};

/**
 * MOVED OFF RAW HSL, onto the civilization identity tokens.
 *
 * Every value here used to be a literal triple — `bg-[hsl(38,92%,50%,0.2)]`
 * and seven more like it. Two things were wrong with that beyond the spelling.
 * The hues were the CHART palette's (38 amber / 217 blue / 271 purple / 174
 * teal), so a civilization's colour on this page and its colour anywhere else
 * agreed only by coincidence; and a literal triple is one value for two themes,
 * while `--color-civ-mark-*` is measured separately for each (`12 55% 58%` dark
 * against `12 58% 38%` light — the light one darker precisely so it stays
 * legible as text on a light canvas).
 *
 * 38° amber was the worse offender of the four: that is `--color-accent`, the
 * colour of every button and link in the app, standing in for "Chinese".
 *
 * The 10%/20%/40% fill-text-border ladder is Badge's `accent` tone recipe, not
 * a new invention. Feedback tokens (`--color-status-*`) are deliberately absent
 * — `statusTokenLayering.test.ts` polices exactly that for enum-keyed maps like
 * this one, and a civilization is a domain identity, not a system state.
 */
const CATEGORY_COLORS: Record<string, string> = {
  CHINESE: "bg-[hsl(var(--color-civ-mark-cn)/0.2)] text-[hsl(var(--color-civ-mark-cn))] border-[hsl(var(--color-civ-mark-cn)/0.4)]",
  EUROPEAN: "bg-[hsl(var(--color-civ-mark-eu)/0.2)] text-[hsl(var(--color-civ-mark-eu))] border-[hsl(var(--color-civ-mark-eu)/0.4)]",
  EGYPTIAN: "bg-[hsl(var(--color-civ-mark-eg)/0.2)] text-[hsl(var(--color-civ-mark-eg))] border-[hsl(var(--color-civ-mark-eg)/0.4)]",
  GREEK: "bg-[hsl(var(--color-civ-mark-gr)/0.2)] text-[hsl(var(--color-civ-mark-gr))] border-[hsl(var(--color-civ-mark-gr)/0.4)]",
};

export default function OrganizationsPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: organizations = [], isLoading, error } = useQuery({
    queryKey: ["organizations"],
    queryFn: fetchAllOrganizations,
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
      const parentKey = String(org.parent ?? "root");
      if (!tree[parentKey]) tree[parentKey] = [];
      tree[parentKey].push(org);
    });
    // Sort by level and sort
    Object.keys(tree).forEach(key => {
      tree[key].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    });
    return tree;
  };

  const toggleCollapse = (civ: string) => {
    setCollapsed(prev => ({ ...prev, [civ]: !prev[civ] }));
  };

  const renderOrg = (org: Organization, depth: number = 0) => (
    <div
      key={org.id}
      className="flex items-center gap-3 py-2 px-3 hover:bg-surface-2 transition-colors"
      style={{ paddingLeft: `${depth * 20 + 12}px` }}
    >
      <span aria-hidden="true" className="text-05">{depth === 0 ? "🏛️" : depth === 1 ? "⚖️" : "📋"}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-03 font-medium text-ink truncate">{org.name}</h3>
          <Badge className={`shrink-0 ${CATEGORY_COLORS[org.category ?? ""] ?? ""}`}>
            {org.level === 0 ? t("organization.root") : `L${org.level}`}
          </Badge>
        </div>
        <p className="text-02 font-mono text-ink-subtle truncate">{org.code}</p>
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
    <PageShell
      variant="full"
      title={
        <>
          {t("organization.title")}
          <MenuGloss path="/organizations" />
        </>
      }
      subtitle={t("organization.subtitle")}
      isLoading={isLoading}
      skeleton={
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      }
    >
      <div className="space-y-10">
        {Object.entries(grouped).map(([category, orgs]) => {
          const info = { name: t(`organization.civilizations.${category}`) || category, icon: CIVILIZATION_ICONS[category] || "🌍" };
          const isCollapsed = collapsed[category];

          return (
            <div key={category}>
              {/* Category Header */}
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => toggleCollapse(category)}
                className="w-full justify-start mb-4 text-left"
              >
                <span aria-hidden="true" className="text-06">{info.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-06 text-ink truncate">{info.name}</span>
                  <span className="block text-04 text-ink-subtle">{t("organization.organizations_count", { count: String(orgs.length) })}</span>
                </span>
                <ChevronDown aria-hidden="true" className={`w-5 h-5 text-ink-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              </Button>

              {/* Organization Tree */}
              {!isCollapsed && (
                <div className="bg-surface-1 border border-hairline overflow-hidden">
                  {renderTree(orgs, null, 0)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
