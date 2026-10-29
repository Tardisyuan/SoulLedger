"use client";

import { useQuery } from "@tanstack/react-query";
import { menusApi, type MenuItem } from "@soulledger/core/api";
import { menuKeys } from "@soulledger/core/query_keys";
import { useTenant } from "@/src/contexts/TenantContext";

/**
 * MenuItem 加上两个后端已经在返回、但 lib/api 的类型里还没登记的字段。
 * menus 序列化器（MenuSerializer / MenuTreeSerializer）的 fields 里都有它们。
 */
export type SidebarMenu = MenuItem & {
  menu_type?: "DIRECTORY" | "MENU" | "BUTTON";
  visible?: boolean;
  children?: SidebarMenu[];
};

/** 目录（分组）本身不是页面，没有可跳转的 path。 */
export const isDirectory = (menu: Pick<SidebarMenu, "menu_type" | "path">) =>
  menu.menu_type === "DIRECTORY" || !menu.path;

/**
 * 侧边栏数据归一化。
 *
 * 两件事：
 * 1. 只保留一级项。/menus/list-public/ 本来就只返回一级;这一步是兜底 ——
 *    若换回返回拉平全量的 /menus/,子菜单会既嵌在 children 里又作为独立条目
 *    出现在顶层,分组后每个子项都会重复渲染一次。
 * 2. 去掉 visible=false 的项（欢迎页 / 个人资料 / 通知中心），这三处
 *    在顶栏或右上角已有入口。后端没有对该字段做过滤，只能在这里处理。
 */
function normalizeMenus(items: SidebarMenu[]): SidebarMenu[] {
  const prune = (nodes: SidebarMenu[]): SidebarMenu[] =>
    nodes
      .filter((m) => m.visible !== false)
      .map((m) => ({
        ...m,
        children: m.children ? prune(m.children as SidebarMenu[]) : undefined,
      }));

  return prune(items.filter((m) => m.parent == null));
}

/** 只有地府有城隍(第五十三批)、土地公与勾魂(第五十七批):别的文明的殿不出现这几项。接口照样只在地府能建城隍,这里只是不摆一扇进去是空的门。 */
const DIYU_ONLY_PATHS = new Set(["/city-gods", "/city-god-cases", "/death-sync/tudi-gods", "/judgment/capture-due"]);

export function hideOutsideDiyu(menus: SidebarMenu[], civilization: string | undefined): SidebarMenu[] {
  if (!civilization || civilization === "CHINESE") return menus;
  const keep = (nodes: SidebarMenu[]): SidebarMenu[] =>
    nodes
      .filter((m) => !DIYU_ONLY_PATHS.has(m.path ?? ""))
      .map((m) => (m.children ? { ...m, children: keep(m.children as SidebarMenu[]) } : m));
  return keep(menus);
}

/**
 * 侧边栏菜单树 —— AppLayout（侧边栏本身 + 面包屑）和需要展示"译名 + 中文原名"
 * 对照的页面标题（见 src/lib/menuI18n.ts、src/components/layout/MenuGloss.tsx）
 * 共用同一个 queryKey，后者挂载时命中前者已经填好的缓存，不会重复请求。
 */
export function useSidebarMenus() {
  const { user } = useTenant();
  return useQuery<SidebarMenu[]>({
    queryKey: menuKeys.sidebar(user?.role, !!user, user?.extra_roles),
    queryFn: async () => {
      // Everyone reads /menus/list-public/: unpaginated and already role-filtered
      // by the same `menu_is_visible_to` as /menus/. The paginated /menus/ list
      // (PAGE_SIZE 20) used to serve non-ADMIN roles and silently dropped every
      // row past page 1 -- the visible set for a JUDGE is larger than that.
      const res = await menusApi.all();
      return normalizeMenus(res.data);
    },
    select: (menus) => hideOutsideDiyu(menus, user?.tenant?.civilization),
    staleTime: 5 * 60 * 1000,
    enabled: !!user, // Only fetch when user is logged in
  });
}
