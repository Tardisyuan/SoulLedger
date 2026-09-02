import { api } from "./client";
import type { PaginatedResponse } from "./users";

/**
 * OrganizationSerializer (backend/apps/org/serializers.py:9) sends:
 * id, name, code, category, parent, level, sort.
 *
 * `parent` is the parent organization's ID (or null for root nodes).
 * `level` is auto-computed on the backend based on parent hierarchy.
 * `sort` is a manual ordering field for organizations at the same level.
 */
export interface Organization {
  id: number;
  name: string;
  code: string;
  category?: string;
  parent: number | null;
  level: number;
  sort: number;
  /** Assembled client-side by buildTree; never sent by the API. */
  children?: Organization[];
}

export const organizationsApi = {
  list: () => api.get<PaginatedResponse<Organization>>("/organizations/"),
  get: (id: number) => api.get<Organization>(`/organizations/${id}/`),
  // Bare array of root nodes — the action returns the serializer data
  // directly (backend/apps/org/views.py:25) and does not nest children.
  tree: () => api.get<Organization[]>("/organizations/tree/"),
};
