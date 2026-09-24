"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { isDirectory, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { menuGlossParts } from "@/src/lib/menuI18n";

/**
 * 页头里那一条面包屑。原先长在 AppLayout.tsx 里，随文件一起越过 500 行的上限
 * 之后搬到这里；代码逐字未改。
 *
 * AppLayout.tsx 仍然 `export { Breadcrumb } from "./Breadcrumb"` 转发一次 ——
 * 那不是搬家没搬干净，理由写在那一行上面。
 */
/** 形如 42 或 uuid 的路径段，面包屑里显示为「详情」而不是原始 id。 */
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-)/i;

/**
 * 在菜单树里找出与当前路径最匹配的一条链路（从分组到叶子）。
 * 取 path 最长的匹配项，这样 /social/follows 命中「关注」而不是「动态」。
 */
function matchTrail(items: SidebarMenu[], pathname: string): SidebarMenu[] {
  let best: SidebarMenu[] = [];
  let bestLen = -1;

  const walk = (nodes: SidebarMenu[], trail: SidebarMenu[]) => {
    for (const node of nodes) {
      const next = [...trail, node];
      const p = node.path;
      if (p && (pathname === p || pathname.startsWith(p + "/"))) {
        if (p.length > bestLen) {
          best = next;
          bestLen = p.length;
        }
      }
      const kids = node.children as SidebarMenu[] | undefined;
      if (kids?.length) walk(kids, next);
    }
  };

  walk(items, []);
  return best;
}

// 面包屑段落的中文原名旁边配的译名（见 src/lib/menuI18n.ts 里的解释：菜单名
// 是数据库自由文本，没有 i18n 字段，导航本身永远保持中文原文；面包屑和页面
// H1 是仅有的两处例外，补一个"译名 中文原名"的对照）。
type Crumb = { label: string; gloss?: string; href?: string };

export function Breadcrumb({ menus }: { menus: SidebarMenu[] }) {
  const pathname = usePathname();
  const { t, locale } = useI18n();

  // t() 找不到 key 时会原样返回 key，这里补一个真正的兜底。
  const label = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  // 路由段先查 breadcrumb.<段>，再查侧栏同名菜单项 breadcrumb.menu.<段>（- 换 _），
  // 最后才落回原始段：菜单树没加载或没收录该路由时（/judgment/<id> 的首段），
  // 此前显示的是英文原文 "judgment"。
  const segmentLabel = (segment: string) =>
    ID_SEGMENT.test(segment)
      ? label("breadcrumb.detail", "详情")
      : label(`breadcrumb.${segment}`, label(`breadcrumb.menu.${segment.replace(/-/g, "_")}`, segment));

  const trail = matchTrail(menus, pathname);
  const crumbs: Crumb[] = [];

  if (trail.length > 0) {
    for (const node of trail) {
      const { primary, gloss } = menuGlossParts(node, locale, t);
      crumbs.push({
        // 分组目录没有页面，不给链接
        label: primary,
        gloss,
        href: isDirectory(node) ? undefined : node.path,
      });
    }
    // 菜单里没有登记的更深层路由（/menus/buttons、/dispatch/propose、
    // /souls/<id> …）按剩余的路径段补上，避免"进去了看不出自己在哪"。
    const matched = trail[trail.length - 1];
    if (matched.path && pathname !== matched.path) {
      const rest = pathname.slice(matched.path.length).split("/").filter(Boolean);
      rest.forEach((segment, i) => {
        crumbs.push({
          label: segmentLabel(segment),
          href:
            i < rest.length - 1
              ? `${matched.path}/${rest.slice(0, i + 1).join("/")}`
              : undefined,
        });
      });
    }
  } else {
    // 菜单树里完全没有的路径（例如已移出侧边栏的 /profile、/notifications）
    pathname
      .split("/")
      .filter(Boolean)
      .forEach((segment, i, all) => {
        crumbs.push({
          label: segmentLabel(segment),
          href: i < all.length - 1 ? `/${all.slice(0, i + 1).join("/")}` : undefined,
        });
      });
  }

  if (crumbs.length === 0) return <div className="flex-1" />;

  return (
    <nav
      aria-label={label("breadcrumb.aria_label", "面包屑导航")}
      className="flex-1 min-w-0"
    >
      {/* 规范 v1「页头 · 面包屑」:等宽、斜杠分隔;链接悬停下划线,当前页 600 不可点
          (aria-current)。不再有首页图标 —— 侧栏第一项就是概览。 */}
      <ol className="flex items-center gap-2 font-mono text-xs min-w-0 overflow-hidden">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex items-center gap-1 min-w-0">
              {i > 0 ? (
                <span aria-hidden="true" className="shrink-0 text-[oklch(var(--color-ink-subtle))]">
                  /
                </span>
              ) : null}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  prefetch={true}
                  /* `title`,和站内其余 15 处承载数据的截断同一个理由。
                   *
                   * 这两处是 **393px 下唯一真正会溢出的截断** —— 2026-09-05 在
                   * mobile-chrome 上逐元素量过 `scrollWidth > clientWidth`,
                   * 八条路由里只有面包屑的两段命中(80>55 / 63>55),那 15 处数据值
                   * 一处都没有(移动端是单列,容器相对内容反而更宽)。
                   *
                   * 它们也是 `truncatedValuesAreRecoverable.test.ts` **看不见**的
                   * 两处:那条规则按行匹配,而它自己的表头写明了代价 ——「跨行写开的
                   * 元素这条规则看不见」。这里就是那个代价的实例。 */
                  title={crumb.label}
                  className="truncate text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] hover:underline"
                >
                  {crumb.label}
                  {crumb.gloss && (
                    <span className="ml-1 text-[oklch(var(--color-ink-subtle))]">{crumb.gloss}</span>
                  )}
                </Link>
              ) : (
                <span
                  title={crumb.label}
                  className={`truncate ${
                    isLast
                      ? "text-[oklch(var(--color-ink))] font-semibold"
                      : "text-[oklch(var(--color-ink-subtle))]"
                  }`}
                  aria-current={isLast ? "page" : undefined}
                >
                  {crumb.label}
                  {crumb.gloss && (
                    <span className="ml-1 font-normal text-[oklch(var(--color-ink-subtle))]">{crumb.gloss}</span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
