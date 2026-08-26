"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { useSidebarMenus } from "@/src/hooks/useSidebarMenus";
import { findMenuByPath, menuGlossParts } from "@/src/lib/menuI18n";

/**
 * 页面 H1 旁边的中文原名小字对照 —— 见 Breadcrumb（src/components/layout/Breadcrumb.tsx）里同样的
 * "译名 中文原名"逻辑，这是它在页面标题这一侧的对应实现。
 *
 * 只在 locale != zh-Hans、且能在菜单树里按 path 找到对应节点和译名时才渲染；
 * 菜单树没加载完 / path 未登记为菜单项时静默不渲染，不影响 H1 本身已有的
 * 翻译文案（调用方自己传 children，这个组件只负责追加的中文小字）。
 */
export function MenuGloss({ path }: { path: string }) {
  const { locale, t } = useI18n();
  const { data: menus = [] } = useSidebarMenus();

  if (locale === "zh-Hans") return null;

  const node = findMenuByPath(menus, path);
  if (!node) return null;

  const { gloss } = menuGlossParts(node, locale, t);
  if (!gloss) return null;

  return (
    <span className="ml-2 align-middle text-03 font-normal text-[hsl(var(--color-ink-subtle))]">
      {gloss}
    </span>
  );
}
