import { api, fetchAllPages } from "./client";

export interface Actor {
  id: string;
  name: string;
  name_zh?: string;
  name_en?: string;
  name_egy?: string;
  title?: string;
  title_zh?: string;
  title_en?: string;
  title_egy?: string;
  civilization: string;
  role: string;
  realm?: string;
  realm_code?: string;
  description?: string;
  powers_json?: Record<string, unknown>;
  /**
   * Seat on the Forty-Two Assessors of Ma'at (Book of the Dead ch. 125), or
   * null/absent for an actor who holds none. The list endpoint projects this
   * one key out of `powers_json` — presence tells a bench member apart from a
   * major god, and the value is the order the papyrus seats them in, which is
   * NOT their alphabetical order.
   */
  assessor_index?: number | null;
  icon?: string;
  icon_url?: string;
  is_active: boolean;
}

export const actorsApi = {
  list: async (params?: Record<string, string>) => {
    const data = await fetchAllPages<Actor>("/actors/", params);
    return { data: { results: data, count: data.length } };
  },
  get: (id: string) => api.get<Actor>(`/actors/${id}/`),
};
