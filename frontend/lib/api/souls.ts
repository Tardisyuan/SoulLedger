import { api } from "./client";

export interface SoulInput {
  name: string;
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN";
  birth_date: string | null;
  origin_location: string;
  current_state?: "ALIVE" | "JUDGING" | "DISPOSED" | "REINCARNATING" | "LOST";
}

export interface Soul {
  id: string;
  name: string;
  birth_name?: string;
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN";
  current_state: "ALIVE" | "JUDGING" | "DISPOSED" | "REINCARNATING" | "LOST";
  birth_date: string | null;
  death_date: string | null;
  origin_location: string;
  description: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance?: number;
  tenant?: number;
  tenant_code?: string;
  updated_at?: string;
}

// Backward-compatible alias
export type SoulRecord = Soul;

export const soulsApi = {
  list: (params?: {
    page?: number;
    search?: string;
    civilization?: string;
    state?: string;
    karma_min?: number;
    karma_max?: number;
    ordering?: string;
  }) => api.get("/souls/", { params }),
  get: (id: string) => api.get(`/souls/${id}/`),
  create: (data: object) => api.post("/souls/", data),
  update: (id: string, data: Partial<SoulInput>) => api.patch(`/souls/${id}/`, data),
  delete: (id: string) => api.delete(`/souls/${id}/`),
  die: (id: string, data?: object) => api.post(`/souls/${id}/die/`, data),
  transition: (id: string, data: object) => api.post(`/souls/${id}/transition/`, data),
  karma: (id: string) => api.get(`/souls/${id}/karma/`),
  addRecord: (id: string, data: object) => api.post(`/souls/${id}/add_record/`, data),
  records: (id: string) => api.get(`/souls/${id}/records/`),
};
