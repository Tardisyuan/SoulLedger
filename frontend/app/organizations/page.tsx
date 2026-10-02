"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Organization, type PaginatedResponse } from "@soulledger/core/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";
import { TreeName, flattenTree } from "@/src/components/ui/TreeRow";
import { PageShell } from "@/src/components/ui/PageShell";
import { Collapse } from "@/src/components/ui/Collapse";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Badge } from "@/src/components/ui/Badge";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { ROW_HOVER } from "@/components/ui/data-table";

// organizationsApi.list() (lib/api/organizations.ts) doesn't forward a `page` param and
// this page renders a parent/child tree (flattenTree/renderTable below), so a paged view would
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
 * a badge here is `text-xs`, 12px, needing 4.5:1. Drawn at the mark's own
 * lightness on `mark/0.2`, four of the eight civilization x theme combinations
 * failed on the surfaces this page actually uses — cn 3.93 / eu 3.92 dark,
 * eg 3.58 / gr 3.64 light. The fill and the border keep the mark; only the
 * glyphs moved. Feedback tokens (`--color-status-*`) are deliberately absent
 * — `statusTokenLayering.test.ts` polices exactly that for enum-keyed maps like
 * this one, and a civilization is a domain identity, not a system state.
 */
const CATEGORY_COLORS: Record<string, string> = {
  CHINESE: "text-[oklch(var(--color-ink-muted))] border-[oklch(var(--color-line))]",
  EUROPEAN: "text-[oklch(var(--color-ink-muted))] border-[oklch(var(--color-line))]",
  EGYPTIAN: "text-[oklch(var(--color-ink-muted))] border-[oklch(var(--color-line))]",
  GREEK: "text-[oklch(var(--color-ink-muted))] border-[oklch(var(--color-line))]",
};

function OrganizationsPageContent() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
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

  const toggleCollapse = (civ: string) => {
    setCollapsed(prev => ({ ...prev, [civ]: !prev[civ] }));
  };

  /* 账页(规范 v1 §2):树不再装在卡片框里,而是一张表 —— 表头 11 px 等宽,
     下接区块边界,行与行之间是行线。层级靠名称列的缩进和 └ 肘线说,不靠框。
     机构没有详情路由,所以不是整行链接。 */
  const renderTable = (orgs: Organization[]) => (
    <table className="w-full text-sm">
      <thead className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
        <tr className="h-(--control-h-sm) border-b-2 border-[oklch(var(--color-ink))]">
          <th scope="col" className="px-3 py-2 text-left font-normal">{t("menus.name")}</th>
          <th scope="col" className="px-3 py-2 text-left font-normal">{t("tenants.code")}</th>
        </tr>
      </thead>
      <tbody>
        {/* 树表行(第三类 B 组):层级由缩进加 └ 肘线说,三枚按深度换的 lucide
            图标一起去掉 —— 它们说的是同一件事,而肘线还说清了「挂在谁下面」。
            兄弟按 `sort` 排,与改动前一致。 */}
        {flattenTree(
          [...orgs].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
          (o) => o.id,
          (o) => o.parent,
        ).map(({ item: org, depth }) => (
          <tr key={org.id} className={`h-(--table-row-h) border-b border-[oklch(var(--color-rule))] ${ROW_HOVER} transition-colors`}>
            <td className="py-2 px-3">
              <TreeName depth={depth}>
                <span className={depth ? "text-[oklch(var(--color-ink-muted))]" : "font-medium text-[oklch(var(--color-ink))]"}>{org.name}</span>
                <Badge className={`shrink-0 ${CATEGORY_COLORS[org.category ?? ""] ?? ""}`}>
                  {org.level === 0 ? t("organization.root") : `L${org.level}`}
                </Badge>
              </TreeName>
            </td>
            <td className="px-3 py-2 font-mono text-xs text-[oklch(var(--color-ink-muted))]">{org.code}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

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
      skeleton={<OrganizationsSkeleton />}
    >
      {/* Worse than its siblings: no empty state either, so a failed request
          rendered a heading and literally nothing else -- `Object.entries({})`
          over zero groups. And `fetchAllOrganizations` pages with `while
          (true)`, so one failed page fails the whole query. */}
      {isError && <QueryError onRetry={() => refetch()} />}
      {/* The third state. `Object.entries({})` over zero groups renders
          nothing, so a successful query with no rows produced a heading and
          blank space — the case `PageError.tsx:59` already recorded about this
          page ("organizations was worse still: no empty state either") and
          which that round fixed only the error half of.

          `organization.`, singular — the namespace the rest of this page reads.
          The title said `organizations.title`, a key in no bundle, so the empty
          state's title rendered as that raw key (DF-01). */}
      {!isLoading && !isError && organizations.length === 0 && (
        <EmptyState title={t("organization.title")} reason={t("organization.no_organizations")} />
      )}
      <div className="space-y-6">
        {Object.entries(grouped).map(([category, orgs]) => {
          const name = t(`organization.civilizations.${category}`) || category;
          const isCollapsed = collapsed[category];

          return (
            <section key={category}>
              {/* 每个文明一节 = v3 面板标题(与 `components/ui/page-section.tsx` 同一档)+ 件数注记。
                  v2 节首的匾纹片段随 v3 撤掉(2026-10-03),文明由节名本身标明。
                  折叠钮放在 <h2> 里面(披露模式),不是反过来 —— <button> 的内容只能是
                  短语内容,标题进按钮是无效 HTML。 */}
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-lg text-[oklch(var(--color-ink))]">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(category)}
                    aria-expanded={!isCollapsed}
                    aria-controls={`organizations-${category}`}
                    className="inline-flex items-center gap-2 text-left hover:underline underline-offset-2"
                  >
                    {name}
                    <ChevronDown aria-hidden="true" className={`w-4 h-4 text-[oklch(var(--color-ink-muted))] transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>
                </h2>
                <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                  {t("organization.organizations_count", { count: String(orgs.length) })}
                </span>
              </div>

              <Collapse open={!isCollapsed} id={`organizations-${category}`} rows={orgs.length}>
                <div className="overflow-x-auto">{renderTable(orgs)}</div>
              </Collapse>
            </section>
          );
        })}
      </div>
    </PageShell>
  );
}


/** 骨架(补足 C15「静态,不闪光」;表格是表头 + 3 行):一节分节标题、表头、三行,与真表同高。 */
function OrganizationsSkeleton() {
  return (
    <div data-testid="organizations-skeleton" aria-busy="true" className="space-y-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-(--control-h-sm) w-full" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-(--table-row-h) w-full" />
      ))}
    </div>
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
