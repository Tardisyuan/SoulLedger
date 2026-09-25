/**
 * src/lib/routeTopology.ts —— 四种形状、「示意」退化,以及规则 16(只有有记录的站
 * 画成已行)。夹具的拓扑列照 backend/apps/actors/mythology/realms.py
 * REALM_TOPOLOGY 取值:杜阿特是「称心二岔」(order + fork PASS / FAIL),hour 每一行都是 null。
 */
import type { Realm, SoulPathEntry } from "@soulledger/core/api";
import { buildTopology, segmentWalked, stationStates } from "@/src/lib/routeTopology";

let n = 0;
function realm(civilization: string, code: string, extra: Partial<Realm> = {}): Realm {
  n += 1;
  return {
    id: code,
    realm_code: code,
    name: code,
    civilization,
    realm_type: "NEUTRAL",
    tier: n,
    is_eternal: false,
    ...extra,
  };
}

function stop(realmId: string | null, sequence: number, open = false): SoulPathEntry {
  return {
    id: `e${sequence}`,
    sequence,
    realm_id: realmId,
    realm_code: realmId,
    entered_at: `2026-06-0${sequence}T00:00:00Z`,
    left_at: open ? null : `2026-06-0${sequence + 1}T00:00:00Z`,
  };
}

const COURTS = Array.from({ length: 10 }, (_, i) => realm("CHINESE", `DY_COURT_${i + 1}`, { order: i + 1, kind: "HALL" }));
const PEN = realm("CHINESE", "DY_00_PURGATORY");
const EUROPE = [
  realm("EUROPEAN", "EU_ACHERON", { region: "INFERNO" }),
  realm("EUROPEAN", "EU_HELL_2ND", { region: "INFERNO", level: 2 }),
  realm("EUROPEAN", "EU_HELL_1ST", { region: "INFERNO", level: 1 }),
  realm("EUROPEAN", "EU_PURGATORY", { region: "PURGATORIO" }),
  realm("EUROPEAN", "EU_T1", { region: "PURGATORIO", level: 1 }),
  realm("EUROPEAN", "EU_HEAVEN", { region: "PARADISO" }),
  realm("EUROPEAN", "EU_LIMBO_UNPLACED"),
];
// Deliberately not in route order: the layout must sort by `order`, not trust the list.
const EGYPT = [
  realm("EGYPTIAN", "EG_AARU", { is_judgment_hall: false, order: 5, fork: "PASS" }),
  realm("EGYPTIAN", "EG_HALL_TWO_TRUTHS", { is_judgment_hall: true, order: 3 }),
  realm("EGYPTIAN", "EG_ANNIHILATION", { is_judgment_hall: false, order: 4, fork: "FAIL" }),
  realm("EGYPTIAN", "EG_SEVEN_ARRWT", { is_judgment_hall: false, order: 2 }),
  realm("EGYPTIAN", "EG_TWENTYONE_SEBKHET", { is_judgment_hall: false, order: 4, fork: "PASS" }),
  realm("EGYPTIAN", "EG_DUAT_ENTRY", { is_judgment_hall: false, order: 1 }),
];
/** The Duat with shape fields stripped — what a database without realms/0022 serves. */
const bare = (rows: Realm[], fields: readonly ("order" | "fork")[]) =>
  rows.map((r) => ({ ...r, ...Object.fromEntries(fields.map((f) => [f, null])) }));
const GREECE = [
  realm("GREEK", "GR_ACHERON"),
  realm("GREEK", "GR_TARTARUS", { fork: "LEFT" }),
  realm("GREEK", "GR_ISLES_OF_THE_BLESSED", { fork: "RIGHT" }),
];
const ALL = [...COURTS, PEN, ...EUROPE, ...EGYPT, ...GREECE];

describe("rule 16 — a station's state comes only from the path", () => {
  it("marks left stops travelled and the open one current; nothing else", () => {
    const states = stationStates([stop("A", 1), stop("B", 2, true)]);
    expect(Object.fromEntries(states)).toEqual({ A: "travelled", B: "current" });
  });

  it("keeps a revisited realm current when its latest stop is open", () => {
    const states = stationStates([stop("A", 1), stop("B", 2), stop("A", 3, true)]);
    expect(states.get("A")).toBe("current");
  });

  it("does not draw unrecorded earlier courts as walked, and draws no solid line into them", () => {
    const topo = buildTopology("CHINESE", ALL, [stop("DY_COURT_1", 1), stop("DY_COURT_5", 2, true)]);
    if (topo.kind !== "line") throw new Error(topo.kind);
    const states = topo.stations.map((s) => s.state);
    expect(states.slice(0, 6)).toEqual(["travelled", "pending", "pending", "pending", "current", "pending"]);
    expect(segmentWalked(topo.stations, 1)).toBe(false);
    expect(segmentWalked(topo.stations, 4)).toBe(false);
  });

  it("draws a solid segment only between two recorded neighbours", () => {
    const topo = buildTopology("CHINESE", ALL, [stop("DY_COURT_1", 1), stop("DY_COURT_2", 2, true)]);
    if (topo.kind !== "line") throw new Error(topo.kind);
    expect(segmentWalked(topo.stations, 1)).toBe(true);
    expect(segmentWalked(topo.stations, 2)).toBe(false);
  });
});

describe("the four shapes", () => {
  it("一线: courts by order; the holding pen is a branch when walked, off-shape otherwise", () => {
    const map = buildTopology("CHINESE", ALL);
    expect(map.kind).toBe("line");
    expect(map.schematic).toBe(false);
    if (map.kind !== "line") return;
    expect(map.stations.map((s) => s.code)).toEqual(COURTS.map((c) => c.realm_code));
    expect(map.offShape.map((r) => r.realm_code)).toEqual(["DY_00_PURGATORY"]);
    expect(map.branches).toEqual([]);

    const route = buildTopology("CHINESE", ALL, [stop("DY_00_PURGATORY", 1, true)]);
    expect(route.branches.map((b) => [b.code, b.state])).toEqual([["DY_00_PURGATORY", "current"]]);
  });

  it("漏斗: regions in canticle order, each entry first then by level; an unplaced realm is off-shape", () => {
    const topo = buildTopology("EUROPEAN", ALL);
    if (topo.kind !== "funnel") throw new Error(topo.kind);
    expect(topo.regions.map((g) => [g.region, g.stations.map((s) => s.code)])).toEqual([
      ["INFERNO", ["EU_ACHERON", "EU_HELL_1ST", "EU_HELL_2ND"]],
      ["PURGATORIO", ["EU_PURGATORY", "EU_T1"]],
      ["PARADISO", ["EU_HEAVEN"]],
    ]);
    expect(topo.offShape.map((r) => r.realm_code)).toEqual(["EU_LIMBO_UNPLACED"]);
  });

  it("称心二岔: the trunk by order ends at the weighing; PASS then FAIL out of it; FAIL is the dashed terminal", () => {
    const topo = buildTopology("EGYPTIAN", ALL);
    if (topo.kind !== "fork_two") throw new Error(topo.kind);
    expect(topo.schematic).toBe(false);
    expect(topo.trunk.map((s) => s.code)).toEqual(["EG_DUAT_ENTRY", "EG_SEVEN_ARRWT", "EG_HALL_TWO_TRUTHS"]);
    expect(topo.trunk[topo.trunk.length - 1].realm?.is_judgment_hall).toBe(true);
    expect(topo.roads.map((r) => [r.fork, r.terminal, r.stations.map((s) => s.code)])).toEqual([
      ["PASS", false, ["EG_TWENTYONE_SEBKHET", "EG_AARU"]],
      ["FAIL", true, ["EG_ANNIHILATION"]],
    ]);
    // 二十一道门户只在「过」那条路上;第二次死亡不在主干上。
    expect(topo.trunk.map((s) => s.code)).not.toContain("EG_TWENTYONE_SEBKHET");
    expect(topo.trunk.map((s) => s.code)).not.toContain("EG_ANNIHILATION");
    expect(topo.offShape).toEqual([]);
  });

  it("称心二岔 on a route: states still come only from the path", () => {
    const topo = buildTopology("EGYPTIAN", ALL, [
      stop("EG_DUAT_ENTRY", 1),
      stop("EG_HALL_TWO_TRUTHS", 2),
      stop("EG_ANNIHILATION", 3, true),
    ]);
    if (topo.kind !== "fork_two") throw new Error(topo.kind);
    expect(topo.trunk.map((s) => s.state)).toEqual(["travelled", "pending", "travelled"]);
    expect(topo.roads.map((r) => r.stations.map((s) => s.state))).toEqual([["pending", "pending"], ["current"]]);
    expect(topo.branches).toEqual([]);
  });

  it("三岔: the unforked rows are the trunk, the forked ones the roads, LEFT before RIGHT", () => {
    const topo = buildTopology("GREEK", ALL, [stop("GR_ACHERON", 1), stop("GR_ISLES_OF_THE_BLESSED", 2, true)]);
    if (topo.kind !== "fork") throw new Error(topo.kind);
    expect(topo.trunk.map((s) => [s.code, s.state])).toEqual([["GR_ACHERON", "travelled"]]);
    expect(topo.roads.map((r) => [r.fork, r.stations.map((s) => s.state)])).toEqual([
      ["LEFT", ["pending"]],
      ["RIGHT", ["current"]],
    ]);
  });
});

describe("「示意」— shape fields missing fall back to the line and say so", () => {
  it.each([
    ["fork", ["fork"]],
    ["order", ["order"]],
    ["order and fork", ["order", "fork"]],
  ] as const)("draws the Duat without %s as a schematic line of all its realms", (_label, fields) => {
    const topo = buildTopology("EGYPTIAN", bare(EGYPT, fields));
    expect(topo.kind).toBe("line");
    expect(topo.schematic).toBe(true);
    if (topo.kind === "line") expect(topo.stations.map((s) => s.code)).toEqual(EGYPT.map((r) => r.realm_code));
  });

  it("on a route, the schematic line is the path itself — recorded stops only", () => {
    const realms = bare(EGYPT, ["order", "fork"]);
    const topo = buildTopology("EGYPTIAN", realms, [stop("EG_DUAT_ENTRY", 1), stop("EG_HALL_TWO_TRUTHS", 2, true)]);
    if (topo.kind !== "line") throw new Error(topo.kind);
    expect(topo.schematic).toBe(true);
    expect(topo.stations.map((s) => [s.code, s.state])).toEqual([
      ["EG_DUAT_ENTRY", "travelled"],
      ["EG_HALL_TWO_TRUTHS", "current"],
    ]);
    expect(topo.stations.map((s) => s.code)).not.toContain("EG_AARU");
  });

  it("falls back for a civilization with no shape at all", () => {
    expect(buildTopology("MARTIAN", [realm("MARTIAN", "M1")]).schematic).toBe(true);
  });

  it("keeps a stop whose realm row is gone, labelled by the entry", () => {
    const topo = buildTopology("CHINESE", ALL, [{ ...stop(null, 1, true), realm_code: null }]);
    expect(topo.branches).toHaveLength(1);
    expect(topo.branches[0].state).toBe("current");
  });
});
