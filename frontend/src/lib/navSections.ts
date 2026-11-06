import { isDirectory, type SidebarMenu } from "@/src/hooks/useSidebarMenus";

/**
 * 侧栏三组(规范 v4 第七批 S01:工作 / 灵魂 / 系统,`nav.group.*`)。
 *
 * 菜单树仍是后端的(`useSidebarMenus`),叫法以仓库为准;这里只决定一级项落进哪一组。
 * 「概览」「灵魂业务」两个目录在 v4 里不再是一层手风琴 —— 它们的页面直接列进组里
 * (审判队列、申诉复核、跨域审判进「工作」,灵魂管理、功德管理等进「灵魂」);
 * 其余目录(轮回、社交、流程协作、组织与领域、系统设置、全局)仍是一项可展开的组。
 *
 * 认不出的:管理员在菜单编辑器里新建的目录落「系统」,新建的页面落「灵魂」。
 * 目录按 `name` 认(同 `menuI18n.ts` 的 DIRECTORY_KEYS:目录没有 path),改了名就按「认不出」处理。
 */
export type NavSectionId = "work" | "souls" | "system";
export type NavSection = { id: NavSectionId; items: SidebarMenu[] };

const ORDER: readonly NavSectionId[] = ["work", "souls", "system"];
/** 只是把页面装起来的目录:拆开,页面直接进组。 */
const FLATTENED = new Set(["概览", "灵魂业务"]);
const SOUL_DIRS = new Set(["轮回", "社交"]);
const WORK_PATHS = new Set([
  "/dashboard",
  "/admin/stats",
  "/halls",
  "/judgment",
  "/judgment/appeals",
  "/judgment/capture-due",
  "/cross-judgments",
  "/city-god-cases",
]);
const SYSTEM_PATHS = new Set([
  "/workflow",
  "/dispatch",
  "/realms",
  "/actors",
  "/users",
  "/permissions",
  "/menus",
  "/audit",
  "/audit/sessions",
  "/tenants",
  "/organizations",
  "/scheduler",
  "/recycle-bin",
  "/admin/assistant",
  "/city-gods",
  "/death-sync/tudi-gods",
]);

function sectionOf(menu: SidebarMenu): NavSectionId {
  if (isDirectory(menu)) return SOUL_DIRS.has(menu.name) ? "souls" : "system";
  if (WORK_PATHS.has(menu.path)) return "work";
  return SYSTEM_PATHS.has(menu.path) ? "system" : "souls";
}

/** 一级项按组排;组内保持后端顺序;空组不出现。 */
export function navSections(menus: readonly SidebarMenu[]): NavSection[] {
  const items = menus.flatMap((m) => (isDirectory(m) && FLATTENED.has(m.name) ? (m.children ?? []) : [m]));
  return ORDER.map((id) => ({ id, items: items.filter((m) => sectionOf(m) === id) })).filter((s) => s.items.length > 0);
}

/** 侧栏实际画出来的一级项(拆开之后),给「当前项在哪一组」用。 */
export const navItems = (menus: readonly SidebarMenu[]): SidebarMenu[] => navSections(menus).flatMap((s) => s.items);
