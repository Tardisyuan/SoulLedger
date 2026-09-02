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

  /* ── Seven fields `MenuSerializer` sends that this type did not name ──────
   *
   * Found by diffing against `components["schemas"]["Menu"]`: the serializer's
   * `fields` list has eighteen entries and this interface had eleven. Nothing
   * was wrong with the eleven; the other seven were simply invisible to every
   * consumer, so reading one was a type error and the compiler could not
   * suggest it existed.
   *
   * `is_deleted` / `deleted_at` / `delete_reason` are the ones that matter
   * most: the serializer's own comment says the menus page renders a deleted
   * row through them rather than hiding it (Stage 4 §4.7), and a page that
   * wants to do that could not read them from this type.
   *
   * Optional rather than required, deliberately: making them required would be
   * a claim about every object literal that constructs a `MenuItem`, including
   * the ones in tests, and the server-sends-it direction does not need it. */
  /** `apps.menus.models.MenuType`. Written as a literal union, not `string`:
   *  `useSidebarMenus.ts`'s `SidebarMenu` had already narrowed it to these
   *  three, and typing it `string` here made `MenuItem` unassignable to that —
   *  which is how the narrowing was found. Held equal to
   *  `components["schemas"]["MenuTypeEnum"]` by `enumsMatchTheSchema.test.ts`. */
  menu_type?: "DIRECTORY" | "MENU" | "BUTTON";
  permission?: string;
  visible?: boolean;
  cache?: boolean;
  is_deleted?: boolean;
  deleted_at?: string | null;
  delete_reason?: string;
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
