/**
 * 行程块(Design 第二十五批)的纯逻辑:本人那条路、「不在此路」、窄屏折叠、标题右侧的计数、
 * 阶段条四格(欧洲、埃及第四格「不轮回」),以及工作流「退回重审」的次数。
 */
import type { ApprovalNode, Realm } from "@soulledger/core/api";
import type { Station, StationState, Topology } from "@/src/lib/routeTopology";
import { collapseRoad, journeyCounts, offRoute, soulRoad, stageStates } from "@/src/lib/journeyModel";
import { returnCounts, workflowGraph } from "@/src/lib/journeyLayout";

const st = (id: string, state: StationState, realm: Partial<Realm> = {}): Station => ({
  id,
  code: id,
  realm: { id, realm_code: id, name: id, civilization: "X", realm_type: "NEUTRAL", tier: 1, is_eternal: false, ...realm } as Realm,
  state,
});
const ids = (stations: Station[]) => stations.map((s) => s.id);

describe("collapseRoad — keep first, previous, current, next, last; fold runs of two or more", () => {
  it("folds the walked middle and the pending middle into one pill each", () => {
    const states: StationState[] = ["travelled", "travelled", "travelled", "travelled", "travelled", "current", "pending", "pending", "pending", "pending"];
    expect(collapseRoad(states)).toEqual([
      { kind: "stop", index: 0 },
      { kind: "fold", state: "travelled", from: 1, to: 3 },
      { kind: "stop", index: 4 },
      { kind: "stop", index: 5 },
      { kind: "stop", index: 6 },
      { kind: "fold", state: "pending", from: 7, to: 8 },
      { kind: "stop", index: 9 },
    ]);
  });

  it("does not fold a single hidden station — it is drawn", () => {
    expect(collapseRoad(["travelled", "travelled", "travelled", "current", "pending"])).toEqual([0, 1, 2, 3, 4].map((index) => ({ kind: "stop", index })));
  });

  it("splits a hidden run where the state changes (rule 16: an unrecorded stop is pending even before 现在)", () => {
    const items = collapseRoad(["travelled", "travelled", "travelled", "pending", "pending", "travelled", "current", "pending"]);
    expect(items.filter((i) => i.kind === "fold")).toEqual([
      { kind: "fold", state: "travelled", from: 1, to: 2 },
      { kind: "fold", state: "pending", from: 3, to: 4 },
    ]);
  });

  it("anchors on the last walked stop when nothing is current, and keeps short roads whole", () => {
    expect(collapseRoad(["travelled", "pending", "pending", "pending", "pending"]).map((i) => i.kind)).toEqual(["stop", "stop", "fold", "stop"]);
    expect(collapseRoad([])).toEqual([]);
    expect(collapseRoad(["current"])).toEqual([{ kind: "stop", index: 0 }]);
  });
});

describe("soulRoad / offRoute — which road is the soul's", () => {
  const fork2 = (pass: StationState[], fail: StationState): Topology => ({
    kind: "fork_two",
    schematic: false,
    trunk: [st("in", "travelled"), st("hall", pass.every((p) => p === "pending") && fail === "pending" ? "current" : "travelled")],
    roads: [
      { fork: "PASS", terminal: false, stations: [st("gates", pass[0]), st("reeds", pass[1])] },
      { fork: "FAIL", terminal: true, stations: [st("gone", fail)] },
    ],
    branches: [],
    offShape: [],
  });

  it("称心未定: both roads stay ahead (not off), with two tails, and the count says 之后两条路之一", () => {
    const topology = fork2(["pending", "pending"], "pending");
    const road = soulRoad(topology);
    expect(ids(road.stations)).toEqual(["in", "hall"]);
    expect(road.decided).toBe(false);
    expect(offRoute(road).size).toBe(0);
    expect(road.tails.map((t) => [t.station.id, t.terminal])).toEqual([["reeds", false], ["gone", true]]);
    expect(journeyCounts(topology, road)).toMatchObject({ walked: 1, remaining: 0, end: null, twoRoads: true });
  });

  it("称心已定: the walked road joins the soul's road, the other is off this route", () => {
    const road = soulRoad(fork2(["pending", "pending"], "current"));
    expect(ids(road.stations)).toEqual(["in", "hall", "gone"]);
    expect([...offRoute(road)].sort()).toEqual(["gates", "reeds"]);
  });

  it("Greek forks not walked are off this route at once (user decision: Tartarus is dotted, not ahead)", () => {
    const topology: Topology = {
      kind: "fork",
      schematic: false,
      trunk: [st("acheron", "travelled"), st("meadow", "current")],
      roads: [
        { fork: "LEFT", stations: [st("tartarus", "pending")] },
        { fork: "RIGHT", stations: [st("isles", "pending")] },
      ],
      branches: [],
      offShape: [],
    };
    const road = soulRoad(topology);
    expect(ids(road.stations)).toEqual(["acheron", "meadow"]);
    expect([...offRoute(road)].sort()).toEqual(["isles", "tartarus"]);
  });

  it("Europe: walking down makes the mountain off; walking nothing yet leaves it ahead", () => {
    const funnel = (inferno: StationState, purg: StationState): Topology => ({
      kind: "funnel",
      schematic: false,
      regions: [
        { region: "INFERNO", stations: [st("acheron", inferno), st("c9", "pending")] },
        { region: "PURGATORIO", stations: [st("shore", purg)] },
        { region: "PARADISO", stations: [st("heaven", "pending")] },
      ],
      branches: [],
      offShape: [],
    });
    const down = soulRoad(funnel("current", "pending"));
    expect(ids(down.stations)).toEqual(["acheron", "c9"]);
    expect([...offRoute(down)].sort()).toEqual(["heaven", "shore"]);
    const up = soulRoad(funnel("pending", "travelled"));
    expect(ids(up.stations)).toEqual(["shore", "heaven"]);
    expect([...offRoute(up)].sort()).toEqual(["acheron", "c9"]);
    expect(offRoute(soulRoad(funnel("pending", "pending"))).size).toBe(0);
  });
});

describe("journeyCounts — the title's right-hand count", () => {
  it("counts walked stops on the road and on branches, and what is left to the end", () => {
    const topology: Topology = {
      kind: "line",
      schematic: false,
      stations: [st("c1", "travelled"), st("c2", "pending"), st("c3", "current"), st("c4", "pending"), st("c5", "pending")],
      branches: [st("pen", "travelled")],
      offShape: [],
    };
    const counts = journeyCounts(topology, soulRoad(topology));
    expect(counts.walked).toBe(2); // c1 + 待审所;c2 没有记录,不算(规则 16)
    expect(counts.current?.id).toBe("c3");
    expect(counts.remaining).toBe(2);
    expect(counts.end?.id).toBe("c5");
    expect(counts.twoRoads).toBe(false);
  });

  it("finds 现在 on a branch when the soul stands off the line", () => {
    const topology: Topology = { kind: "line", schematic: false, stations: [st("c1", "travelled")], branches: [st("hells", "current")], offShape: [] };
    expect(journeyCounts(topology, soulRoad(topology)).current?.id).toBe("hells");
  });
});

describe("stageStates — the stage bar's four cells", () => {
  it("draws the fourth cell not-applicable for Europe and Egypt, whatever its status", () => {
    expect(stageStates(["done", "done", "current", "future"], "EUROPEAN")).toEqual(["done", "done", "current", "na"]);
    expect(stageStates(["done", "done", "current", "future"], "EGYPTIAN")).toEqual(["done", "done", "current", "na"]);
  });

  it("leaves the wheel alone where there is one", () => {
    expect(stageStates(["done", "done", "done", "current"], "CHINESE")).toEqual(["done", "done", "done", "current"]);
    expect(stageStates(["done", "done", "current", "future"], "GREEK")).toEqual(["done", "done", "current", "future"]);
  });
});

describe("workflow returns — 退回重审 spurs", () => {
  const node = (id: string, order: number, status: string, history: Record<string, unknown>[] = []) =>
    ({ id, node_order: order, status, node_name: id, decision_history: history }) as unknown as ApprovalNode;

  it("credits each round to the earliest node it re-opened; timeouts do not count", () => {
    const nodes = [
      node("a", 1, "APPROVED", [{ round: 1 }, { round: 2 }]),
      node("b", 2, "APPROVED", [{ round: 1 }, { round: 2 }, { round: 3 }, { event: "timeout_failed" }]),
      node("c", 3, "PENDING", [{ round: 3 }]),
    ];
    expect(Object.fromEntries(returnCounts(nodes))).toEqual({ a: 2, b: 1 });
  });

  it("draws the line with an end stop, skipped nodes off the line, and one spur per returned node", () => {
    const nodes = [node("a", 1, "APPROVED", [{ round: 1 }]), node("s", 2, "SKIPPED"), node("b", 3, "PENDING")];
    const graph = workflowGraph(nodes, "b", { label: "end", reached: false }, { name: (n) => n.id, returned: (n) => `x${n}` });
    expect(graph.stops.filter((s) => !s.spur).map((s) => [s.id, s.state, s.route])).toEqual([
      ["a", "travelled", "on"],
      ["s", "pending", "off"],
      ["b", "current", "on"],
      ["end", "pending", "on"],
    ]);
    expect(graph.edges.map((e) => [e.id, e.kind])).toEqual([
      ["a>b", "walked"],
      ["b>end", "ahead"],
      ["a~loop", "off"],
    ]);
    expect(graph.captions.map((c) => c.text)).toEqual(["x1"]);
  });
});
