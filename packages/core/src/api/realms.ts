import { api, fetchAllPages } from "./client";

export interface Realm {
  id: string;
  realm_code: string;
  name: string;
  name_zh?: string;
  name_en?: string;
  name_egy?: string;
  name_local?: string;
  civilization: string;
  realm_type: string;
  tier: number;
  description?: string;
  parent_realm?: string;
  memory_reset_mechanism?: string;
  cycle_limit?: number;
  is_eternal: boolean;
  // ── 行程拓扑(RealmListSerializer 的 TOPOLOGY_FIELDS)。全部可空:一个文明用不
  // 到的列就是 null,意思是「不适用或没有出处」,不是 0。
  // 地府「一线」:殿号 1–10 与站的种类。
  order?: number | null;
  kind?: "HALL" | "GATE" | "LAYER" | "PATH" | null;
  /** 容量;null = 未记录(不是「无限」)。 */
  capacity?: number | null;
  // 《神曲》「漏斗」:圈 / 台阶号、环 / 囊号、属于哪一部。
  level?: number | null;
  sublevel?: number | null;
  region?: "INFERNO" | "PURGATORIO" | "PARADISO" | null;
  // 杜阿特「十二时之河」。种子里 hour / gate 在每一行都是 null —— 那是出处,不是遗漏
  // (见 backend/apps/actors/mythology/realms.py REALM_TOPOLOGY)。
  hour?: number | null;
  gate?: number | null;
  is_judgment_hall?: boolean | null;
  // 冥府「三岔」:出审判处的哪一条路。
  fork?: "LEFT" | "MIDDLE" | "RIGHT" | null;
}

/** One row of `GET /realms/occupancy/` — 在押. A realm absent from the list holds 0. */
export interface RealmOccupancy {
  realm_id: string;
  count: number;
}

export const realmsApi = {
  list: async (params?: Record<string, string>) => {
    const data = await fetchAllPages<Realm>("/realms/", params);
    return { data: { results: data, count: data.length } };
  },
  get: (code: string) => api.get<Realm>(`/realms/${code}/`),
  // Bare array: the action sets `pagination_class=None`.
  occupancy: () => api.get<RealmOccupancy[]>("/realms/occupancy/"),
};
