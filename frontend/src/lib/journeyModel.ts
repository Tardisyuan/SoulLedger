import type { Station, StationState, Topology } from "./routeTopology";
import type { StepStatus } from "@/src/components/souls/detail/soulProgress";
import { hasRebirth } from "./hasRebirth";

/**
 * 行程块(Design 第二十五批)的纯逻辑:这个灵魂自己的那条路、标题右侧的计数、窄屏的折叠、阶段条的四格。
 * 画法在 `components/journey/JourneyMap.tsx`,坐标在 `journeyLayout.ts`。站的状态仍只从 path 来
 * (routeTopology.ts 规则 16)—— 这里不改状态的意思,只多一个「不在此路」:没走的岔路上的待行站。
 */

/** The soul's own road in walking order, and the stations that are not on it. */
export interface Road {
  stations: Station[];
  /** 没走的那几条路上的站。`decided` 为 false 时它们仍是待行(称心未定),不是「不在此路」。 */
  others: Station[];
  decided: boolean;
  /** 称心未定:两条路各自的终点,窄屏画成两条短尾巴。 */
  tails: { station: Station; terminal: boolean }[];
}

const walked = (stations: readonly Station[]) => stations.some((s) => s.state !== "pending");

export function soulRoad(topology: Topology): Road {
  switch (topology.kind) {
    case "line":
      return { stations: topology.stations, others: [], decided: true, tails: [] };
    case "funnel": {
      const down = topology.regions.filter((g) => g.region === "INFERNO").flatMap((g) => g.stations);
      const up = topology.regions.filter((g) => g.region !== "INFERNO").flatMap((g) => g.stations);
      if (walked(up) && !walked(down)) return { stations: up, others: down, decided: true, tails: [] };
      // 下行走过,或者两边都没走:画下行,上行在前一种情况是「不在此路」,后一种仍是待行。
      return { stations: down, others: up, decided: walked(down), tails: [] };
    }
    case "fork_two": {
      const taken = topology.roads.find((r) => walked(r.stations));
      if (taken) {
        return {
          stations: [...topology.trunk, ...taken.stations],
          others: topology.roads.filter((r) => r !== taken).flatMap((r) => r.stations),
          decided: true,
          tails: [],
        };
      }
      return {
        stations: topology.trunk,
        others: topology.roads.flatMap((r) => r.stations),
        decided: false,
        tails: topology.roads.map((r) => ({ station: r.stations[r.stations.length - 1], terminal: r.terminal })),
      };
    }
    case "fork": {
      // 用户决定(第二十五批):希腊没走的岔路(塔尔塔罗斯、至福岛)一律「不在此路」,不画成待行。
      const taken = topology.roads.find((r) => walked(r.stations));
      return {
        stations: [...topology.trunk, ...(taken?.stations ?? [])],
        others: topology.roads.filter((r) => r !== taken).flatMap((r) => r.stations),
        decided: true,
        tails: [],
      };
    }
  }
}

/** Off this road: a pending station on a road the soul did not take, once that is known. */
export function offRoute(road: Road): Set<string> {
  return new Set(road.decided ? road.others.filter((s) => s.state === "pending").map((s) => s.id) : []);
}

export interface JourneyCounts {
  /** Recorded stops left behind — on the road and on branches. */
  walked: number;
  current: Station | null;
  /** Pending stations after where the soul stands, on its road. */
  remaining: number;
  /** The road's last station, when some remain. */
  end: Station | null;
  /** 称心未定:之后两条路之一。 */
  twoRoads: boolean;
}

export function journeyCounts(topology: Topology, road: Road): JourneyCounts {
  const all = [...road.stations, ...topology.branches];
  const current = all.find((s) => s.state === "current") ?? null;
  const at = Math.max(
    road.stations.findIndex((s) => s.state === "current"),
    road.stations.map((s) => s.state).lastIndexOf("travelled"),
  );
  const remaining = road.stations.slice(at + 1).filter((s) => s.state === "pending").length;
  return {
    walked: all.filter((s) => s.state === "travelled").length,
    current,
    remaining,
    end: remaining > 0 ? road.stations[road.stations.length - 1] : null,
    twoRoads: !road.decided && road.tails.length > 1,
  };
}

/** Walked share of the road, for the stage bar's fill (0..1). */
export function roadFraction(road: Road): number {
  const n = road.stations.length;
  if (!n) return 0;
  const done = road.stations.filter((s) => s.state !== "pending").length;
  return done / n;
}

/** 窄屏折叠:保留首站、现在的前一站、现在、后一站、终站;中间连续两站以上同状态的折成胶囊。 */
export type FoldItem =
  | { kind: "stop"; index: number }
  | { kind: "fold"; state: "travelled" | "pending"; from: number; to: number };

export function collapseRoad(states: readonly StationState[]): FoldItem[] {
  const n = states.length;
  if (!n) return [];
  let at = states.indexOf("current");
  if (at < 0) at = states.lastIndexOf("travelled");
  const keep = new Set([0, n - 1]);
  if (at >= 0) [at - 1, at, at + 1].forEach((i) => i >= 0 && i < n && keep.add(i));
  else keep.add(1);

  const out: FoldItem[] = [];
  let i = 0;
  while (i < n) {
    if (keep.has(i)) {
      out.push({ kind: "stop", index: i });
      i++;
      continue;
    }
    // A hidden run of one state (current is always kept, so only travelled / pending reach here).
    const state = states[i] === "travelled" ? "travelled" : "pending";
    let j = i;
    while (j + 1 < n && !keep.has(j + 1) && (states[j + 1] === "travelled" ? "travelled" : "pending") === state) j++;
    if (j === i) out.push({ kind: "stop", index: i });
    else out.push({ kind: "fold", state, from: i, to: j });
    i = j + 1;
  }
  return out;
}

/** 阶段条四格:欧洲、埃及没有轮回,第四格「不适用」(用户决定),不拿灰色假装待办。 */
export type StageState = StepStatus | "na";

export function stageStates(statuses: readonly StepStatus[], civilization: string | null | undefined): StageState[] {
  return statuses.map((s, i) => (i === 3 && !hasRebirth(civilization) ? "na" : s));
}
