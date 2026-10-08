"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { realmStationLabel } from "@/src/components/realms/RouteTopology";
import type { Station, Topology } from "@/src/lib/routeTopology";
import { toRomanNumeral } from "@soulledger/core/config/civilizationSigil";

/**
 * 界域页的路线图(Design A2 `RouteMap`):四种文明各一种空间语法,**列表 + 连线**,
 * 只读、不可点。形状来自 `buildTopology`(与详情行程条同一份布局),画法与行程条不同:
 * 这里没有灵魂的 path,只有在押 —— 有灵魂 = 11px 墨实心方块,空 = 9px 空框且名字与数字转淡。
 *
 *   CHINESE  一条竖线串起各站
 *   EUROPEAN 漏斗:每层一个框,左右各缩 8px × (层号 − 1);炼狱山顶在上
 *   EGYPTIAN 主干到称心,下分两栏:过(实线)/ 不过(虚线,终点是虚线框,不计在押)
 *   GREEK    主干到三判官,下分左 / 右两栏,右栏右对齐
 *
 * `occupancy` 缺(在押加载失败)时数字写「—」,不写 0。
 */
const LABEL = "text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]";
const MUTED = "text-[oklch(var(--color-ink-muted))]";
const SPINE = "absolute left-[5.5px] top-3 bottom-3 w-px bg-[oklch(var(--color-line-strong))]";

export function RouteMap({
  topology,
  civilizationName,
  occupancy,
}: {
  topology: Topology;
  civilizationName: string;
  /** Souls held per realm id; undefined when it failed to load. */
  occupancy?: ReadonlyMap<string, number>;
}) {
  const { t } = useI18n();
  const held = (s: Station) => occupancy?.get(s.id) ?? 0;
  const name = (s: Station): ReactNode => realmStationLabel(t, s) ?? <MissingValue kind="unrecorded" />;
  const tip = (s: Station) => [realmStationLabel(t, s), s.code].filter(Boolean).join(" · ") || undefined;
  const count = (s: Station) => (occupancy ? held(s) : <MissingValue kind="unrecorded" reason={t("realms.table.occupancy_failed")} />);

  const mark = (s: Station) =>
    held(s) > 0 ? (
      <span aria-hidden="true" data-mark="held" className="relative size-[11px] bg-[oklch(var(--color-ink))]" />
    ) : (
      <span
        aria-hidden="true"
        data-mark="empty"
        className="relative size-[9px] border border-[oklch(var(--color-ink-muted))] bg-[oklch(var(--color-surface-1))]"
      />
    );

  // ≡ = 永恒(不出狱、不轮回,含原狱):图例与树表同一句,键是 realms.tree.legend_eternal。
  const eternal = (s: Station): ReactNode =>
    s.realm?.is_eternal ? (
      <span data-eternal="true" title={t("realms.tree.legend_eternal")} className={`shrink-0 text-xs ${MUTED}`}>
        <span aria-hidden="true">≡</span>
        <span className="sr-only">{t("realms.table.eternal_yes")}</span>
      </span>
    ) : null;

  /** One stop: mark · name · held. `end` mirrors it (the Greek right road). `terminal`: no place, no count. */
  const stop = (s: Station, { end = false, terminal = false } = {}) => {
    const on = held(s) > 0;
    return (
      <li key={s.id} data-station={s.code ?? s.id} className={`flex items-center gap-3 min-h-8 ${end ? "flex-row-reverse" : ""}`}>
        <span className="flex w-3 shrink-0 justify-center">{mark(s)}</span>
        <span title={tip(s)} className={`min-w-0 flex-1 truncate text-sm ${end ? "text-right" : ""} ${on ? "text-[oklch(var(--color-ink))]" : MUTED}`}>
          {name(s)}
        </span>
        {eternal(s)}
        {!terminal && <span className={`font-mono text-xs ${on ? "" : MUTED}`}>{count(s)}</span>}
      </li>
    );
  };

  /** A run of stops joined by the 1px spine. */
  const run = (stations: Station[], end = false) => (
    <ol className="relative">
      <span aria-hidden="true" className={end ? SPINE.replace("left-[5.5px]", "right-[5.5px]") : SPINE} />
      {stations.map((s) => stop(s, { end }))}
    </ol>
  );

  let body: ReactNode;
  switch (topology.kind) {
    case "line":
      body =
        topology.schematic && topology.stations.length === 0 ? (
          <p className={`text-2xs ${MUTED}`}>{t("realms.topology.no_stops")}</p>
        ) : (
          run(topology.stations)
        );
      break;
    case "funnel":
      body = (
        <div className="space-y-3">
          {topology.regions.map(({ region, stations }) => {
            // Purgatorio is the mountain: summit first, so it narrows upward.
            const drawn = region === "PURGATORIO" ? [...stations].reverse() : stations;
            const levels = stations.filter((s) => s.realm?.level != null).length;
            return (
              <div key={region} data-funnel-region={region}>
                <div className={`text-2xs pb-1 ${MUTED}`}>{t(`realms.map.region.${region}`, { n: String(levels) })}</div>
                <ol className="space-y-1">
                  {drawn.map((s) => {
                    const level = s.realm?.level ?? null;
                    const on = held(s) > 0;
                    return (
                      <li
                        key={s.id}
                        data-station={s.code ?? s.id}
                        style={{ marginInline: level === null ? 0 : (level - 1) * 8 }}
                        className={`flex items-center gap-2 min-h-8 px-2 border ${
                          on ? "border-[oklch(var(--color-line-strong))]" : "border-[oklch(var(--color-line))]"
                        }`}
                      >
                        <span className={`w-7 shrink-0 font-mono text-xs ${MUTED}`}>
                          {level === null ? "" : region === "INFERNO" ? toRomanNumeral(level) ?? level : level}
                        </span>
                        <span title={tip(s)} className={`min-w-0 flex-1 truncate text-sm ${on ? "text-[oklch(var(--color-ink))]" : MUTED}`}>
                          <span aria-hidden="true">{on ? "■ " : "□ "}</span>
                          {name(s)}
                        </span>
                        {eternal(s)}
                        <span className={`font-mono text-xs ${on ? "" : MUTED}`}>{count(s)}</span>
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
    case "fork_two":
      body = (
        <div>
          {run(topology.trunk)}
          <div className="grid grid-cols-2 gap-3 mt-1 pt-3 border-t border-[oklch(var(--color-line-strong))]">
            {topology.roads.map((road) => (
              <div
                key={road.fork}
                data-fork={road.fork}
                data-terminal={road.terminal ? "dashed" : undefined}
                className={`pl-3 border-l border-[oklch(var(--color-line-strong))] ${road.terminal ? "border-dashed" : ""}`}
              >
                <div className={`text-2xs pb-1 ${MUTED}`}>{t(`realms.map.fork.${road.fork}`)}</div>
                {road.terminal ? (
                  <>
                    <ol className="px-2 border border-dashed border-[oklch(var(--color-ink-muted))]">
                      {road.stations.map((s) => stop(s, { terminal: true }))}
                    </ol>
                    <div className={`text-2xs pt-1 ${MUTED}`}>{t("realms.map.terminal")}</div>
                  </>
                ) : (
                  <ol>{road.stations.map((s) => stop(s))}</ol>
                )}
              </div>
            ))}
          </div>
        </div>
      );
      break;
    case "fork":
      body = (
        <div>
          {run(topology.trunk)}
          <div className="grid grid-cols-2 gap-3 mt-1 pt-3 border-t border-[oklch(var(--color-line-strong))]">
            {topology.roads.map((road) => {
              const end = road.fork === "RIGHT";
              return (
                <div key={road.fork} data-fork={road.fork}>
                  <div className={`text-2xs pb-1 ${MUTED} ${end ? "text-right" : ""}`}>{t(`realms.map.fork.${road.fork}`)}</div>
                  {run(road.stations, end)}
                </div>
              );
            })}
          </div>
        </div>
      );
      break;
  }

  return (
    <div
      data-route-topology={topology.kind}
      data-schematic={topology.schematic ? "true" : "false"}
      data-mode="map"
      className="min-w-0 space-y-3"
    >
      <div className={LABEL}>
        {civilizationName} · {topology.schematic ? t("realms.map.shape_schematic") : t(`realms.map.shape_${topology.kind}`)}
        {topology.schematic && (
          <span data-testid="topology-schematic" className="ml-2 px-1 border border-[oklch(var(--color-line))]">
            {t("realms.topology.schematic")}
          </span>
        )}
      </div>
      {body}
      {topology.offShape.length > 0 && (
        <p className={`text-2xs ${MUTED}`}>{t("realms.topology.off_shape", { n: String(topology.offShape.length) })}</p>
      )}
      <div className={`flex flex-wrap gap-x-3 gap-y-1 pt-2 border-t border-[oklch(var(--color-line))] text-2xs ${MUTED}`}>
        <span>{t("realms.map.legend_held")}</span>
        <span>{t("realms.map.legend_empty")}</span>
        <span>{t("realms.map.legend_count")}</span>
        <span data-testid="map-legend-eternal">{t("realms.tree.legend_eternal")}</span>
        <span className="ml-auto">{t("realms.map.read_only")}</span>
      </div>
    </div>
  );
}
