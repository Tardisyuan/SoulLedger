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
