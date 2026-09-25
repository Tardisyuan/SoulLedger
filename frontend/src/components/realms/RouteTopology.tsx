"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { segmentWalked, type Station, type StationState, type Topology } from "@/src/lib/routeTopology";

/**
 * 行程拓扑的画法 —— 界域页(`mode="map"`)与灵魂详情行程条(`mode="route"`)共用。
 * 布局规则在 `src/lib/routeTopology.ts`,这里只管画:
 *
 *   ━ 已行   3 px 墨线(两端都是有记录的站)
 *   ┅ 待行   1 px 虚线
 *   ▪ 现在   强调色方块
 *   □ 站     空心方块;map 模式里有在押的站填墨
 *
 * 每个站是一个 `<li data-station-state>`,状态另有 sr-only 文字 —— 线型与方块
 * 只是看的,不单靠形状说「这一站走过没有」。
 */
export type RouteTopologyMode = "map" | "route";

const WALKED = "border-[oklch(var(--color-ink))]";
const AHEAD = "border-dashed border-[oklch(var(--color-ink-subtle))]";

/** The station's name, or null when nothing names it (a stop whose realm row is gone
 *  and whose entry carried no code) — the caller renders a typed miss for that. */
export function realmStationLabel(t: (k: string) => string, station: Station): string | null {
  const code = station.code ?? station.realm?.realm_code ?? null;
  if (code) {
    for (const ns of ["realms.names", "realms.codes"]) {
      const shown = resolveEnumDisplay(t, ns, code);
      if (shown.state === "known") return shown.label;
    }
  }
  return station.realm?.name_en || station.realm?.name_local || code || null;
}

export function RouteTopology({
  topology,
  mode,
  title,
  occupancy,
  compact = false,
}: {
  topology: Topology;
  mode: RouteTopologyMode;
  title: ReactNode;
  /** map mode: souls held per realm id. */
  occupancy?: ReadonlyMap<string, number>;
  /** The detail bar: horizontal where the shape allows, dense rows. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const label = (s: Station): ReactNode => realmStationLabel(t, s) ?? <MissingValue kind="unrecorded" />;
  /** Full name plus code, for the `title` of every truncated label. */
  const tip = (s: Station) => [realmStationLabel(t, s), s.code].filter(Boolean).join(" · ") || undefined;
  const held = (s: Station) => occupancy?.get(s.id) ?? 0;

  const mark = (s: Station, emphasis = false) => (
    <StationMark state={s.state} filled={mode === "map" && held(s) > 0} emphasis={emphasis} />
  );
  const stateText = (s: Station) => (
    <span className="sr-only">{t(`realms.topology.state_${s.state}`)}</span>
  );
  const occ = (s: Station) =>
    mode === "map" ? (
      <span className="ml-auto pl-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{held(s)}</span>
    ) : null;

  const vertical = (stations: Station[], lead: Station | null = null) => (
    <ol className="relative">
      {stations.map((s, i) => {
        const into = i === 0 ? (lead ? lead.state !== "pending" && s.state !== "pending" : null) : segmentWalked(stations, i);
        const out = i < stations.length - 1 ? segmentWalked(stations, i + 1) : null;
        return (
          <li
            key={s.id}
            data-station-state={s.state}
            aria-current={s.state === "current" ? "step" : undefined}
            className={`grid grid-cols-[20px_1fr] ${compact ? "min-h-6" : "min-h-8"}`}
          >
            <span aria-hidden="true" className="flex flex-col items-center">
              <span className={`flex-1 w-0 ${into === null ? "" : into ? `border-l-[3px] ${WALKED}` : `border-l ${AHEAD}`}`} />
              {mark(s)}
              <span className={`flex-1 w-0 ${out === null ? "" : out ? `border-l-[3px] ${WALKED}` : `border-l ${AHEAD}`}`} />
            </span>
            <span className={`flex items-center gap-2 min-w-0 pl-1.5 ${compact ? "text-2xs" : "text-sm"} ${textTone(s.state)}`}>
              <span className="truncate" title={tip(s)}>{label(s)}</span>
              {stateText(s)}
              {occ(s)}
            </span>
          </li>
        );
      })}
    </ol>
  );

  const horizontal = (stations: Station[], bold?: (s: Station) => boolean) => (
    <ol className="flex min-w-max">
      {stations.map((s, i) => (
        <li
          key={s.id}
          data-station-state={s.state}
          aria-current={s.state === "current" ? "step" : undefined}
          className="min-w-16 flex-1 pr-1"
        >
          <span aria-hidden="true" className="flex items-center h-3">
            <span className={`flex-1 h-0 ${i === 0 ? "" : segmentWalked(stations, i) ? `border-t-[3px] ${WALKED}` : `border-t ${AHEAD}`}`} />
            {mark(s, bold?.(s))}
            <span className={`flex-1 h-0 ${i === stations.length - 1 ? "" : segmentWalked(stations, i + 1) ? `border-t-[3px] ${WALKED}` : `border-t ${AHEAD}`}`} />
          </span>
          <span
            title={tip(s)}
            className={`block text-center text-2xs mt-1 truncate ${textTone(s.state)} ${bold?.(s) ? "font-semibold" : ""}`}
          >
            {label(s)}
          </span>
          {stateText(s)}
          {mode === "map" && <span className="block text-center font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{held(s)}</span>}
        </li>
      ))}
    </ol>
  );

  let body: ReactNode;
  switch (topology.kind) {
    case "line":
      body = compact ? <div className="relative overflow-x-auto max-w-full">{horizontal(topology.stations)}</div> : vertical(topology.stations);
      break;
    case "river":
      body = (
        <div className="relative overflow-x-auto max-w-full">
          {horizontal(topology.stations, (s) => s.realm?.is_judgment_hall === true)}
        </div>
      );
      break;
    case "funnel":
      body = (
        <div className="space-y-2">
          {topology.regions.map(({ region, stations }) => {
            // Inferno narrows as it descends; Purgatorio is the mountain, drawn
            // summit-first so it narrows upward — the inverted funnel.
            const drawn = region === "PURGATORIO" ? [...stations].reverse() : stations;
            return (
              <div key={region} data-funnel-region={region}>
                <div className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t(`realms.topology.region.${region}`)}</div>
                <ol>
                  {drawn.map((s) => {
                    const level = s.realm?.level ?? null;
                    const width = level === null ? 100 : Math.max(28, 100 - (level - 1) * 8);
                    return (
                      <li
                        key={s.id}
                        data-station-state={s.state}
                        aria-current={s.state === "current" ? "step" : undefined}
                        className="flex justify-center"
                      >
                        <span
                          style={{ width: `${width}%` }}
                          className={`flex items-center gap-2 px-1 ${compact ? "min-h-5 text-2xs" : "min-h-7 text-sm"} ${
                            s.state === "pending" ? `border-t ${AHEAD}` : `border-t-[3px] ${WALKED}`
                          } ${textTone(s.state)}`}
                        >
                          {mark(s)}
                          {level !== null && <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{roman(level)}</span>}
                          <span className="truncate" title={tip(s)}>{label(s)}</span>
                          {stateText(s)}
                          {occ(s)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
      );
      break;
    case "fork": {
      const lastTrunk = topology.trunk[topology.trunk.length - 1] ?? null;
      body = (
        <div>
          {vertical(topology.trunk)}
          <div className={`grid gap-3 mt-1`} style={{ gridTemplateColumns: `repeat(${topology.roads.length}, minmax(0, 1fr))` }}>
            {topology.roads.map((road) => (
              <div key={road.fork} data-fork={road.fork}>
                <div className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))] pl-1">{t(`realms.topology.fork.${road.fork}`)}</div>
                {vertical(road.stations, lastTrunk)}
              </div>
            ))}
          </div>
        </div>
      );
      break;
    }
  }

  return (
    <div data-route-topology={topology.kind} data-schematic={topology.schematic ? "true" : "false"} data-mode={mode} className="min-w-0 max-w-full">
      <div className="flex flex-wrap justify-between gap-x-3 font-mono text-2xs text-[oklch(var(--color-ink-subtle))] pb-1">
        <span>
          {title} · {topology.schematic ? t("realms.topology.shape_line") : t(`realms.topology.shape_${topology.kind}`)}
          {topology.schematic && (
            <span data-testid="topology-schematic" className="ml-2 px-1 border border-[oklch(var(--color-line))]">
              {t("realms.topology.schematic")}
            </span>
          )}
        </span>
        <span aria-hidden="true">{t("realms.topology.legend")}</span>
      </div>
      {topology.schematic && topology.kind === "line" && topology.stations.length === 0 ? (
        <p className="text-2xs text-[oklch(var(--color-ink-subtle))] py-1">{t("realms.topology.no_stops")}</p>
      ) : (
        <div className="pt-1">{body}</div>
      )}
      {topology.branches.length > 0 && (
        <ol data-testid="topology-branches" className="mt-2">
          {topology.branches.map((s) => (
            <li
              key={s.id}
              data-station-state={s.state}
              aria-current={s.state === "current" ? "step" : undefined}
              className={`flex items-center gap-2 text-2xs min-h-5 ${textTone(s.state)}`}
            >
              <span aria-hidden="true" className="font-mono text-[oklch(var(--color-ink-subtle))]">↳</span>
              {mark(s)}
              <span className="truncate" title={tip(s)}>{label(s)}</span>
              {stateText(s)}
            </li>
          ))}
        </ol>
      )}
      {mode === "map" && topology.offShape.length > 0 && (
        <p className="text-2xs text-[oklch(var(--color-ink-subtle))] mt-2">
          {t("realms.topology.off_shape", { n: String(topology.offShape.length) })}
        </p>
      )}
    </div>
  );
}

function textTone(state: StationState): string {
  if (state === "current") return "font-semibold text-[oklch(var(--color-ink))]";
  if (state === "travelled") return "text-[oklch(var(--color-ink))]";
  return "text-[oklch(var(--color-ink-muted))]";
}

function StationMark({ state, filled, emphasis }: { state: StationState; filled: boolean; emphasis?: boolean }) {
  const ring = emphasis ? "border-2" : "border";
  const cls =
    state === "current"
      ? "size-2.5 bg-[oklch(var(--color-accent))]"
      : state === "travelled" || filled
        ? `size-2 bg-[oklch(var(--color-ink))] ${emphasis ? "outline outline-1 outline-offset-1 outline-[oklch(var(--color-ink))]" : ""}`
        : `size-2 bg-[oklch(var(--color-canvas))] ${ring} border-[oklch(var(--color-ink-subtle))]`;
  return <span aria-hidden="true" data-mark={state} className={`shrink-0 ${cls}`} />;
}

const ROMAN: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
function roman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}
