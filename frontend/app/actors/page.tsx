"use client";
import { useMemo, useState } from "react";
import { CIVILIZATION_ICONS, CIVILIZATION_ICON_FALLBACK } from "@soulledger/core/config/civilizations";
import { useQuery } from "@tanstack/react-query";
import { actorsApi, Actor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Scale, User } from "lucide-react";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { badgeVariants } from "@/src/components/ui/Badge";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

/**
 * Role badge fills. Every tint is 0.1 — the depth the light-mode
 * `--color-status-*` tokens were re-measured against in 5e580e3, and the cap
 * `src/__tests__/dataGridToneContract.test.ts` holds the shared grid to. A
 * deeper fill here would fail AA against the same ink without changing a
 * single token.
 */
const ROLE_BADGE_CLASSES: Record<string, string> = {
  JUDGE: "bg-[hsl(var(--color-accent)/0.1)] text-[hsl(var(--color-accent-ink))] border-[hsl(var(--color-accent)/0.3)]",
  GUARDIAN: "bg-[hsl(var(--color-status-info)/0.1)] text-[hsl(var(--color-status-info))] border-[hsl(var(--color-status-info)/0.3)]",
  EXECUTOR: "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))] border-[hsl(var(--color-status-error)/0.3)]",
  CONDUIT: "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))] border-[hsl(var(--color-status-success)/0.3)]",
  // OVERSEER was missing — `ActorRole` has five members and all three message
  // bundles carry `actors.roles.OVERSEER`, so the label was right and only the
  // colour fell to the fallback. Hades is an OVERSEER.
  OVERSEER: "bg-[hsl(var(--color-status-judging)/0.1)] text-[hsl(var(--color-status-judging))] border-[hsl(var(--color-status-judging)/0.3)]",
};
const ROLE_BADGE_FALLBACK =
  "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] border-[hsl(var(--color-hairline-tertiary))]";

/**
 * Badge geometry from `Badge`, fill from the table above.
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

function ActorCard({ actor, seatLabel }: { actor: Actor; seatLabel?: string }) {
  return (
    <div
      data-actor-card={actor.name}
      className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 hover:border-[hsl(var(--color-accent))]/30 transition-colors"
    >
      <div className="flex items-start gap-3">
        {/* `icon` is not a field on ANY actor serializer -- the model column is
            `icon_url`, and this expression was always undefined. (All 130 rows
            on the test box have `icon_url` empty too, so nothing visible
            changes; the dead read is removed so the next person does not
            "fix" it by adding an `icon` field.) */}
        <User aria-hidden="true" className="w-6 h-6 text-[hsl(var(--color-ink-subtle))] shrink-0" />
        <div className="flex-1 min-w-0">
          {/* `display_name` and `display_title` are localized by the backend
              and are in this very response. `name_zh`, `title` and
              `description` are NOT on `ActorListSerializer` -- they live on the
              detail and localized serializers. So every one of the 130 cards
              rendered its title as MissingValue「未记载」while the localized
              title sat unread in the same payload, and the second line fell
              back to repeating the English canonical name.

              This is the "a placeholder claims the data is missing while the
              data is present" shape, at 130 cards. */}
          <h3 className="text-04 font-semibold text-[hsl(var(--color-ink))] truncate">{actor.name}</h3>
          <p className="text-03 text-[hsl(var(--color-ink-subtle))]">
            {actor.display_name || actor.name}
          </p>
          <p className="text-02 text-[hsl(var(--color-ink-muted))] mt-1">
            <DomainText value={actor.display_title} />
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {/* The raw member reaches `title` and never the text node — the
              component carries the attribute itself. */}
          <DomainEnum
            namespace="actors.roles"
            value={actor.role}
            className={roleBadgeClass(ROLE_BADGE_CLASSES[actor.role] ?? ROLE_BADGE_FALLBACK)}
          />
          {seatLabel && (
            <span className={cn(roleBadgeClass(ROLE_BADGE_FALLBACK), "font-mono tabular-nums")}>
              {seatLabel}
            </span>
          )}
        </div>
      </div>
      {/* `description` is not on the list serializer either. Removed rather
          than left as a permanently-false condition: a read that can never be
          true reads as "descriptions are optional", which is not what is
          happening -- the list endpoint does not send them at all. */}
    </div>
  );
}

function ActorsPageContent() {
  const { t } = useI18n();
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
      <PageSection title={t("actors.section.actors")} isLoading={isLoading}>
        {/* A failed request used to fall through to the empty state, so
            "the server is down" and "there is nothing here" read the same. */}
        {isError ? (
          <QueryError onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <div key={i} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
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
          <div className="space-y-10">
            {groups.map(({ civ, principals, bench }) => {
              const isCollapsed = collapsed[civ];
              const isBenchOpen = benchOpen[civ];
              const total = principals.length + bench.length;

              return (
                <div key={civ} data-civilization={civ}>
                  {/* Civilization Header */}
                  <button
                    onClick={() => toggleCollapse(civ)}
                    aria-expanded={!isCollapsed}
                    className="w-full flex items-center gap-3 mb-4 px-4 py-3 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-3))] transition-colors text-left"
                  >
                    <span className="text-06" aria-hidden="true">{CIVILIZATION_ICONS[civ] ?? CIVILIZATION_ICON_FALLBACK}</span>
                    <div className="flex-1">
                      <h2 className="text-06 font-semibold text-[hsl(var(--color-ink))]">
                        <DomainEnum namespace="actors.civilizations" value={civ} />
                      </h2>
                      <p className="text-03 text-[hsl(var(--color-ink-subtle))]">
                        {t("actors.count", { count: String(total) })}
                      </p>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-[hsl(var(--color-ink-muted))] transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-4">
                      {/* Named gods, flat */}
                      {principals.length > 0 && (
                        <div data-principals={civ} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {principals.map((actor) => (
                            <ActorCard key={actor.id} actor={actor} />
                          ))}
                        </div>
                      )}

                      {/* The bench of forty-two, folded behind one row */}
                      {bench.length > 0 && (
                        <div data-bench={civ}>
                          <button
                            onClick={() => toggleBench(civ)}
                            aria-expanded={!!isBenchOpen}
                            aria-label={t("actors.assessors.toggle")}
                            className="w-full flex items-center gap-3 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-dashed border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-2))] transition-colors text-left"
                          >
                            <Scale aria-hidden="true" className="w-5 h-5 text-[hsl(var(--color-ink-subtle))] shrink-0" />
                            <div className="flex-1 min-w-0">
                              <h3 className="text-04 font-semibold text-[hsl(var(--color-ink))] truncate">
                                {t("actors.assessors.title")}
                              </h3>
                            </div>
                            <span className={cn(roleBadgeClass(ROLE_BADGE_FALLBACK), "font-mono tabular-nums")}>
                              {t("actors.assessors.count", { count: String(bench.length) })}
                            </span>
                            <ChevronDown className={`w-4 h-4 text-[hsl(var(--color-ink-muted))] transition-transform ${isBenchOpen ? "" : "-rotate-90"}`} />
                          </button>

                          {isBenchOpen && (
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                              {bench.map((actor) => (
                                <ActorCard
                                  key={actor.id}
                                  actor={actor}
                                  seatLabel={t("actors.assessors.seat", { index: String(seatOf(actor)) })}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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
