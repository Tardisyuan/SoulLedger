import { api } from "./client";
import type { PaginatedResponse } from "./users";

/**
 * SoulEventSerializer (backend/apps/events/serializers.py:9).
 *
 * The timestamp key is `create_time`. `created_at` was declared required here
 * and is not a field on the serializer at all — it never arrives.
 */
export interface SoulEvent {
  id: string;
  soul: string;
  soul_name?: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor: string;
  create_time: string;
}

export const eventsApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<SoulEvent>>("/events/", { params }),
};
