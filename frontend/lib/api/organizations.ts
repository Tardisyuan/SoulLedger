import { api } from "./client";

export interface Organization {
  id: number;
  name: string;
  code: string;
  category?: string;
  parent: number | null;
  parent_id?: number | null;
  tenant: number;
  level?: number;
  sort?: number;
  children?: Organization[];
}

export const organizationsApi = {
  list: () => api.get("/organizations/"),
  get: (id: number) => api.get(`/organizations/${id}/`),
  tree: () => api.get("/organizations/tree/"),
};
