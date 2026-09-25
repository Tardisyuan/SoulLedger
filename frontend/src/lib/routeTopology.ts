import type { Realm, SoulPathEntry } from "@soulledger/core/api";

/**
 * 行程拓扑 —— 界域页的底图与详情页的行程条共用的**纯**布局(规范 v1 §1.8,第三类 B「界域」)。
 *
 *   界域页    = 这张图(无 path;站按在押填充)
 *   详情行程条 = 这张图 + 一个灵魂的 path
 *
 * 四种形状,一套图例(━ 已行 ┅ 待行 ▪ 现在 □ 站):
 *
 *   CHINESE  一线          `order`(殿号 1–10)
 *   EUROPEAN 漏斗          `region` + `level`(圈 / 台阶)
 *   EGYPTIAN 称心二岔      `order` 排主干(称心 `is_judgment_hall` 加粗),出称心按 `fork`
 *                          分两条:PASS 向上,FAIL 向下、以虚线终点收尾(第二次死亡不是地方)
 *   GREEK    三岔          `fork`(LEFT / RIGHT),其余为主干
 *
 * **形状字段缺失就画「一条线 · 示意」,不猜。** 杜阿特曾是「十二时之河」,要每站一个
 * 《阿姆杜阿特》的时辰;种子的六站出自《亡灵书》,没有公认的站→时对照,`hour` 每行都是
 * null,于是那张图永远是示意线。2026-09-26 改成称心二岔,只用 `order` 与 `fork`
 * (backend/apps/actors/mythology/realms.py REALM_TOPOLOGY)。
 *
 * **规则 16:只有有记录的站画成已行。** 站的状态只从 path 来:`left_at` 有值 =
 * 已行,`left_at` 为空 = 现在,其余一律待行 —— 包括序号在「现在」之前、但 path
 * 里没有记录的殿。一个在第五殿的灵魂,若 path 只记了第五殿,第一至四殿是虚线:
 * 系统不知道它经过了,画成实线就是替它编了一段行程。
 */

export type ShapeKind = "line" | "funnel" | "weighing" | "fork";
export type StationState = "travelled" | "current" | "pending";

export const CIVILIZATION_SHAPE: Record<string, ShapeKind> = {
  CHINESE: "line",
  EUROPEAN: "funnel",
  EGYPTIAN: "weighing",
  GREEK: "fork",
};

export interface Station {
  /** Realm id — or the path entry's id when the realm row is gone. */
  id: string;
  code: string | null;
  realm: Realm | null;
  state: StationState;
}

export type FunnelRegion = "INFERNO" | "PURGATORIO" | "PARADISO";
export type Fork = "LEFT" | "RIGHT";
/** 称心的两个结果。不是柏拉图的左右 —— 见 backend/apps/realms/models.py RealmFork。 */
export type WeighingRoad = "PASS" | "FAIL";

interface Common {
  /** Path stations that have no place on this shape — drawn as ↳ branches. */
  branches: Station[];
  /** Realms of the civilization the shape does not place (map mode only lists them in the table). */
  offShape: Realm[];
}

export type Topology =
  | (Common & { kind: "line"; schematic: boolean; stations: Station[] })
  | (Common & { kind: "funnel"; schematic: false; regions: { region: FunnelRegion; stations: Station[] }[] })
  | (Common & {
      kind: "weighing";
      schematic: false;
      /** By `order`; the last one is the weighing. */
      trunk: Station[];
      /** PASS first (drawn up), FAIL second (drawn down). `terminal`: the road ends in no place — drawn dashed. */
      roads: { fork: WeighingRoad; terminal: boolean; stations: Station[] }[];
    })
  | (Common & { kind: "fork"; schematic: false; trunk: Station[]; roads: { fork: Fork; stations: Station[] }[] });

/** Rule 16: a station's state comes from the path and nowhere else. */
export function stationStates(path: readonly SoulPathEntry[] | null | undefined): Map<string, StationState> {
  const states = new Map<string, StationState>();
  for (const entry of path ?? []) {
    if (!entry.realm_id) continue;
    if (entry.left_at === null) states.set(entry.realm_id, "current");
    else if (states.get(entry.realm_id) !== "current") states.set(entry.realm_id, "travelled");
  }
  return states;
}

const REGION_ORDER: FunnelRegion[] = ["INFERNO", "PURGATORIO", "PARADISO"];
const FORK_ORDER: Fork[] = ["LEFT", "RIGHT"];
const WEIGHING_ROADS: WeighingRoad[] = ["PASS", "FAIL"];

const isSet = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/**
 * Lay out one civilization's realms, optionally with a soul's path.
 *
 * `realms` may hold every civilization; only `civilization`'s rows are placed.
 * A path stop in a realm of another civilization (a transfer) or in a realm the
 * list does not carry is still shown — as a branch, never dropped.
 */
export function buildTopology(
  civilization: string,
  realms: readonly Realm[],
  path?: readonly SoulPathEntry[] | null,
): Topology {
  const own = realms.filter((r) => r.civilization === civilization);
  const byId = new Map(realms.map((r) => [r.id, r]));
  const states = stationStates(path);
  const station = (realm: Realm): Station => ({
    id: realm.id,
    code: realm.realm_code,
    realm,
    state: states.get(realm.id) ?? "pending",
  });

  const placed = placeShape(CIVILIZATION_SHAPE[civilization], own, station);
  const onShape = new Set(placed ? placed.ids : []);

  // Branches: every recorded stop the shape does not place, in path order.
  const branches: Station[] = [];
  const seen = new Set<string>();
  for (const entry of path ?? []) {
    const id = entry.realm_id ?? entry.id;
    if (onShape.has(id) || seen.has(id)) continue;
    seen.add(id);
    const realm = entry.realm_id ? byId.get(entry.realm_id) ?? null : null;
    branches.push({
      id,
      code: entry.realm_code ?? realm?.realm_code ?? null,
      realm,
      state: entry.realm_id ? states.get(entry.realm_id) ?? "travelled" : entry.left_at === null ? "current" : "travelled",
    });
  }

  if (!placed) {
    // 示意:the route itself if there is one, otherwise every realm of the civilization.
    const hasPath = (path ?? []).length > 0;
    return {
      kind: "line",
      schematic: true,
      stations: hasPath ? branches : own.map(station),
      branches: [],
      offShape: [],
    };
  }
  const offShape = own.filter((r) => !onShape.has(r.id));
  return { ...placed.topology, branches, offShape } as Topology;
}

/** `Omit` over each member, not over the union (which would keep only shared keys). */
type ShapeOnly<T = Topology> = T extends Topology ? Omit<T, "branches" | "offShape"> : never;
type Placed = { ids: string[]; topology: ShapeOnly };

function placeShape(
  shape: ShapeKind | undefined,
  own: Realm[],
  station: (r: Realm) => Station,
): Placed | null {
  switch (shape) {
    case "line": {
      const line = own.filter((r) => isSet(r.order)).sort((a, b) => a.order! - b.order!);
      if (!line.length) return null;
      return { ids: line.map((r) => r.id), topology: { kind: "line", schematic: false, stations: line.map(station) } };
    }
    case "funnel": {
      const inRegion = own.filter((r) => isSet(r.region));
      if (!inRegion.some((r) => isSet(r.level))) return null;
      const regions = REGION_ORDER.map((region) => {
        const rows = inRegion.filter((r) => r.region === region);
        const unlevelled = rows.filter((r) => !isSet(r.level));
        const levelled = rows.filter((r) => isSet(r.level)).sort((a, b) => a.level! - b.level!);
        // In walking order: the region's unnumbered entry (the crossing, the
        // shore) first, then circle / terrace 1 upward. The renderer draws
        // Purgatorio summit-first, which is what makes it the inverted funnel.
        return { region, stations: [...unlevelled, ...levelled].map(station) };
      }).filter((g) => g.stations.length > 0);
      return {
        ids: regions.flatMap((g) => g.stations.map((s) => s.id)),
        topology: { kind: "funnel", schematic: false, regions },
      };
    }
    case "weighing": {
      const byOrder = (rows: Realm[]) => rows.filter((r) => isSet(r.order)).sort((a, b) => a.order! - b.order!);
      const trunk = byOrder(own.filter((r) => !isSet(r.fork)));
      const roads = WEIGHING_ROADS.map((fork) => ({
        fork,
        terminal: fork === "FAIL",
        stations: byOrder(own.filter((r) => r.fork === fork)).map(station),
      })).filter((road) => road.stations.length > 0);
      // No trunk (order missing) or no road out of the weighing (fork missing): not this shape.
      if (!trunk.length || !roads.length) return null;
      return {
        ids: [...trunk.map((r) => r.id), ...roads.flatMap((road) => road.stations.map((s) => s.id))],
        topology: { kind: "weighing", schematic: false, trunk: trunk.map(station), roads },
      };
    }
    case "fork": {
      const forked = own.filter((r) => isSet(r.fork));
      if (!forked.length) return null;
      const trunk = own.filter((r) => !isSet(r.fork));
      const roads = FORK_ORDER.map((fork) => ({
        fork,
        stations: forked.filter((r) => r.fork === fork).map(station),
      })).filter((road) => road.stations.length > 0);
      return {
        ids: [...trunk, ...forked].map((r) => r.id),
        topology: { kind: "fork", schematic: false, trunk: trunk.map(station), roads },
      };
    }
    default:
      return null;
  }
}

/**
 * Whether the segment leading into `stations[i]` is drawn solid (━ 已行).
 * Solid only when both ends are recorded stops — rule 16 again: a line between
 * two stations is a claim that the soul walked it.
 */
export function segmentWalked(stations: readonly Station[], i: number): boolean {
  if (i <= 0) return false;
  return stations[i - 1].state !== "pending" && stations[i].state !== "pending";
}
