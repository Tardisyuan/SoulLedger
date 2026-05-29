import { api } from "./client";

export interface Judgment {
  id: string;
  soul: string;
  soul_name?: string;
  judge?: string;
  judge_name?: string;
  verdict: string | null;
  judgment_method: string;
  civilization?: string;
  court?: string;
  notes: string;
  is_final: boolean;
  concluded_at: string | null;
  created_at: string;
  evidence_json?: Record<string, unknown>;
  confession?: string;
}

export const judgmentApi = {
  list: (params?: Record<string, string>) => api.get("/judgment/", { params }),
  create: (data: object) => api.post("/judgment/", data),
  conclude: (id: string, data: object) => api.post(`/judgment/${id}/conclude/`, data),
  get: (id: string) => api.get(`/judgment/${id}/`),
};
