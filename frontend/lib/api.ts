import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

// Souls
export const soulsApi = {
  list: (params?: Record<string, string>) => api.get("/souls/", { params }),
  get: (id: string) => api.get(`/souls/${id}/`),
  create: (data: object) => api.post("/souls/", data),
  die: (id: string, data?: object) => api.post(`/souls/${id}/die/`, data),
  transition: (id: string, data: object) => api.post(`/souls/${id}/transition/`, data),
  karma: (id: string) => api.get(`/souls/${id}/karma/`),
  addRecord: (id: string, data: object) => api.post(`/souls/${id}/add_record/`, data),
  records: (id: string) => api.get(`/souls/${id}/records/`),
};

// Realms
export const realmsApi = {
  list: (params?: Record<string, string>) => api.get("/realms/realms/", { params }),
  get: (code: string) => api.get(`/realms/realms/${code}/`),
};

// Actors
export const actorsApi = {
  list: (params?: Record<string, string>) => api.get("/actors/actors/", { params }),
  get: (id: string) => api.get(`/actors/actors/${id}/`),
};

// Judgment
export const judgmentApi = {
  list: (params?: Record<string, string>) => api.get("/judgment/judgment/", { params }),
  create: (data: object) => api.post("/judgment/judgment/", data),
  conclude: (id: string, data: object) => api.post(`/judgment/judgment/${id}/conclude/`, data),
};

// Types
export interface Soul {
  id: string;
  name: string;
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN";
  current_state: "ALIVE" | "JUDGING" | "DISPOSED" | "REINCARNATING" | "LOST";
  birth_date: string | null;
  death_date: string | null;
  origin_location: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  created_at: string;
}

export interface Realm {
  id: string;
  realm_code: string;
  civilization: string;
  name_en: string;
  name_local: string;
  realm_type: "HELL" | "PURGATORY" | "BLISS" | "NEUTRAL";
  tier: number;
  is_eternal: boolean;
}

export interface Actor {
  id: string;
  name: string;
  civilization: string;
  role: string;
  title: string;
}
