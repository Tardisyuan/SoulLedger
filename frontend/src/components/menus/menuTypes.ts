import type { MenuItem } from "@/lib/api";

export const ROLE_OPTIONS = ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"];

export const MENU_TYPE_OPTIONS = ["DIRECTORY", "MENU", "BUTTON"] as const;
export type MenuTypeOption = (typeof MENU_TYPE_OPTIONS)[number];

/**
 * MenuItem (lib/api/menus.ts) doesn't carry these three fields yet, even
 * though MenuSerializer / MenuCreateUpdateSerializer both read and accept
 * them (backend/apps/menus/serializers.py). AppLayout.tsx hit the same gap
 * for `visible`/`menu_type` and extended the type locally rather than
 * editing lib/api/menus.ts — same move here, since that file is out of
 * scope for this pass.
 */
export type MenuItemFull = MenuItem & {
  menu_type?: MenuTypeOption;
  visible?: boolean;
  permission?: string;
  // Recycle bin (Stage 4 §4.7) — same "extend locally" move as above.
  // MenuSerializer now includes these three (backend/apps/menus/serializers.py).
  is_deleted?: boolean;
  deleted_at?: string | null;
  delete_reason?: string;
};

/** The editor form's shape, shared by the page (which owns the state) and the modal. */
export interface MenuFormState {
  name: string;
  path: string;
  icon: string;
  order: number;
  component: string;
  roles: string[];
  is_active: boolean;
  visible: boolean;
  permission: string;
  menu_type: MenuTypeOption;
  parent: number | null;
}

/**
 * Mirrors Menu.get_codename()'s derivation exactly (backend/apps/menus/models.py)
 * so the editor shows the same guess the backend would compute if a blank
 * `permission` field were ever resolved: strip slashes, take the first path
 * segment, lowercase it, append ".read". No other transform is applied —
 * the real codename table is the only source of truth for whether it's real.
 */
export function deriveCodename(path: string): string | null {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;
  const first = trimmed.split("/")[0];
  if (!first) return null;
  return `${first.toLowerCase()}.read`;
}

/** Every id reachable from `id` by following `parent` links — used to stop a
 * menu from being reparented under its own descendant, which would cycle. */
export function collectDescendantIds(id: number, all: MenuItemFull[]): Set<number> {
  const result = new Set<number>();
  const stack: number[] = [id];
  while (stack.length) {
    const current = stack.pop() as number;
    for (const m of all) {
      if (m.parent === current && !result.has(m.id)) {
        result.add(m.id);
        stack.push(m.id);
      }
    }
  }
  return result;
}
