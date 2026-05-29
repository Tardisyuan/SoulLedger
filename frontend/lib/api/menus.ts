import { api } from "./client";

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
  all: () => api.get("/menus/list-public/"),
  list: (params?: Record<string, string>) => api.get("/menus/", { params }),
  get: (id: number) => api.get(`/menus/${id}/`),
  create: (data: Partial<MenuItem>) => api.post("/menus/", data),
  update: (id: number, data: Partial<MenuItem>) => api.patch(`/menus/${id}/`, data),
  delete: (id: number) => api.delete(`/menus/${id}/`),
};

export const menuButtonsApi = {
  list: (menuId?: number) => api.get("/menus/buttons/", { params: menuId ? { menu: menuId } : {} }),
  create: (data: Partial<MenuButton>) => api.post("/menus/buttons/", data),
  update: (id: number, data: Partial<MenuButton>) => api.patch(`/menus/buttons/${id}/`, data),
  delete: (id: number) => api.delete(`/menus/buttons/${id}/`),
};
