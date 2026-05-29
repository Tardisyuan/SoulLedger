import { api, API_BASE } from "./client";

async function fetchAllPages<T>(url: string, params: Record<string, string> = {}): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = `${API_BASE}${url}?${new URLSearchParams(params)}`;
  while (nextUrl) {
    const parsed = new URL(nextUrl);
    const searchParams: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => { searchParams[k] = v; });
    const relativePath = nextUrl.replace(API_BASE, "");
    const resp = await api.get(relativePath, { params: searchParams });
    results.push(...resp.data.results);
    nextUrl = resp.data.next ? (resp.data.next.startsWith("http") ? resp.data.next : `${API_BASE}${resp.data.next}`) : null;
  }
  return results;
}

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
    const data = await fetchAllPages<any>("/actors/", params);
    return { data: { results: data, count: data.length } };
  },
  get: (id: string) => api.get(`/actors/${id}/`),
};
