import axios from "axios";
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

/** Writable fields of POST / PATCH /organizations/ (`org.manage`); `level` and `tenant` are server-set. */
export interface OrganizationInput {
  name: string;
  code: string;
  category: string;
  parent: number | null;
  sort?: number;
}

/** 409 body of DELETE /organizations/{id}/ when the unit still has sub-units or people. */
export interface OrganizationNotEmpty {
  code: "not_empty";
  units: number;
  people: number;
}

export function organizationNotEmptyOf(error: unknown): OrganizationNotEmpty | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null;
  const data = error.response.data as Partial<OrganizationNotEmpty> | undefined;
  return data?.code === "not_empty" ? (data as OrganizationNotEmpty) : null;
}

export const organizationsApi = {
  create: (data: OrganizationInput) => api.post<Organization>("/organizations/", data),
  /** Editing and moving are the same PATCH — a move is a changed `parent`. */
  update: (id: number, data: Partial<OrganizationInput>) => api.patch<Organization>(`/organizations/${id}/`, data),
  delete: (id: number) => api.delete<void>(`/organizations/${id}/`),
  list: () => api.get<PaginatedResponse<Organization>>("/organizations/"),
  get: (id: number) => api.get<Organization>(`/organizations/${id}/`),
  // Bare array of root nodes — the action returns the serializer data
  // directly (backend/apps/org/views.py:25) and does not nest children.
  tree: () => api.get<Organization[]>("/organizations/tree/"),
};
