import { api } from "./client";

export interface SoulEvent {
  id: string;
  soul: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor: string;
  created_at: string;
  create_time?: string;
}

export const eventsApi = {
  list: (params?: Record<string, string>) => api.get("/events/", { params }),
};
