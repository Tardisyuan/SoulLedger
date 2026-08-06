"use client";

import { useQuery } from "@tanstack/react-query";
import { menusApi, type MenuItem } from "@/lib/api";
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
 * 1. 只保留一级项。ADMIN 走 /menus/list-public/（本来就只返回一级），
 *    但非 ADMIN 走 /menus/，那个接口返回的是拉平的全量菜单 —— 子菜单
 *    既嵌在 parent 的 children 里、又作为独立条目出现在顶层。不过滤的话
 *    分组后每个子项都会重复渲染一次。
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

/**
 * 侧边栏菜单树 —— AppLayout（侧边栏本身 + 面包屑）和需要展示"译名 + 中文原名"
 * 对照的页面标题（见 src/lib/menuI18n.ts、src/components/layout/MenuGloss.tsx）
 * 共用同一个 queryKey，后者挂载时命中前者已经填好的缓存，不会重复请求。
 */
export function useSidebarMenus() {
  const { user } = useTenant();
  return useQuery<SidebarMenu[]>({
    queryKey: ["menus-sidebar", user?.role, !!user],
    queryFn: async () => {
      // Use all() for admin (returns unfiltered, bare array), list() for others
      // (role-filtered, DRF-paginated — unwrap .results)
      if (user?.role === "ADMIN") {
        const res = await menusApi.all();
        return normalizeMenus(res.data);
      }
      const res = await menusApi.list();
      return normalizeMenus(res.data.results);
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!user, // Only fetch when user is logged in
  });
}
