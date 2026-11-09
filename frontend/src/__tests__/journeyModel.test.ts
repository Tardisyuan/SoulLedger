/**
 * 行程块(Design 第二十五批)的纯逻辑:本人那条路、「不在此路」、窄屏折叠、标题右侧的计数、
 * 阶段条四格(欧洲、埃及第四格「不轮回」),以及工作流「退回重审」的次数。
 */
import type { ApprovalNode, Realm } from "@soulledger/core/api";
import type { Station, StationState, Topology } from "@/src/lib/routeTopology";
import { collapseRoad, journeyCounts, judgingLine, offRoute, soulRoad, stageStates, stayFrom } from "@/src/lib/journeyModel";
import { returnCounts, topologyGraph, workflowGraph } from "@/src/lib/journeyLayout";
import { wrapLabel } from "@/src/components/journey/JourneyMap";

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
    expect(counts.walked).toBe(3); // c1 + 待审所 + c2(没有记录,但在「现在」之前:已过未登记)
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

describe("wrapLabel (2026-11-10: one-line fit cut every court to 「第一殿秦…」)", () => {
  it("keeps a name that fits on one line", () => {
    expect(wrapLabel("土地庙", 54, 12)).toEqual(["土地庙"]);
  });
  it("breaks after 殿 onto a second line instead of cutting", () => {
    expect(wrapLabel("第一殿秦广王", 54, 12)).toEqual(["第一殿", "秦广王"]);
  });
  it("still ends the second line in … when even two lines are too short", () => {
    const [a, b] = wrapLabel("第十殿转轮王与六道轮回", 40, 12);
    expect(a).toBe("第十殿");
    expect(b.endsWith("…")).toBe(true);
  });
});

describe("implied stops — 已过（未登记）: a soul cannot be past a station it never went through", () => {
  const TEXT = { name: (s: Station) => s.id, notAPlace: "x", offRoute: "off", region: (r: string) => r, fork: (f: string) => f };
  const drawn = (topology: Topology) => {
    const road = soulRoad(topology);
    const graph = topologyGraph(topology, road, TEXT);
    return { road, graph, at: (id: string) => graph.stops.find((s) => s.id === id)! };
  };

  it("Egypt at Aaru with only the entry and the hall recorded: 七道通路 and 二十一道门户 are passed, not ahead", () => {
    const topology: Topology = {
      kind: "fork_two",
      schematic: false,
      trunk: [st("entry", "travelled"), st("seven", "pending"), st("hall", "travelled")],
      roads: [
        { fork: "PASS", terminal: false, stations: [st("gates", "pending"), st("aaru", "current")] },
        { fork: "FAIL", terminal: true, stations: [st("gone", "pending")] },
      ],
      branches: [],
      offShape: [],
    };
    const { road, graph, at } = drawn(topology);
    expect([...road.implied].sort()).toEqual(["gates", "seven"]);
    expect([at("seven").state, at("seven").implied]).toEqual(["travelled", true]);
    expect([at("gates").state, at("gates").implied]).toEqual(["travelled", true]);
    expect(at("hall").implied).toBeUndefined();
    expect(at("gone").route).toBe("off");
    const kind = (id: string) => graph.edges.find((e) => e.id === id)?.kind;
    expect([kind("entry>seven"), kind("seven>hall"), kind("hall>gates"), kind("gates>aaru")]).toEqual(["walked", "walked", "walked", "walked"]);
    expect(journeyCounts(topology, road)).toMatchObject({ walked: 4, remaining: 0 });
  });

  it("Greece at the Isles with only Acheron and the Isles recorded: the meadow is passed (trunk in `order`)", () => {
    const topology: Topology = {
      kind: "fork",
      schematic: false,
      trunk: [st("meadow", "pending", { order: 2 }), st("acheron", "travelled", { order: 1 })],
      roads: [
        { fork: "LEFT", stations: [st("tartarus", "pending")] },
        { fork: "RIGHT", stations: [st("isles", "current")] },
      ],
      branches: [],
      offShape: [],
    };
    const { road, at, graph } = drawn(topology);
    expect(ids(road.stations)).toEqual(["acheron", "meadow", "isles"]);
    expect([...road.implied]).toEqual(["meadow"]);
    expect(at("meadow")).toMatchObject({ state: "travelled", implied: true });
    expect(at("tartarus").route).toBe("off");
    expect(graph.edges.find((e) => e.id === "acheron>meadow")?.kind).toBe("walked");
  });

  it("a line soul with a complete path: nothing implied, states as recorded", () => {
    const topology: Topology = {
      kind: "line",
      schematic: false,
      stations: [st("c1", "travelled"), st("c2", "travelled"), st("c3", "current"), st("c4", "pending")],
      branches: [],
      offShape: [],
    };
    const { road, graph } = drawn(topology);
    expect(road.implied.size).toBe(0);
    expect(graph.stops.map((s) => [s.state, s.implied])).toEqual([
      ["travelled", undefined],
      ["travelled", undefined],
      ["current", undefined],
      ["pending", undefined],
    ]);
  });

  it("nothing walked yet: nothing implied", () => {
    const topology: Topology = { kind: "line", schematic: false, stations: [st("c1", "pending"), st("c2", "pending")], branches: [], offShape: [] };
    expect(soulRoad(topology).implied.size).toBe(0);
  });
});

describe("stayFrom — days under a year, then whole years", () => {
  const now = Date.parse("2026-11-09T00:00:00Z");
  it("counts days below 365", () => {
    expect(stayFrom("2026-11-06T00:00:00Z", now)).toEqual({ unit: "days", n: 3 });
    expect(stayFrom("2025-11-10T00:00:00Z", now)).toEqual({ unit: "days", n: 364 });
  });
  it("switches to whole years (1285 → 741, not 270705 days)", () => {
    expect(stayFrom("2025-11-09T00:00:00Z", now)).toEqual({ unit: "years", n: 1 });
    expect(stayFrom("1285-06-01T00:00:00Z", now)).toEqual({ unit: "years", n: 741 });
  });
  it("no or unreadable start → null, never 0", () => {
    expect(stayFrom(null, now)).toBeNull();
    expect(stayFrom("not a date", now)).toBeNull();
  });
});

describe("judgingLine — the sentence under the title", () => {
  const j = (over: Partial<{ court: string; verdict: unknown; concluded_at: string | null; created_at: string }> = {}) => ({
    court: "第五殿",
    verdict: null,
    concluded_at: null,
    created_at: "2026-06-01T00:00:00Z",
    ...over,
  });
  it("JUDGING with an open case names its court; the latest open case wins", () => {
    expect(judgingLine("JUDGING", "CHINESE", [j({ court: "第一殿" }), j({ created_at: "2026-06-02T00:00:00Z" })])).toEqual({ kind: "court", court: "第五殿" });
  });
  it("Egypt before a verdict: the heart is on the scales", () => {
    expect(judgingLine("JUDGING", "EGYPTIAN", [j({ court: "两真之殿" })])).toEqual({ kind: "weighing" });
    expect(judgingLine("JUDGING", "EGYPTIAN", [j({ verdict: "PASSED" })])).toBeNull();
  });
  it("not judging, only concluded cases, or no court → null (the shape name stays)", () => {
    expect(judgingLine("DISPOSED", "CHINESE", [j()])).toBeNull();
    expect(judgingLine("JUDGING", "CHINESE", [j({ concluded_at: "2026-06-03T00:00:00Z" })])).toBeNull();
    expect(judgingLine("JUDGING", "CHINESE", [j({ court: "  " })])).toBeNull();
  });
});
