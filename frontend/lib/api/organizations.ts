import { api } from "./client";
import type { PaginatedResponse } from "./users";

/**
 * OrganizationSerializer (backend/apps/org/serializers.py:9) sends exactly
 * five keys: id, name, code, category, parent.
 *
 * `tenant` was declared required here and is not serialized at all.
 * `parent_id`, `level` and `sort` are likewise absent — they are kept, and
 * kept optional, only because app/organizations/page.tsx still reads all
 * three. They are always undefined at runtime; see the note there.
 */
export interface Organization {
  id: number;
  name: string;
  code: string;
  category?: string;
  parent: number | null;
  /** Not serialized — the FK arrives as `parent`. Always undefined. */
  parent_id?: number | null;
  /** Not serialized. Always undefined. */
  level?: number;
  /** Not serialized. Always undefined. */
  sort?: number;
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
