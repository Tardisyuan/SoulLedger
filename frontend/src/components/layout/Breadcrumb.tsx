"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
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

  const segmentLabel = (segment: string) =>
    ID_SEGMENT.test(segment)
      ? label("breadcrumb.detail", "详情")
      : label(`breadcrumb.${segment}`, segment);

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
      <ol className="flex items-center gap-1 text-03 min-w-0 overflow-hidden">
        <li className="shrink-0">
          <Link
            href="/dashboard"
            prefetch={true}
            className="flex items-center text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent))] transition-colors"
            title={label("breadcrumb.home", "仪表盘")}
          >
            <Home className="w-4 h-4" />
          </Link>
        </li>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--color-ink-subtle))]" />
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  prefetch={true}
                  className="truncate text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent-ink))] transition-colors"
                >
                  {crumb.label}
                  {crumb.gloss && (
                    <span className="ml-1 text-[hsl(var(--color-ink-subtle))]">{crumb.gloss}</span>
                  )}
                </Link>
              ) : (
                <span
                  className={`truncate ${
                    isLast
                      ? "text-[hsl(var(--color-ink))] font-medium"
                      : "text-[hsl(var(--color-ink-subtle))]"
                  }`}
                  aria-current={isLast ? "page" : undefined}
                >
                  {crumb.label}
                  {crumb.gloss && (
                    <span className="ml-1 font-normal text-[hsl(var(--color-ink-subtle))]">{crumb.gloss}</span>
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
