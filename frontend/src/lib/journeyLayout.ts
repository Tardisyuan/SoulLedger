import type { ApprovalNode } from "@soulledger/core/api";
import type { Station, StationState, Topology } from "./routeTopology";
import { offRoute, type Road } from "./journeyModel";

/**
 * 行程图的坐标(Design 第二十五批 §二):一套画法,四种形状 + 示意 + 工作流实例。
 * 只算位置与每段线的种类,不碰颜色 —— 颜色全在 globals.css 的 `.journey-*`(都是令牌)。
 *
 *   walked  两端都是有记录的站(规则 16,与 routeTopology.segmentWalked 同一条)
 *   ahead   还没走,但在这条路上
 *   off     不在此路:没走的岔路、支线
 *
 * viewBox 宽 700(Design 的卡宽);SVG 按容器缩放,所以 700 左右不横滚。站数多于约 12 时
 * 由窄屏的折叠规则接手(JourneyMap 按宽度切换)。
 */

export const JOURNEY_W = 700;
const PAD = 44;

export interface JStop {
  id: string;
  x: number;
  y: number;
  /** The underlying path state — never rewritten; `route` says whether this road is the soul's. */
  state: StationState;
  route: "on" | "off";
  label: string;
  /** 站号(地府的殿号),画在站名下面。 */
  num?: string;
  labelAt: "below" | "above" | "right" | "left" | "none";
  /** 终止且不是地方(埃及湮灭):虚线方框。 */
  terminal?: boolean;
  /** Small dotted spur stop (a loop, a branch) — drawn, not listed as a station. */
  spur?: boolean;
}

export interface JEdge {
  id: string;
  from: string;
  to: string;
  kind: "walked" | "ahead" | "off";
  /** Bend into a different row (a fork leaving the trunk). */
  curve?: boolean;
}

export interface JCaption {
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
  tone?: "neg";
}

export interface JGraph {
  w: number;
  h: number;
  stops: JStop[];
  edges: JEdge[];
  captions: JCaption[];
  backdrop?: "funnel";
}

/** Spread `n` points evenly over [from, to]; one point sits at `single` (default: the middle). */
function spread(n: number, from: number, to: number, single = (from + to) / 2): number[] {
  if (n <= 1) return n ? [single] : [];
  return Array.from({ length: n }, (_, i) => from + (i * (to - from)) / (n - 1));
}

function edgeKind(a: JStop, b: JStop): JEdge["kind"] {
  if (a.route === "off" || b.route === "off") return "off";
  return a.state !== "pending" && b.state !== "pending" ? "walked" : "ahead";
}

function chain(stops: JStop[], lead: JStop | null = null): JEdge[] {
  const run = lead ? [lead, ...stops] : stops;
  return run.slice(1).map((b, i) => ({
    id: `${run[i].id}>${b.id}`,
    from: run[i].id,
    to: b.id,
    kind: edgeKind(run[i], b),
    curve: lead !== null && i === 0,
  }));
}

export interface TopologyText {
  name: (s: Station) => string;
  notAPlace: string;
  offRoute: string;
  region: (r: "INFERNO" | "PURGATORIO" | "PARADISO") => string;
  fork: (f: string) => string;
}

export function topologyGraph(topology: Topology, road: Road, text: TopologyText): JGraph {
  const off = offRoute(road);
  const stop = (s: Station, x: number, y: number, labelAt: JStop["labelAt"], extra: Partial<JStop> = {}): JStop => ({
    id: s.id,
    x,
    y,
    state: s.state,
    route: off.has(s.id) ? "off" : "on",
    label: text.name(s),
    labelAt,
    ...extra,
  });

  switch (topology.kind) {
    case "line": {
      const y = 92;
      const xs = spread(topology.stations.length, PAD, JOURNEY_W - PAD);
      const stops = topology.stations.map((s, i) =>
        stop(s, xs[i], y, "below", { num: !topology.schematic && s.realm?.order != null ? String(s.realm.order) : undefined }),
      );
      return { w: JOURNEY_W, h: 150, stops, edges: chain(stops), captions: [] };
    }

    case "fork_two": {
      const y = 124;
      const trunkXs = spread(topology.trunk.length, PAD, JOURNEY_W * 0.6, JOURNEY_W * 0.6);
      const trunk = topology.trunk.map((s, i) => stop(s, trunkXs[i], y, "below"));
      const hall = trunk[trunk.length - 1];
      const stops = [...trunk];
      const edges = chain(trunk);
      const captions: JCaption[] = [];
      topology.roads.forEach((road, k) => {
        const ry = k === 0 ? y - 66 : y + 66;
        const xs = spread(road.stations.length, hall.x + 110, JOURNEY_W - PAD, hall.x + 130);
        const run = road.stations.map((s, i) =>
          stop(s, xs[i], ry, k === 0 ? "above" : "below", { terminal: road.terminal && i === road.stations.length - 1 }),
        );
        stops.push(...run);
        edges.push(...chain(run, hall));
        captions.push({ x: hall.x + 18, y: k === 0 ? y - 40 : y + 48, text: text.fork(road.fork), anchor: "start" });
        const end = run[run.length - 1];
        if (end?.terminal) captions.push({ x: end.x, y: end.y + 44, text: text.notAPlace, anchor: "middle", tone: "neg" });
      });
      return { w: JOURNEY_W, h: 250, stops, edges, captions };
    }

    case "fork": {
      const y = 150;
      const ordered = topology.trunk.every((s) => s.realm?.order != null)
        ? [...topology.trunk].sort((a, b) => a.realm!.order! - b.realm!.order!)
        : topology.trunk;
      // 岔路从哪一站分出去:岔路第一站的 parent_realm;找不到就从主干最后一站。
      const parent = topology.roads[0]?.stations[0]?.realm?.parent_realm;
      let at = ordered.findIndex((s) => parent != null && (s.id === parent || s.code === parent));
      if (at < 0) at = ordered.length - 1;
      const right = at === ordered.length - 1 ? JOURNEY_W * 0.62 : JOURNEY_W - PAD;
      const xs = spread(ordered.length, PAD, right);
      const trunk = ordered.map((s, i) => stop(s, xs[i], y, "below"));
      const fork = trunk[at];
      const stops = [...trunk];
      const edges = chain(trunk);
      const captions: JCaption[] = [];
      for (const road of topology.roads) {
        const up = road.fork === "RIGHT";
        const ry = up ? y - 74 : y + 74;
        const rxs = spread(road.stations.length, fork.x + 96, JOURNEY_W - PAD, Math.min(fork.x + 120, JOURNEY_W - PAD));
        const run = road.stations.map((s, i) => stop(s, rxs[i], ry, up ? "above" : "below"));
        stops.push(...run);
        edges.push(...chain(run, fork));
        if (run.every((s) => s.route === "off"))
          captions.push({ x: run[run.length - 1].x, y: ry + (up ? -34 : 40), text: text.offRoute, anchor: "end" });
      }
      return { w: JOURNEY_W, h: 290, stops, edges, captions };
    }

    case "funnel": {
      // 左:地狱漏斗,往下收;右:炼狱山 + 天堂,往上收。本人走的那条实 / 虚,另一条点线。
      const down = topology.regions.filter((g) => g.region === "INFERNO").flatMap((g) => g.stations);
      const up = topology.regions.filter((g) => g.region !== "INFERNO").flatMap((g) => g.stations);
      const place = (run: Station[], x0: number, y0: number, x1: number, y1: number, side: "right" | "left") => {
        const xs = spread(run.length, x0, x1);
        const ys = spread(run.length, y0, y1);
        return run.map((s, i) => {
          const out = off.has(s.id);
          // 不在此路的那条只给首尾写名字,免得一屏小字。
          return stop(s, xs[i], ys[i], out && i !== 0 && i !== run.length - 1 ? "none" : side);
        });
      };
      const d = place(down, 84, 58, 300, 250, "right");
      const u = place(up, 430, 250, 620, 58, "left");
      const captions: JCaption[] = [
        { x: 200, y: 284, text: text.region("INFERNO"), anchor: "middle" },
        { x: 540, y: 284, text: `${text.region("PURGATORIO")} → ${text.region("PARADISO")}`, anchor: "middle" },
      ];
      if (u.length && u.every((s) => s.route === "off")) captions.push({ x: 560, y: 40, text: text.offRoute, anchor: "end" });
      if (d.length && d.every((s) => s.route === "off")) captions.push({ x: 140, y: 40, text: text.offRoute, anchor: "start" });
      return { w: JOURNEY_W, h: 300, stops: [...d, ...u], edges: [...chain(d), ...chain(u)], captions, backdrop: "funnel" };
    }
  }
}

/**
 * 工作流实例的节点进度(Design 第二十五批 §五.3):同一套画法,一线。
 * 「退回重审」画成从被退回到的那一站挂下去的点线支线,标次数。次数从 `decision_history` 数:
 * 每次驳回到(`_return_to`)给重开的每个节点写一条带 `round` 的记录,重开的第一站(node_order 最小)
 * 就是退回到的那一站。超时记录没有 `round`,不计。
 */
export function returnCounts(nodes: readonly ApprovalNode[]): Map<string, number> {
  const target = new Map<number, ApprovalNode>();
  for (const n of nodes)
    for (const e of n.decision_history ?? []) {
      const round = (e as { round?: unknown }).round;
      if (typeof round !== "number") continue;
      const was = target.get(round);
      if (!was || n.node_order < was.node_order) target.set(round, n);
    }
  const counts = new Map<string, number>();
  for (const n of target.values()) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
  return counts;
}

export function workflowGraph(
  nodes: readonly ApprovalNode[],
  currentId: string | null,
  end: { label: string; reached: boolean },
  text: { name: (n: ApprovalNode) => string; returned: (n: number) => string },
): JGraph {
  const y = 92;
  const xs = spread(nodes.length + 1, PAD, JOURNEY_W - PAD);
  const stops: JStop[] = nodes.map((n, i) => ({
    id: n.id,
    x: xs[i],
    y,
    state: n.id === currentId ? "current" : n.status === "PENDING" ? "pending" : n.status === "SKIPPED" ? "pending" : "travelled",
    // 跳过的站没走过:点线小圈,不是待行。
    route: n.status === "SKIPPED" && n.id !== currentId ? "off" : "on",
    label: text.name(n),
    labelAt: "below",
  }));
  stops.push({ id: "end", x: xs[nodes.length], y, state: end.reached ? "travelled" : "pending", route: "on", label: end.label, labelAt: "below" });
  // 跳过的站不断开主线:线连到它前后两站。
  const onLine = stops.filter((s) => s.route === "on");
  const edges = chain(onLine);
  const captions: JCaption[] = [];
  const loops = returnCounts(nodes);
  for (const s of [...stops]) {
    const n = loops.get(s.id);
    if (!n) continue;
    const spur: JStop = { id: `${s.id}~loop`, x: s.x + 40, y: y + 52, state: "pending", route: "off", label: "", labelAt: "none", spur: true };
    stops.push(spur);
    edges.push({ id: `${s.id}~loop`, from: s.id, to: spur.id, kind: "off", curve: true });
    captions.push({ x: spur.x + 12, y: spur.y + 4, text: text.returned(n), anchor: "start" });
  }
  return { w: JOURNEY_W, h: loops.size ? 160 : 136, stops, edges, captions };
}
