import type { SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { isDirectory } from "@/src/hooks/useSidebarMenus";
import type { Locale } from "@/src/contexts/I18nContext";

/**
 * 菜单名（Menu.name）是数据库自由文本，没有 i18n 字段（见
 * backend/apps/menus/models.py：name 是普通 CharField）。非 zh-Hans 语言下，
 * 导航本身按设计保持中文原文、不加注 —— 唯一的例外是面包屑和页面 H1，
 * 这两处补一个"译名 中文原名"的对照，别的地方都不加，免得到处都是噪音。
 *
 * 叶子菜单按 path 建 key（path 比 name 稳 —— name 在 Stage 7 的菜单编辑器里
 * 随时可能被改，path 基本对应固定路由）。目录分组没有 path，只能按 name 建
 * key：如果哪天有人在编辑器里重命名了分组，这里的对照会静默失效、退化成
 * "只显示中文"（也就是现状），不会报错，可以接受。
 */
const LEAF_KEYS: Record<string, string> = {
  "/dashboard": "breadcrumb.menu.dashboard",
  "/admin/stats": "breadcrumb.menu.admin_stats",
  "/souls": "breadcrumb.menu.souls",
  "/judgment": "breadcrumb.menu.judgment",
  "/cross-judgments": "breadcrumb.menu.cross_judgments",
  "/karma": "breadcrumb.menu.karma",
  "/disposition": "breadcrumb.menu.disposition",
  "/workflow": "breadcrumb.menu.workflow",
  "/dispatch": "breadcrumb.menu.dispatch",
  "/death-sync": "breadcrumb.menu.death_sync",
  "/realms": "breadcrumb.menu.realms",
  "/actors": "breadcrumb.menu.actors",
  "/social": "breadcrumb.menu.social",
  "/social/follows": "breadcrumb.menu.social_follows",
  "/users": "breadcrumb.menu.users",
  "/permissions": "breadcrumb.menu.permissions",
  "/menus": "breadcrumb.menu.menus",
  "/audit": "breadcrumb.menu.audit",
  "/tenants": "breadcrumb.menu.tenants",
  "/organizations": "breadcrumb.menu.organizations",
};

const DIRECTORY_KEYS: Record<string, string> = {
  "概览": "breadcrumb.menu.group_overview",
  "灵魂业务": "breadcrumb.menu.group_soul_ops",
  "流程协作": "breadcrumb.menu.group_workflow",
  "组织与领域": "breadcrumb.menu.group_org_realm",
  "社交": "breadcrumb.menu.group_social",
  "系统设置": "breadcrumb.menu.group_settings",
};

type GlossableNode = Pick<SidebarMenu, "path" | "name" | "menu_type">;

/** 给定一个菜单树节点，找它对应的译名 key；新增/改名后未登记则返回 null。 */
export function menuTranslationKey(node: GlossableNode): string | null {
  if (!isDirectory(node) && node.path) {
    return LEAF_KEYS[node.path] ?? null;
  }
  return DIRECTORY_KEYS[node.name] ?? null;
}

export type MenuGlossParts = { primary: string; gloss?: string };

/**
 * 面包屑 / 页面 H1 共用的对照渲染逻辑：
 * - zh-Hans 下界面语言和源数据语言相同，不需要对照，原样显示中文名。
 * - 其它语言下，找到译名就"译名在前、中文原名在后（小字）"；找不到译名
 *   （key 未登记，或 t() 缺翻译原样吐回 key）就退化成只显示中文。
 */
export function menuGlossParts(
  node: GlossableNode,
  locale: Locale,
  t: (key: string) => string
): MenuGlossParts {
  if (locale === "zh-Hans") return { primary: node.name };
  const key = menuTranslationKey(node);
  if (!key) return { primary: node.name };
  const translated = t(key);
  if (translated === key) return { primary: node.name };
  return { primary: translated, gloss: node.name };
}

/** 按 path 精确查找菜单树节点（用于页面 H1 旁边的中文原名对照）。 */
export function findMenuByPath(nodes: SidebarMenu[], path: string): SidebarMenu | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const kids = node.children;
    if (kids?.length) {
      const found = findMenuByPath(kids, path);
      if (found) return found;
    }
  }
  return null;
}
