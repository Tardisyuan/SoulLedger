"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { realmsApi, type Realm } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { CardSkeleton } from "@/components/ui/skeleton";
import { ChevronDown, Castle, Cloud, Flame, CircleDot, Columns } from "lucide-react";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { QueryError } from "@/src/components/ui/PageError";

const CIVILIZATION_CONFIG: Record<string, { nameKey: string; icon: React.ReactNode }> = {
  CHINESE: { nameKey: "realms.civilizations.CHINESE", icon: <Castle className="w-6 h-6" /> },
  EUROPEAN: { nameKey: "realms.civilizations.EUROPEAN", icon: <Cloud className="w-6 h-6" /> },
  EGYPTIAN: { nameKey: "realms.civilizations.EGYPTIAN", icon: <CircleDot className="w-6 h-6" /> },
  // The fork in the road, the Isles of the Blessed and Tartarus. Without an
  // entry the whole GREEK group renders headerless — the realms are fetched and
  // then grouped by a config that does not know the key.
  GREEK: { nameKey: "realms.civilizations.GREEK", icon: <Columns className="w-6 h-6" /> },
};

/**
 * The realm-type badge, drawn from the VERDICT palette — the domain layer —
 * rather than the system-feedback one it used to borrow.
 *
 * HELL/PURGATORY/BLISS were on --color-status-error/-info/-success, which
 * app/globals.css disallows in as many words on the block that declares them:
 * "System-layer feedback: transient chrome only (toast, inline validation,
 * banner), always beside an icon — never a row, a badge or a chart." A badge is
 * the named counter-example, and the rule lived only in that comment.
 *
 * NOTHING ON SCREEN MOVES FOR THOSE THREE. globals.css aliases the two
 * palettes to identical triples on purpose ("PASSED/FAILED alias
 * karma-merit/feedback-error deliberately — two reds 30° apart would read as
 * one colour applied inconsistently"), so this is a rename, in both themes.
 * That is the point: the value was never the problem, the layer was, and a
 * badge sitting on a feedback token is a badge that moves the day the feedback
 * palette is re-tuned for toasts. These are the same three tokens
 * `REALM_COLORS` in lib/chart-colors.ts mirrors, so the chart legend and the
 * badge now name one palette instead of two that happen to agree.
 *
 * NEUTRAL DOES CHANGE, from the accent amber to the authored dim neutral,
 * following the same ruling `REALM_COLORS.NEUTRAL` records: `RealmType.NEUTRAL`
 * is a waypoint nobody is sentenced to, so no verdict token can mirror it, and
 * --color-status-lost is a lifecycle token meaning the soul went missing.
 * Amber was the accent — the colour of every button, link and heading — which
 * said "act on this" about the ferry crossing.
 *
 * The ruling pins --color-ink-tertiary, and that is what fills and outlines
 * this badge. The LABEL is --color-ink-muted instead, because the ruling was
 * made about a chart fill and a chart fill has no text sitting on it:
 * ink-tertiary over a 10% tint of itself measures 2.56:1 in light mode
 * (4.51:1 dark) — below the 4.5:1 AA floor. ink-muted on that same tint is
 * 6.41:1 light / 10.51:1 dark. The amber it replaces was itself under the
 * floor at 4.47:1 on the card and 4.27:1 on its hover state.
 *
 * src/__tests__/statusTokenLayering.test.ts holds this map to the rule, and to
 * every other domain-enum-keyed badge map in the app. It reads these four
 * entries AS TEXT, one line per key, and parses the `x-[hsl(var(--t)/a)]`
 * utilities out of each — so the four lines below stay one-line literals and
 * the alphas stay 0.1 / 0.3 / 1.
 */
const REALM_TYPE_CONFIG: Record<string, { icon: React.ReactNode; className: string }> = {
  HELL: { icon: <Flame className="w-4 h-4" />, className: 'bg-[hsl(var(--color-verdict-failed)/0.1)] border-[hsl(var(--color-verdict-failed)/0.3)] text-[hsl(var(--color-verdict-failed))]' },
  PURGATORY: { icon: <Cloud className="w-4 h-4" />, className: 'bg-[hsl(var(--color-verdict-purgatory)/0.1)] border-[hsl(var(--color-verdict-purgatory)/0.3)] text-[hsl(var(--color-verdict-purgatory))]' },
  BLISS: { icon: <CircleDot className="w-4 h-4" />, className: 'bg-[hsl(var(--color-verdict-passed)/0.1)] border-[hsl(var(--color-verdict-passed)/0.3)] text-[hsl(var(--color-verdict-passed))]' },
  NEUTRAL: { icon: <Castle className="w-4 h-4" />, className: 'bg-[hsl(var(--color-ink-tertiary)/0.1)] border-[hsl(var(--color-ink-tertiary)/0.3)] text-[hsl(var(--color-ink-muted))]' },
};

export default function RealmsPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: realms = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["realms", user?.tenant?.code, user?.role],
    queryFn: () => realmsApi.list().then(r => r.data.results || []),
    enabled: !!user,
  });

  // Group by civilization
  const grouped: Record<string, Realm[]> = realms.reduce<Record<string, Realm[]>>((acc, realm) => {
    const civ = realm.civilization || "UNKNOWN";
    if (!acc[civ]) acc[civ] = [];
    acc[civ].push(realm);
    return acc;
  }, {});

  const toggleCollapse = (civ: string) => {
    setCollapsed(prev => ({ ...prev, [civ]: !prev[civ] }));
  };

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("realms.title")}
          <MenuGloss path="/realms" />
        </>
      }
      subtitle={t("realms.subtitle")}
      isLoading={isLoading}
      skeleton={
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      }
    >
      {/* This page destructured `error` from useQuery and never read it, so a
          failed request rendered the heading and an empty grid -- the same
          thing "no realms exist" renders. Measured 2026-08-29: identical page
          text between a 500 and an empty list. */}
      {isError && <QueryError onRetry={() => refetch()} />}
      <div className="space-y-10">
        {Object.entries(grouped).map(([civ, civRealms]) => {
          const config = CIVILIZATION_CONFIG[civ] || { nameKey: `realms.civilizations.${civ}`, icon: <Castle className="w-6 h-6" /> };
          const isCollapsed = collapsed[civ];

          return (
            <div key={civ}>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => toggleCollapse(civ)}
                className="w-full justify-start mb-4 text-left"
              >
                <span aria-hidden="true" className="text-ink-muted">{config.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-06 text-ink truncate">{t(config.nameKey)}</span>
                  <span className="block text-04 text-ink-subtle">{civRealms.length} {t("realms.count")}</span>
                </span>
                <ChevronDown aria-hidden="true" className={`w-5 h-5 text-ink-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              </Button>

              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {civRealms.map((realm) => {
                    const typeConfig = REALM_TYPE_CONFIG[realm.realm_type] || REALM_TYPE_CONFIG.NEUTRAL;
                    return (
                      <div key={realm.id} className="bg-surface-1 border border-hairline p-4 hover:border-[hsl(var(--color-accent)/0.5)] hover:bg-surface-2 transition-colors">
                        <div className="flex items-start gap-3">
                          <div aria-hidden="true" className="text-ink-muted">{typeConfig.icon}</div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-04 font-semibold text-ink truncate">{t(`realms.names.${realm.realm_code}`) || realm.name_en}</h3>
                            <p className="text-03 text-ink-tertiary truncate">{t(`realms.codes.${realm.realm_code}`) || realm.name_local}</p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <Badge glyph={typeConfig.icon} className={typeConfig.className}>
                            <DomainEnum namespace="realms.types" value={realm.realm_type} />
                          </Badge>
                        </div>
                        {/* DECIDED, not pending: `Realm.description` stays off this
                            card, and the API is right to keep it off the list row.
                            The TODO that used to sit here was half accurate — the
                            field is on the model and in RealmSerializer, but
                            RealmListSerializer (what `action == "list"` returns, and
                            this page fetches the list) does not carry it — and wrong
                            about the remedy. What it holds is maintainer prose in
                            English with citations in it, and in one row a source
                            review addressed to the next editor of the seed table;
                            this page defaults to zh-Hans. Realm text that is product
                            copy is already keyed on realm_code in the three bundles,
                            which is where a blurb would go if one is ever wanted.
                            Pinned by tests/test_realm_actor_api.py::
                            TestRealmDescriptionStaysOffTheCard. */}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
