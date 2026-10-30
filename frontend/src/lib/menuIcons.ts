"use client";

import { useEffect, useState } from "react";
// Names the menus migrations seed (backend/apps/menus/migrations/) that the picker does not offer.
// Every other seeded / fixture name is in the picker catalog. `menuIconTable.test.ts` scans the
// migrations and the E2E fixtures and fails when a name there does not resolve from this table.
import { Scroll, ScrollText, Settings, type LucideIcon } from "lucide-react";
import { ICON_CATEGORIES, PICKER_ICONS } from "@/src/components/ui/iconCatalog";

type LucideModule = typeof import("lucide-react");
type IconResolver = (icon: string | null | undefined) => LucideIcon | null;

const SEEDED: Record<string, LucideIcon> = { Scroll, ScrollText, Settings };

/**
 * The static table: the picker's icons by export name and by displayName (what a fresh pick stores),
 * plus the seeded names outside the picker. A Map, not an object: a stored `constructor` must miss.
 */
const TABLE = new Map<string, LucideIcon>([...Object.entries(PICKER_ICONS), ...Object.entries(SEEDED)]);
for (const category of ICON_CATEGORIES) {
  for (const icon of category.icons) if (icon.displayName && !TABLE.has(icon.displayName)) TABLE.set(icon.displayName, icon);
}

/** `layout-dashboard` → `LayoutDashboard`(E2E 夹具里有直接写 kebab 的,`users`)。 */
const pascalOf = (name: string) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

/** `menu.icon` → the icon, from the static table only. `null` for no name or a name not in it. */
export function staticMenuIcon(icon: string | null | undefined): LucideIcon | null {
  if (!icon) return null;
  return TABLE.get(icon) ?? TABLE.get(pascalOf(icon)) ?? null;
}

/**
 * `menu.icon` → lucide 组件,对整个 lucide 模块解析(静态表查不到时的退路)。导出名、别名、kebab 都认;
 * 只认真正的图标 —— `lucide-react` 还导出 `Icon`、`createLucideIcon` 这类非图标,以 `icons` 表里的组件为准。
 */
export function iconResolver(mod: LucideModule): IconResolver {
  const real = new Set<unknown>(Object.values(mod.icons));
  const table = mod as unknown as Record<string, unknown>;
  return (icon) => {
    if (!icon) return null;
    const hit = [icon, pascalOf(icon)].map((n) => table[n]).find((c) => real.has(c));
    return (hit as LucideIcon | undefined) ?? null;
  };
}

// 整套 lucide(约 194 KB gz)只在静态表查不到时才异步载入一次 —— 菜单里存了一个表外的名字。
let resolverPromise: Promise<IconResolver> | null = null;
let resolved: IconResolver | null = null;
function loadResolver(): Promise<IconResolver> {
  resolverPromise ??= import("lucide-react").then((mod) => (resolved = iconResolver(mod)));
  return resolverPromise;
}

/**
 * The icon for a stored menu name: the static table at once; a name outside it waits for the whole
 * of lucide, loaded on demand. `null` while loading, and for a name lucide does not have.
 */
export function useMenuIcon(icon: string | null | undefined): LucideIcon | null {
  const hit = staticMenuIcon(icon);
  const [resolve, setResolve] = useState<IconResolver | null>(() => resolved);
  const needsLoad = !hit && !!icon && !resolve;
  useEffect(() => {
    if (!needsLoad) return;
    let live = true;
    void loadResolver().then((r) => {
      if (live) setResolve(() => r);
    });
    return () => {
      live = false;
    };
  }, [needsLoad]);
  return hit ?? resolve?.(icon) ?? null;
}
