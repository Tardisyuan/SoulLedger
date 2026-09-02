import { api } from "./client";
import type { PaginatedResponse } from "./users";

export interface MenuItem {
  id: number;
  name: string;
  path: string;
  icon: string | null;
  order: number;
  component: string | null;
  roles: string[];
  is_active: boolean;
  parent: number | null;
  children?: MenuItem[];
  buttons?: MenuButton[];
}

export interface MenuButton {
  id: number;
  name: string;
  code: string;
  permission: string;
  order: number;
  is_active: boolean;
  menu?: number | null;
}

export const menusApi = {
  // list-public/ is an @action that builds and returns the array itself
  // (backend/apps/menus/views.py:149) — bare, unlike the viewset's own list.
  all: () => api.get<MenuItem[]>("/menus/list-public/"),
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<MenuItem>>("/menus/", { params }),
  get: (id: number) => api.get<MenuItem>(`/menus/${id}/`),
  create: (data: Partial<MenuItem>) => api.post<MenuItem>("/menus/", data),
  update: (id: number, data: Partial<MenuItem>) => api.patch<MenuItem>(`/menus/${id}/`, data),
  delete: (id: number) => api.delete<void>(`/menus/${id}/`),
};

export const menuButtonsApi = {
  list: (menuId?: number, page?: number) =>
    api.get<PaginatedResponse<MenuButton>>("/menus/buttons/", {
      params: {
        ...(menuId ? { menu: menuId } : {}),
        ...(page ? { page } : {}),
      },
    }),
  create: (data: Partial<MenuButton>) => api.post<MenuButton>("/menus/buttons/", data),
  update: (id: number, data: Partial<MenuButton>) => api.patch<MenuButton>(`/menus/buttons/${id}/`, data),
  delete: (id: number) => api.delete<void>(`/menus/buttons/${id}/`),
};
