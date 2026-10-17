import { api } from "./client";
import type { PaginatedResponse } from "./users";

export interface Reincarnation {
  id: string;
  soul: string;
  soul_name?: string;
  /** 灵魂编号(没开过号的为 null);转生登记簿的「灵魂」列。 */
  soul_code?: string | null;
  disposition: string | null;
  target_realm: string;
  rebirth_form: string;
  cycle_count: number;
  previous_realm: string;
  new_identity: string;
  notes: string;
  reincarnated_at: string;
}

export const reincarnationApi = {
  /** 筛选只有后端已有的:`soul`、`rebirth_form`(单值)、`cycle_count`;`ordering` 可按 `reincarnated_at` / `cycle_count`。 */
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Reincarnation>>("/reincarnation/", { params }),
  reborn: (data: object) => api.post<Reincarnation>("/reincarnation/reborn/", data),
};
