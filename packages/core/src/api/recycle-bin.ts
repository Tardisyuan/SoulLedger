import { api } from "./client";

/**
 * One row in the global recycle bin (Stage 4 §4.7) — a soft-deleted PARENT
 * record, never one of its cascaded dependents. `dependent_count` is how
 * many other rows (across every soft-deletable model) share this entry's
 * cascade_id, so a soul's 8 cascaded karma/judgment rows show up as one
 * bin entry with "含 8 项关联", not eight separate rows.
 *
 * Mirrors apps.core.recycle_bin.list_bin_entries() on the backend exactly
 * — see that module for the kind/retention/hard-delete semantics.
 */
export interface RecycleBinEntry {
  entity_type: string;
  kind: "reference" | "domain";
  id: string | number;
  label: string;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string;
  cascade_id: string | null;
  dependent_count: number;
  retention_days: number | null;
  hard_delete_eligible: boolean;
}

export interface RecycleBinListResponse {
  results: RecycleBinEntry[];
  count: number;
}

export interface RestoreResponse {
  restored: number;
}

export const recycleBinApi = {
  list: () => api.get<RecycleBinListResponse>("/recycle-bin/"),
  restore: (cascadeId: string) =>
    api.post<RestoreResponse>("/recycle-bin/restore/", { cascade_id: cascadeId }),
  hardDelete: (entityType: string, id: string | number) =>
    api.post<void>("/recycle-bin/hard-delete/", { entity_type: entityType, id }),
};
