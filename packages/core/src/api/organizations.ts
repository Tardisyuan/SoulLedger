import axios from "axios";
import { api, fetchAllPages } from "./client";
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
  /** Owning tenant's id (read-only, stamped on create). An ADMIN's list spans every tenant. */
  tenant?: number | null;
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

/** 409 body of DELETE /organizations/{id}/ when the unit still has sub-units, people, or owned souls / judgments. */
export interface OrganizationNotEmpty {
  code: "not_empty";
  units: number;
  people: number;
  souls?: number;
  judgments?: number;
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
  /** `moveTo`:名下灵魂 / 审判先转到这个机构再删(同殿、在自己的数据范围内);不给时有名下数据是 409 `not_empty`。 */
  delete: (id: number, moveTo?: number) =>
    api.delete<void>(`/organizations/${id}/`, moveTo != null ? { params: { move_to: moveTo } } : undefined),
  list: () => api.get<PaginatedResponse<Organization>>("/organizations/"),
  /** Every page, concatenated (page size is fixed at 20 and `?page_size=` is ignored) — for pickers that show the whole tree. */
  all: (): Promise<Organization[]> => fetchAllPages<Organization>("/organizations/"),
  get: (id: number) => api.get<Organization>(`/organizations/${id}/`),
  // Bare array of root nodes — the action returns the serializer data
  // directly (backend/apps/org/views.py:25) and does not nest children.
  tree: () => api.get<Organization[]>("/organizations/tree/"),
};
