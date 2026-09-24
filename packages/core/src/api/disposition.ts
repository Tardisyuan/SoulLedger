import { api } from "./client";
import type { PaginatedResponse } from "./users";

export interface Disposition {
  id: string;
  soul: string;
  judgment: string;
  destination_realm: string | null;
  // Read-only display names the serializer joins in alongside the raw FK ids
  // (soul.name / destination_realm.realm_code / destination_realm.name_en).
  // Optional because they're null whenever the related row is missing.
  soul_name?: string;
  realm_code?: string;
  realm_name?: string;
  is_eternal: boolean;
  is_executed: boolean;
  executed_at: string | null;
  memory_reset: string;
  sentence_years?: number | null;
  /**
   * When the term began being counted (DispositionSerializer's HistoricalDateField
   * over term_start_year/month/day — BCE-capable, so a signed year). Null = not
   * recorded; it is deliberately NOT derived from `executed_at` (see the model).
   */
  term_start?: { year: number; month: number | null; day: number | null } | null;
  notes: string;
  created_at: string;
}

export const dispositionApi = {
  // DispositionViewSet is a plain ModelViewSet, so `list` goes through the
  // project-wide PageNumberPagination — the envelope, not a bare array.
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Disposition>>("/disposition/", { params }),
  execute: (id: string, data?: object) => api.post<Disposition>(`/disposition/${id}/execute/`, data),
};
