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
  /**
   * 已过(未登记):这条路上「现在」(没有现在就是最远的已行站)之前、path 里没有记录的站。
   * 走不到一站而不经过它前面的站,所以行程块把它们画成已行(不打勾),读屏写「已过(未登记)」。
   * 只是画法与计数 —— Station.state(规则 16)不改,/realms 也不受影响。
   */
  implied: Set<string>;
}

const walked = (stations: readonly Station[]) => stations.some((s) => s.state !== "pending");

/** 希腊的主干按 `order` 排(与 journeyLayout 画的次序同一条);有一站没有 order 就照原样。 */
export const trunkOrder = (trunk: readonly Station[]): Station[] =>
  trunk.every((s) => s.realm?.order != null) ? [...trunk].sort((a, b) => a.realm!.order! - b.realm!.order!) : [...trunk];

export function soulRoad(topology: Topology): Road {
  const road = roadOf(topology);
  const states = road.stations.map((s) => s.state);
  let at = states.indexOf("current");
  if (at < 0) at = states.lastIndexOf("travelled");
  const implied = new Set(road.stations.slice(0, Math.max(0, at)).filter((s) => s.state === "pending").map((s) => s.id));
  return { ...road, implied };
}

function roadOf(topology: Topology): Omit<Road, "implied"> {
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
        stations: [...trunkOrder(topology.trunk), ...(taken?.stations ?? [])],
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
  /** Stops left behind — on the road and on branches, counting the implied ones (已过未登记). */
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
    walked: all.filter((s) => s.state === "travelled").length + road.implied.size,
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
  const done = road.stations.filter((s) => s.state !== "pending" || road.implied.has(s.id)).length;
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

/** 停留多久:不满一年按日,满一年按整年(演示里 1285 年进来的灵魂,「到此 270705 日」读不出意思)。 */
export type Stay = { unit: "days" | "years"; n: number };
const DAY = 86_400_000;

export function stayFrom(enteredAt: string | null | undefined, now: number = Date.now()): Stay | null {
  if (!enteredAt) return null;
  const ms = now - new Date(enteredAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const days = Math.max(0, Math.floor(ms / DAY));
  return days < 365 ? { unit: "days", n: days } : { unit: "years", n: Math.max(1, Math.floor(days / 365.2425)) };
}

export const stayText = (t: (key: string, vars?: Record<string, string>) => string, stay: Stay): string =>
  t(stay.unit === "days" ? "realms.journey.days_here" : "realms.journey.years_here", { n: String(stay.n) });

/**
 * 标题下那句说明(第二十五批 §一.1):审判中、有一桩没结的审判时说在哪儿受审;埃及称心、还没判时说心在天平上。
 * 其余 null(调用方仍写形状名)。只读 `current_state` 与审判本身,不推断别的。
 */
export type JudgingLine = { kind: "weighing" } | { kind: "court"; court: string };

export function judgingLine(
  state: string | null | undefined,
  civilization: string | null | undefined,
  judgments: readonly { court: string; verdict: unknown; concluded_at: string | null; created_at: string }[],
): JudgingLine | null {
  if (state !== "JUDGING") return null;
  const open = judgments.filter((j) => !j.concluded_at).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (!open) return null;
  if (civilization === "EGYPTIAN") return open.verdict == null ? { kind: "weighing" } : null;
  const court = (open.court ?? "").trim();
  return court ? { kind: "court", court } : null;
}
