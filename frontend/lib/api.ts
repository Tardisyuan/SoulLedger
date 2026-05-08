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
  list: (params?: Record<string, string>) => api.get("/realms/", { params }),
  get: (code: string) => api.get(`/realms/${code}/`),
};

// Actors
export const actorsApi = {
  list: (params?: Record<string, string>) => api.get("/actors/", { params }),
  get: (id: string) => api.get(`/actors/${id}/`),
};

// Judgment
export const judgmentApi = {
  list: (params?: Record<string, string>) => api.get("/judgment/", { params }),
  create: (data: object) => api.post("/judgment/", data),
  conclude: (id: string, data: object) => api.post(`/judgment/${id}/conclude/`, data),
  get: (id: string) => api.get(`/judgment/${id}/`),
};

// Disposition
export const dispositionApi = {
  list: (params?: Record<string, string>) => api.get("/disposition/", { params }),
  execute: (id: string, data?: object) => api.post(`/disposition/${id}/execute/`, data),
};

// Reincarnation
export const reincarnationApi = {
  list: (params?: Record<string, string>) => api.get("/reincarnation/", { params }),
  reborn: (data: object) => api.post("/reincarnation/reborn/", data),
};

// Events
export const eventsApi = {
  list: (params?: Record<string, string>) => api.get("/events/", { params }),
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

export interface Judgment {
  id: string;
  soul: string;
  civilization: string;
  court: string;
  verdict: "PASSED" | "FAILED" | "PURGATORY" | "RETRY" | null;
  is_final: boolean;
  created_at: string;
  concluded_at: string | null;
}

export interface KarmaSummary {
  soul_id: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  total_records: number;
}

export interface SoulRecord {
  id: string;
  soul: string;
  record_type: "MERIT" | "DEMERIT";
  category: string;
  description: string;
  weight: number;
  created_at: string;
}

export interface Disposition {
  id: string;
  soul: string;
  destination_realm: string;
  memory_reset: string;
  is_eternal: boolean;
  is_executed: boolean;
  created_at: string;
}

export interface Reincarnation {
  id: string;
  soul: string;
  target_realm: string;
  rebirth_form: "HUMAN" | "ANIMAL" | "DIVINE" | "OTHER";
  cycle_count: number;
  new_identity: string;
  reincarnated_at: string;
}

export interface SoulEvent {
  id: string;
  soul: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor: string;
  created_at: string;
}
