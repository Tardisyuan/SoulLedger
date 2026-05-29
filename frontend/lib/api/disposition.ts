import { api } from "./client";

export interface Disposition {
  id: string;
  soul: string;
  judgment: string;
  destination_realm: string | null;
  is_eternal: boolean;
  is_executed: boolean;
  executed_at: string | null;
  memory_reset: string;
  notes: string;
  created_at: string;
}

export const dispositionApi = {
  list: (params?: Record<string, string>) => api.get("/disposition/", { params }),
  execute: (id: string, data?: object) => api.post(`/disposition/${id}/execute/`, data),
};
