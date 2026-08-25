"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { actorsApi, Actor } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";

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
  // Hades, Aeacus, Rhadamanthus and Plato's Minos are GREEK since realms/0018.
  GREEK: "🏛",
};

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
};
const ROLE_BADGE_FALLBACK =
  "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] border-[hsl(var(--color-hairline-tertiary))]";
const BADGE_SHAPE = "px-2 py-0.5 rounded border text-xs shrink-0";

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
      className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4 hover:border-[hsl(var(--color-accent))]/30 transition-colors"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden="true">{actor.icon || "👤"}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[hsl(var(--color-ink))] truncate">{actor.name}</h3>
          <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{actor.name_zh || actor.name}</p>
          <p className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">
            <DomainText value={actor.title} />
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {/* The raw member reaches `title` and never the text node — the
              component carries the attribute itself. */}
          <DomainEnum
            namespace="actors.roles"
            value={actor.role}
            className={`${BADGE_SHAPE} ${ROLE_BADGE_CLASSES[actor.role] ?? ROLE_BADGE_FALLBACK}`}
          />
          {seatLabel && (
            <span className={`${BADGE_SHAPE} font-mono tabular-nums ${ROLE_BADGE_FALLBACK}`}>
              {seatLabel}
            </span>
          )}
        </div>
      </div>
      {actor.description && (
        <p className="mt-2 text-sm text-[hsl(var(--color-ink-muted))] line-clamp-2">{actor.description}</p>
      )}
    </div>
  );
}

export default function ActorsPage() {
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

  const { data: actors = [], isLoading } = useQuery({
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
    <div className="p-6">
      {/* Page header - realms style */}
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[hsl(var(--color-accent-ink))]">
          {t("actors.title")}
          <MenuGloss path="/actors" />
        </h1>
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
                    className="w-full flex items-center gap-3 mb-4 px-4 py-3 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg hover:bg-[hsl(var(--color-surface-3))] transition-colors text-left"
                  >
                    <span className="text-2xl" aria-hidden="true">{CIVILIZATION_ICONS[civ] || "🌍"}</span>
                    <div className="flex-1">
                      <h2 className="font-semibold text-[hsl(var(--color-ink))]">
                        <DomainEnum namespace="actors.civilizations" value={civ} />
                      </h2>
                      <p className="text-sm text-[hsl(var(--color-ink-subtle))]">
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
                            className="w-full flex items-center gap-3 px-4 py-2.5 bg-[hsl(var(--color-surface-1))] border border-dashed border-[hsl(var(--color-hairline))] rounded-lg hover:bg-[hsl(var(--color-surface-2))] transition-colors text-left"
                          >
                            <span className="text-xl" aria-hidden="true">⚖️</span>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-semibold text-[hsl(var(--color-ink))] truncate">
                                {t("actors.assessors.title")}
                              </h3>
                            </div>
                            <span className={`${BADGE_SHAPE} font-mono tabular-nums ${ROLE_BADGE_FALLBACK}`}>
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
    </div>
  );
}
