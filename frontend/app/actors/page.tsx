"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { actorsApi, Actor } from "@soulledger/core/api";
import { cn } from "@/lib/utils";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { PageSection } from "@/components/ui/page-section";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Scale } from "lucide-react";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { Collapse } from "@/src/components/ui/Collapse";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { badgeVariants } from "@/src/components/ui/Badge";
import { QueryError } from "@/src/components/ui/PageError";
import { ROW_HOVER } from "@/components/ui/data-table";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

/**
 * Role badges are neutral, the same call `app/users/page.tsx` makes for a user's role: a role is
 * an identity, not a system state, so it does not borrow the feedback colours (spec v3: danger only
 * for errors). They used to — EXECUTOR drew in the error red, JUDGE in accent, the rest in
 * info / success / judging — which made a row of gods read as a row of alerts. The role's name
 * tells them apart. (`statusTokenLayering.test.ts` had this map on its "still on feedback tokens"
 * register, waiting for exactly this decision.)
 */
const ROLE_BADGE_FALLBACK =
  "text-[oklch(var(--color-ink-muted))] border-[oklch(var(--color-ink-muted))]";

/**
 * Badge geometry from `Badge`, colour from the table above.
 *
 * `tone: null` and not a tone name: cva reads `null` as "skip this variant
 * *including* its default", so the base geometry arrives with no fill at all
 * and the caller's own token classes are the only ones present. Passing the
 * fill as `className` over the default `neutral` tone would work too — the
 * repo's `cn` deduplicates arbitrary colours correctly — but it would leave
 * two competing decisions in the class list and one of them silently losing.
 *
 * The geometry is borrowed rather than restated because the `py-0.5` a 12px
 * badge needs is off the spacing rhythm; `eslint.config.mjs` exempts that one
 * class in `Badge.tsx` and nowhere else, which is the same statement as "the
 * badge's height is decided in one file".
 */
function roleBadgeClass(fill: string): string {
  return cn(badgeVariants({ tone: null }), "shrink-0", fill);
}

/**
 * The seat an actor holds on the Forty-Two Assessors of Ma'at, or null for a
 * major god. This is the whole basis of the split on this page: Osiris,
 * Anubis, Thoth and Ma'at are all EGYPTIAN JUDGEs, exactly like the 42, and
 * nothing else on the row tells them apart.
 */
function seatOf(actor: Actor): number | null {
  return typeof actor.assessor_index === "number" ? actor.assessor_index : null;
}

interface CivilizationGroup {
  civ: string;
  /** Actors who hold no seat — the named gods, still laid out flat. */
  principals: Actor[];
  /** The bench, in the order the papyrus seats it. */
  bench: Actor[];
}

/**
 * One actor as a ledger row (规范 v1 §2). `data-actor-card` keeps its old name
 * because it is the test anchor, not a description of the shape: the row is
 * still the unit that carries name, role and seat together.
 *
 * No detail route exists for an actor, so the row is not a link.
 */
function ActorRow({ actor, seatLabel }: { actor: Actor; seatLabel?: string }) {
  return (
    <tr
      data-actor-card={actor.name}
      className={`h-(--table-row-h) border-b border-[oklch(var(--color-rule))] ${ROW_HOVER} transition-colors`}
    >
      <td className="px-4 py-2">
        {/* `display_name` and `display_title` are localized by the backend
            and are in this very response. `name_zh`, `title` and
            `description` are NOT on `ActorListSerializer` -- they live on the
            detail and localized serializers. So every one of the 130 cards
            rendered its title as MissingValue「未记载」while the localized
            title sat unread in the same payload.

            `icon` is not a field on ANY actor serializer either (the model
            column is `icon_url`, empty on all 130 rows), so no icon column. */}
        <div className="font-medium text-[oklch(var(--color-ink))]">{actor.name}</div>
        <div className="text-xs text-[oklch(var(--color-ink-subtle))]">
          {actor.display_name || actor.name}
          {" · "}
          <DomainText value={actor.display_title} />
        </div>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {/* The raw member reaches `title` and never the text node — the
              component carries the attribute itself. */}
          <DomainEnum
            namespace="actors.roles"
            value={actor.role}
            className={roleBadgeClass(ROLE_BADGE_FALLBACK)}
          />
          {seatLabel && (
            <span className={cn(roleBadgeClass(ROLE_BADGE_FALLBACK), "tabular-nums")}>
              {seatLabel}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

/** The table a group of actor rows sits in: mono 2xs header over the block line. */
function ActorTable({ children, ...rest }: { children: React.ReactNode } & React.HTMLAttributes<HTMLTableElement>) {
  const { t } = useI18n();
  return (
    <table className="w-full text-sm" {...rest}>
      <thead className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
        <tr className="h-(--control-h-sm) border-b-2 border-[oklch(var(--color-ink))]">
          <th scope="col" className="px-3 py-2 text-left font-normal">{t("menus.name")}</th>
          <th scope="col" className="px-3 py-2 text-right font-normal">{t("users.role")}</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function ActorsPageContent() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
  const { user } = useTenant();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /**
   * The bench starts CLOSED, and that is the point of this state living apart
   * from `collapsed`. Egypt is 46 JUDGEs since the Forty-Two landed; folding
   * them behind one row is what keeps the first paint at a readable handful of
   * named gods instead of fifty-one identical cards.
   */
  const [benchOpen, setBenchOpen] = useState<Record<string, boolean>>({});

  const { data: actors = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["actors"],
    queryFn: () => actorsApi.list().then(r => r.data.results || []),
    enabled: !!user,
  });

  const groups: CivilizationGroup[] = useMemo(() => {
    const byCiv = new Map<string, CivilizationGroup>();
    for (const actor of actors) {
      const civ = actor.civilization || "UNKNOWN";
      let group = byCiv.get(civ);
      if (!group) {
        group = { civ, principals: [], bench: [] };
        byCiv.set(civ, group);
      }
      (seatOf(actor) === null ? group.principals : group.bench).push(actor);
    }
    // Seat order, NOT name order. The two genuinely differ — Aati is 17th in
    // the Papyrus of Nebseni and 1st in the alphabet — so an alphabetical
    // bench would look entirely plausible and be wrong.
    for (const group of byCiv.values()) {
      group.bench.sort((a, b) => (seatOf(a) ?? 0) - (seatOf(b) ?? 0));
    }
    return [...byCiv.values()];
  }, [actors]);

  const toggleCollapse = (civ: string) => {
    setCollapsed(prev => ({ ...prev, [civ]: !prev[civ] }));
  };

  const toggleBench = (civ: string) => {
    setBenchOpen(prev => ({ ...prev, [civ]: !prev[civ] }));
  };

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("actors.title")}
          <MenuGloss path="/actors" />
        </>
      }
      subtitle={t("actors.subtitle")}
    >
      <PageSection title={t("actors.section.actors")}>
        {/* A failed request used to fall through to the empty state, so
            "the server is down" and "there is nothing here" read the same. */}
        {isError ? (
          <QueryError onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <Skeleton key={i} className="h-(--table-row-h) w-full" />
            ))}
          </div>
        ) : actors.length === 0 ? (
          /* The third state. Error and loading were both handled; a query that
             SUCCEEDS with zero rows rendered a heading over blank space and
             said nothing at all. "Nothing is here" is a fact about the data
             and deserves a sentence, the same as the other two. */
          <EmptyState title={t("actors.section.actors")} reason={t("actors.no_actors")} />
        ) : (
          /* 顶层区块之间的节奏跟着壳的 `density` 走,而这一页的 `<PageShell>`
             没写 density —— 也就是默认的 `"table"`,对应 `space-y-6`。这里此前是
             `space-y-10`(文档档的值),那是四个文明区之间凭手感撑开的 40px,
             和壳声明的密度对不上。规矩与理由写在
             `src/components/ui/PageShell.tsx` 的 `density` 一槽,
             `src/__tests__/PageShell.test.tsx` 有一条扫源码的守卫盯着它。 */
          <div className="space-y-6">
            {groups.map(({ civ, principals, bench }) => {
              const isCollapsed = collapsed[civ];
              const isBenchOpen = benchOpen[civ];
              const total = principals.length + bench.length;

              return (
                <div
                  key={civ}
                  /* `data-civilization` is a test anchor. No colour: 规范 v1 §1.8 took
                     civilization out of the colour layer — the section header names it. */
                  data-civilization={civ}
                  className="border-t border-[oklch(var(--color-block))] first:border-t-0"
                >
                  {/* 文明 = 面板里的分组标题(列表行标题一档)+ 件数注记。v2 节首的匾纹片段随
                      v3 撤掉(2026-10-03),文明由节名本身标明。
                      此前是 <button> 里包 <h2> —— 标题进按钮是无效 HTML(按钮只收短语内容),
                      读屏也只念出一个按钮。现在反过来:<h2> 里放折叠钮(披露模式)。 */}
                  {/* 节首吸顶(Design 第三批):收起时节首不动,下面的节往上收。 */}
                  <div className="sticky top-(--below-band) z-1 pt-3 mb-3 flex items-center gap-3 bg-[oklch(var(--color-surface-1))]">
                    <h2 className="text-sm font-medium text-[oklch(var(--color-ink))]">
                      <button
                        type="button"
                        onClick={() => toggleCollapse(civ)}
                        aria-expanded={!isCollapsed}
                        aria-controls={`actors-civ-${civ}`}
                        className="inline-flex items-center gap-2 text-left hover:underline underline-offset-2"
                      >
                        <DomainEnum namespace="actors.civilizations" value={civ} />
                        <ChevronDown aria-hidden="true" className={`w-4 h-4 text-[oklch(var(--color-ink-muted))] transition-transform duration-fast ease-standard ${isCollapsed ? "-rotate-90" : ""}`} />
                      </button>
                    </h2>
                    <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                      {t("actors.count", { count: String(total) })}
                    </span>
                  </div>

                  <Collapse
                    open={!isCollapsed}
                    id={`actors-civ-${civ}`}
                    rows={principals.length + (isBenchOpen ? bench.length : Math.min(bench.length, 1))}
                  >
                    <div className="space-y-4">
                      {/* Named gods, flat */}
                      {principals.length > 0 && (
                        <ActorTable data-principals={civ}>
                          {principals.map((actor) => (
                            <ActorRow key={actor.id} actor={actor} />
                          ))}
                        </ActorTable>
                      )}

                      {/* The bench of forty-two, folded behind one row */}
                      {bench.length > 0 && (
                        <div data-bench={civ}>
                          <button
                            onClick={() => toggleBench(civ)}
                            aria-expanded={!!isBenchOpen}
                            aria-controls={`actors-bench-${civ}`}
                            aria-label={t("actors.assessors.toggle")}
                            className="w-full min-h-(--table-row-h) flex items-center gap-3 px-4 py-2 border-b border-[oklch(var(--color-rule))] hover:bg-[oklch(var(--color-surface-2))] transition-colors text-left"
                          >
                            <Scale aria-hidden="true" className="w-5 h-5 text-[oklch(var(--color-ink-subtle))] shrink-0" />
                            <div className="flex-1 min-w-0">
                              {/* span,不是 <h3>:这是表内小分组的折叠行(不用分节标题),而且标题不能进按钮。 */}
                              <span className="block text-sm font-semibold text-[oklch(var(--color-ink))] truncate">
                                {t("actors.assessors.title")}
                              </span>
                            </div>
                            <span className={cn(roleBadgeClass(ROLE_BADGE_FALLBACK), "tabular-nums")}>
                              {t("actors.assessors.count", { count: String(bench.length) })}
                            </span>
                            <ChevronDown className={`w-4 h-4 text-[oklch(var(--color-ink-muted))] transition-transform ${isBenchOpen ? "" : "-rotate-90"}`} />
                          </button>

                          <Collapse open={!!isBenchOpen} id={`actors-bench-${civ}`}>
                            <ActorTable>
                              {bench.map((actor) => (
                                <ActorRow
                                  key={actor.id}
                                  actor={actor}
                                  seatLabel={t("actors.assessors.seat", { index: String(seatOf(actor)) })}
                                />
                              ))}
                            </ActorTable>
                          </Collapse>
                        </div>
                      )}
                    </div>
                  </Collapse>
                </div>
              );
            })}
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}


/* 页级门。**后端才是正解,这里是纵深** —— `apps/actors/views.py` 已经挂了
   `CodenamePermission`,这道门挡不住任何直接打接口的人。它挡的是另一件事:
   在补上后端之前,VIEWER 直接输 URL 就能打开一个功能完整的页面并拿到数据,
   而侧边栏的菜单过滤**只藏链接、不挡路由**。三个页面 grep
   `RequirePermission|hasPermission` 都是零命中 —— 前端没有掩盖后端的洞,
   洞是直接可点的。

   `fallback={<PermissionDenied />}` 而不是渲染空白:一个没有权限的人应当看到
   「你没有这个权限」,而不是一个看起来加载失败的页面。 */
export default function ActorsPage() {
  return (
    <RequirePermission permissions="actors.read" fallback={<PermissionDenied />}>
      <ActorsPageContent />
    </RequirePermission>
  );
}
