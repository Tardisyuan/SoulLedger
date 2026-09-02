"use client";
import { useState } from "react";
import { CIVILIZATION_ICONS, CIVILIZATION_ICON_FALLBACK } from "@soulledger/core/config/civilizations";
import { useQuery } from "@tanstack/react-query";
import { api, type Organization, type PaginatedResponse } from "@soulledger/core/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { CardSkeleton } from "@/components/ui/skeleton";
import { ChevronDown, ClipboardList, Landmark, Scale } from "lucide-react";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

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
 * The 10%/20%/40% fill-text-border ladder is Badge's `accent` tone recipe, and
 * the foreground is now `--color-civ-ink-*`, not `--color-civ-mark-*`. That was
 * the half of the recipe this map had missed: `accent`'s own comment says "the
 * foreground is --color-accent-ink, NOT --color-accent ... a badge is text", and
 * a badge here is `text-02`, 12px, needing 4.5:1. Drawn at the mark's own
 * lightness on `mark/0.2`, four of the eight civilization x theme combinations
 * failed on the surfaces this page actually uses — cn 3.93 / eu 3.92 dark,
 * eg 3.58 / gr 3.64 light. The fill and the border keep the mark; only the
 * glyphs moved. Feedback tokens (`--color-status-*`) are deliberately absent
 * — `statusTokenLayering.test.ts` polices exactly that for enum-keyed maps like
 * this one, and a civilization is a domain identity, not a system state.
 */
const CATEGORY_COLORS: Record<string, string> = {
  CHINESE: "bg-[hsl(var(--color-civ-mark-cn)/0.2)] text-[hsl(var(--color-civ-ink-cn))] border-[hsl(var(--color-civ-mark-cn)/0.4)]",
  EUROPEAN: "bg-[hsl(var(--color-civ-mark-eu)/0.2)] text-[hsl(var(--color-civ-ink-eu))] border-[hsl(var(--color-civ-mark-eu)/0.4)]",
  EGYPTIAN: "bg-[hsl(var(--color-civ-mark-eg)/0.2)] text-[hsl(var(--color-civ-ink-eg))] border-[hsl(var(--color-civ-mark-eg)/0.4)]",
  GREEK: "bg-[hsl(var(--color-civ-mark-gr)/0.2)] text-[hsl(var(--color-civ-ink-gr))] border-[hsl(var(--color-civ-mark-gr)/0.4)]",
};

function OrganizationsPageContent() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: organizations = [], isLoading, isError, refetch } = useQuery({
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
      className="flex items-center gap-3 py-2 px-3 hover:bg-[hsl(var(--color-surface-2))] transition-colors"
      style={{ paddingLeft: `${depth * 20 + 12}px` }}
    >
      {/* lucide, not emoji. The CIVILIZATION_ICONS map above stays emoji on
          purpose — those are identity marks carrying measured font-coverage
          reasoning. These three are chrome: OS-rendered glyphs beside a
          controlled three-family type system, drawn differently on every
          platform. */}
      <span aria-hidden="true" className="text-[hsl(var(--color-ink-subtle))] shrink-0">
        {depth === 0 ? (
          <Landmark className="w-5 h-5" />
        ) : depth === 1 ? (
          <Scale className="w-5 h-5" />
        ) : (
          <ClipboardList className="w-5 h-5" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-03 font-medium text-[hsl(var(--color-ink))] truncate">{org.name}</h3>
          <Badge className={`shrink-0 ${CATEGORY_COLORS[org.category ?? ""] ?? ""}`}>
            {org.level === 0 ? t("organization.root") : `L${org.level}`}
          </Badge>
        </div>
        <p className="text-02 font-mono text-[hsl(var(--color-ink-subtle))] truncate">{org.code}</p>
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
      {/* Worse than its siblings: no empty state either, so a failed request
          rendered a heading and literally nothing else -- `Object.entries({})`
          over zero groups. And `fetchAllOrganizations` pages with `while
          (true)`, so one failed page fails the whole query. */}
      {isError && <QueryError onRetry={() => refetch()} />}
      <div className="space-y-10">
        {Object.entries(grouped).map(([category, orgs]) => {
          const info = { name: t(`organization.civilizations.${category}`) || category, icon: CIVILIZATION_ICONS[category] ?? CIVILIZATION_ICON_FALLBACK };
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
                  <span className="block text-06 text-[hsl(var(--color-ink))] truncate">{info.name}</span>
                  <span className="block text-04 text-[hsl(var(--color-ink-subtle))]">{t("organization.organizations_count", { count: String(orgs.length) })}</span>
                </span>
                <ChevronDown aria-hidden="true" className={`w-5 h-5 text-[hsl(var(--color-ink-muted))] transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              </Button>

              {/* Organization Tree */}
              {!isCollapsed && (
                <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] overflow-hidden">
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


/* 页级门。后端才是正解(这几个 viewset 都挂了 `CodenamePermission`),这里是纵深:
   侧边栏的菜单过滤**只藏链接、不挡路由**,所以在补上这道门之前,直接输 URL 就能
   打开一个功能完整的页面。码名与后端 `permission_codename` 对齐,不是猜的角色名 ——
   `tests/test_page_gates_match_the_backend.py` 会因为路由没有门而红。 */
export default function OrganizationsPage() {
  return (
    <RequirePermission permissions="org.read" fallback={<PermissionDenied />}>
      <OrganizationsPageContent />
    </RequirePermission>
  );
}
