import { api, API_BASE } from "./client";

async function fetchAllPages<T>(url: string, params: Record<string, string> = {}): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = `${API_BASE}${url}?${new URLSearchParams(params)}`;
  while (nextUrl) {
    const parsed: URL = new URL(nextUrl);
    const searchParams: Record<string, string> = {};
    parsed.searchParams.forEach((v: string, k: string) => { searchParams[k] = v; });
    const relativePath: string = nextUrl.replace(API_BASE, "");
    const resp = await api.get(relativePath, { params: searchParams });
    results.push(...resp.data.results);
    nextUrl = resp.data.next ? (resp.data.next.startsWith("http") ? resp.data.next : `${API_BASE}${resp.data.next}`) : null;
  }
  return results;
}

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
    const data = await fetchAllPages<any>("/realms/", params);
    return { data: { results: data, count: data.length } };
  },
  get: (code: string) => api.get(`/realms/${code}/`),
};
