import { api, fetchAllPages } from "./client";

export interface Realm {
  id: string;
  realm_code: string;
  name: string;
  name_zh?: string;
  name_en?: string;
  name_egy?: string;
  name_local?: string;
  civilization: string;
  realm_type: string;
  tier: number;
  description?: string;
  parent_realm?: string;
  memory_reset_mechanism?: string;
  cycle_limit?: number;
  is_eternal: boolean;
}

export const realmsApi = {
  list: async (params?: Record<string, string>) => {
    const data = await fetchAllPages<Realm>("/realms/", params);
    return { data: { results: data, count: data.length } };
  },
  get: (code: string) => api.get(`/realms/${code}/`),
};
