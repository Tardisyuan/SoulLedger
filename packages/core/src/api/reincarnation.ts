import { api } from "./client";
import type { PaginatedResponse } from "./users";

export interface Reincarnation {
  id: string;
  soul: string;
  soul_name?: string;
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
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Reincarnation>>("/reincarnation/", { params }),
  reborn: (data: object) => api.post<Reincarnation>("/reincarnation/reborn/", data),
};
