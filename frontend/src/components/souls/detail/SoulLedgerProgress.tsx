"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Disposition, Judgment, Reincarnation, Soul, SoulPathEntry } from "@soulledger/core/api";
import { useQuery } from "@tanstack/react-query";
import { soulsApi } from "@soulledger/core/api";
import { useRealms } from "@soulledger/core/hooks/useRealms";
import { soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { realmStationLabel } from "@/src/components/realms/RouteTopology";
import { buildTopology, type Station, type Topology } from "@/src/lib/routeTopology";
import { journeyCounts, offRoute, roadFraction, soulRoad, stageStates, type Road, type StageState } from "@/src/lib/journeyModel";
import { topologyGraph } from "@/src/lib/journeyLayout";
import { JourneyMap } from "@/src/components/journey/JourneyMap";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { latest, stepStatuses } from "./soulProgress";
import { hasRebirth } from "@/src/lib/hasRebirth";
import { SoulUnderworldMap } from "./SoulUnderworldMap";

/**
 * 行程块(Design 第二十五批,2026-11-09 起代替四格进度 + 行程条)。从上到下三层:
 *
 *   1 标题    现在在哪,写成字;右侧计数(已行 N 站 · 余 M 站到某站 · 到此 D 日)
 *   2 阶段条  存活 / 审判 / 处置 / 轮回四格:完成 / 现在(metal 游标)/ 待办 / 不适用(斜纹,「不轮回」)
 *   3 行程图  这个阶段里走到第几站(`JourneyMap`,与工作流实例同一个组件)
 *
 * 阶段从 `current_state` 来(soulProgress.ts),站从 path 来(routeTopology.ts 规则 16)—— 两份数据,
 * 各自的规则,这里不互相推断。欧洲、埃及没有轮回:第四格画成不适用,不拿灰色假装待办(用户决定)。
 */
export function SoulLedgerProgress({
  soul,
  judgments,
  dispositions,
  reincarnations,
  birthDisplay,
  deathDisplay,
}: {
  soul: Soul;
  judgments: Judgment[];
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
  birthDisplay: string | null;
  deathDisplay: string | null;
}) {
  const { t, formatDate } = useI18n();
  const realms = useRealms();
  const path = useQuery({
    queryKey: soulKeys.path(soul.id),
    queryFn: () => soulsApi.path(soul.id).then((r) => r.data),
  });

  const opened = judgments.length ? judgments.reduce((a, b) => (a.created_at <= b.created_at ? a : b)) : null;
  const decided = latest(judgments.filter((j) => j.concluded_at), (j) => j.concluded_at);
  const disposition = latest(dispositions, (d) => d.executed_at ?? d.created_at);
  const rebirth = latest(reincarnations, (r) => r.reincarnated_at);

  const statuses = stepStatuses(soul.current_state, [true, judgments.length > 0, dispositions.length > 0, reincarnations.length > 0]);
  const stages = stageStates(statuses, soul.civilization);

  const missing = <MissingValue kind="unrecorded" />;
  const alive = soul.current_state === "ALIVE";
  const bodies: ReactNode[] = [
    <>
      {birthDisplay ?? missing} — {deathDisplay ?? (alive ? "" : missing)}
    </>,
    opened ? (
      <>
        {t("souls.detail.ledger.opened", { date: formatDate(opened.created_at) })}
        {decided?.concluded_at && ` · ${t("souls.detail.ledger.decided", { date: formatDate(decided.concluded_at) })}`}
      </>
    ) : (
      missing
    ),
    disposition ? formatDate(disposition.executed_at ?? disposition.created_at) : missing,
    rebirth ? formatDate(rebirth.reincarnated_at) : missing,
  ];
  const labels = [
    t("souls.states.ALIVE"),
    t("souls.detail.timeline.stage_judging"),
    t("souls.detail.timeline.stage_disposed"),
    hasRebirth(soul.civilization) ? t("souls.detail.timeline.stage_reincarnating") : t("realms.journey.no_rebirth"),
  ];

  const ready = realms.data && path.data ? { realms: realms.data, path: path.data } : null;
  const topology = ready ? buildTopology(soul.civilization, ready.realms, ready.path) : null;
  const road = topology ? soulRoad(topology) : null;
  const name = (s: Station) => realmStationLabel(t, s) ?? t("common.value.unrecorded");

  // 标题:有「现在」的站就写站;没有(活着、还没有行程、或 LOST)就写现在的阶段。
  const counts = topology && road ? journeyCounts(topology, road) : null;
  const here = counts?.current ?? null;
  const numbered = topology?.kind === "line" && !topology.schematic ? (here?.realm?.order ?? null) : null;
  const stageAt = Math.max(statuses.indexOf("current"), statuses.lastIndexOf("done"));
  const title = here
    ? numbered !== null
      ? `${t("realms.journey.station_n", { n: String(numbered) })} · ${name(here)}`
      : name(here)
    : labels[Math.max(0, stageAt)];
  const days = here ? daysHere(ready!.path, here) : null;
  const countText = counts
    ? [
        t("realms.journey.walked_n", { n: String(counts.walked) }),
        counts.twoRoads
          ? t("realms.journey.two_roads")
          : counts.end
            ? t("realms.journey.left_to", { n: String(counts.remaining), name: name(counts.end) })
            : null,
        days !== null ? t("realms.journey.days_here", { n: String(days) }) : null,
      ]
        .filter(Boolean)
        .join(" · ") + (topology?.schematic ? t("realms.journey.schematic_suffix") : "")
    : null;
  const fraction = road ? roadFraction(road) : 0;

  return (
    <div className="min-w-0" data-testid="soul-journey">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 min-w-0">
          <h2 data-testid="soul-journey-title" className="font-serif text-lg text-[oklch(var(--color-ink))]">{title}</h2>
          {topology && (
            <span className="text-sm text-[oklch(var(--color-ink-muted))]">
              {topology.schematic ? t("realms.topology.shape_line") : t(`realms.topology.shape_${topology.kind}`)}
              {topology.schematic && (
                <span data-testid="topology-schematic" className="journey-pill ml-2 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-2))] px-2 text-2xs">
                  {t("realms.topology.schematic")}
                </span>
              )}
            </span>
          )}
        </div>
        {countText && (
          <span data-testid="soul-journey-count" className="text-xs text-[oklch(var(--color-ink-subtle))]">
            {countText}
          </span>
        )}
      </div>

      <ol aria-label={t("souls.detail.ledger.progress_label")} data-testid="soul-ledger-progress" className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-2 gap-y-3">
        {stages.map((stage, i) => (
          <StageCell
            key={i}
            stage={stage}
            label={labels[i]}
            fill={fraction > 0 && fraction < 1 ? fraction : 0.5}
            body={stage === "na" ? null : stage === "future" ? t("souls.detail.ledger.not_yet") : bodies[i]}
          />
        ))}
      </ol>

      <div data-testid="soul-route" className="min-w-0 max-w-full mt-3 pt-3 pb-3 border-t border-b border-[oklch(var(--color-line))]">
        {realms.isError || path.isError ? (
          <p role="alert" className="text-2xs text-[oklch(var(--color-danger))]">
            ! {t("realms.topology.load_failed")}
          </p>
        ) : !topology || !road ? (
          <div aria-busy="true" className="space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <SoulRoute topology={topology} road={road} name={name} heading={numbered !== null ? t("realms.journey.now_station", { n: String(numbered) }) : t("realms.journey.now")} sub={days !== null ? t("realms.journey.days_here", { n: String(days) }) : null} />
        )}
      </div>
      {/* 地府的图在十三站卡里(DiyuStationStrip);其余三个文明的图在行程下面。 */}
      {soul.civilization !== "CHINESE" && (
        <SoulUnderworldMap soul={soul} eternal={!!disposition?.is_eternal} className="py-3 border-b border-[oklch(var(--color-line))]" />
      )}
    </div>
  );
}

/** Whole days since the open path entry for `here` began. */
function daysHere(path: readonly SoulPathEntry[], here: Station): number | null {
  const entry = path.find((e) => e.left_at === null && (e.realm_id ?? e.id) === here.id);
  if (!entry) return null;
  const ms = Date.now() - new Date(entry.entered_at).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null;
}

/** One cell of the stage bar: icon + name above a 10-high bar. Four states differ by shape, not only colour. */
function StageCell({ stage, label, fill, body }: { stage: StageState; label: string; fill: number; body: ReactNode }) {
  const { t } = useI18n();
  return (
    <li data-step-status={stage} aria-current={stage === "current" ? "step" : undefined} className="relative min-w-0">
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden="true" className="journey-stage-icon" data-step-status={stage} />
        <span className={`journey-stage-name truncate ${stage === "current" ? "font-semibold" : ""}`} data-step-status={stage}>
          {label}
        </span>
        {stage === "current" && <span className="journey-now-word ml-auto text-2xs">{t("realms.journey.now")}</span>}
        <span className="sr-only">{t(`souls.detail.journey.stage_${stage}`)}</span>
      </div>
      <div aria-hidden="true" data-testid="soul-ledger-bar" className="journey-stage-bar mt-1" data-step-status={stage}>
        {stage === "current" && <span className="journey-stage-fill" style={{ "--fill": `${Math.round(fill * 100)}%` } as CSSProperties} />}
      </div>
      {body !== null && <div className="mt-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))] truncate">{body}</div>}
    </li>
  );
}

/** 行程图 + 支线一行。支线没有挂在哪一站的数据,所以不画在线上(不替它编一个挂点),列在下面。 */
function SoulRoute({
  topology,
  road,
  name,
  heading,
  sub,
}: {
  topology: Topology;
  road: Road;
  name: (s: Station) => string;
  heading: string;
  sub: string | null;
}) {
  const { t } = useI18n();
  const graph = topologyGraph(topology, road, {
    name,
    notAPlace: t("realms.journey.not_a_place"),
    offRoute: t("realms.journey.off_route"),
    region: (r) => t(`realms.topology.region.${r}`),
    fork: (f) => t(`realms.topology.fork.${f}`),
  });
  const off = offRoute(road);
  const offNames = road.others.filter((s) => off.has(s.id)).map(name);
  const branchIds = new Set(topology.branches.map((s) => s.id));
  const sideOff = topology.offShape.filter((r) => !branchIds.has(r.id));
  const empty = topology.schematic && topology.kind === "line" && topology.stations.length === 0;

  return (
    <div data-route-topology={topology.kind} data-schematic={topology.schematic ? "true" : "false"} className="min-w-0">
      {empty ? (
        <p className="text-2xs text-[oklch(var(--color-ink-subtle))] py-1">{t("realms.topology.no_stops")}</p>
      ) : (
        <JourneyMap
          graph={graph}
          label={t("souls.detail.ledger.route_title")}
          plate={{ heading, sub }}
          narrow={{
            road: road.stations.map((s) => s.id),
            tails: road.tails.map((x) => x.station.id),
            note: offNames.length ? t("realms.journey.off_note", { names: offNames.join("、") }) : null,
          }}
        />
      )}
      {(topology.branches.length > 0 || sideOff.length > 0) && (
        <div className="relative mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs">
          <ol data-testid="topology-branches" className="contents">
            {topology.branches.map((s) => (
              <li key={s.id} data-station-state={s.state} aria-current={s.state === "current" ? "step" : undefined} className="flex items-center gap-1 journey-text" data-route="on">
                <span aria-hidden="true" className="journey-dot" data-station-state={s.state} data-route="on" />
                <span>{name(s)}</span>
                <span className="sr-only">{t(`realms.topology.state_${s.state}`)}</span>
              </li>
            ))}
            {sideOff.map((r) => (
              <li key={r.id} data-station-state="pending" data-route="off" className="flex items-center gap-1 journey-text">
                <span aria-hidden="true" className="journey-dot" data-station-state="pending" data-route="off" />
                <span>{name({ id: r.id, code: r.realm_code, realm: r, state: "pending" })}</span>
                <span className="sr-only">{t("realms.journey.off_route")}</span>
              </li>
            ))}
          </ol>
          {sideOff.length > 0 && <span className="text-[oklch(var(--color-ink-subtle))]">{t("realms.journey.branch_legend")}</span>}
        </div>
      )}
    </div>
  );
}
