import { api } from "./client";

export interface Reincarnation {
  id: string;
  soul: string;
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
  list: (params?: Record<string, string>) => api.get("/reincarnation/", { params }),
  reborn: (data: object) => api.post("/reincarnation/reborn/", data),
};
