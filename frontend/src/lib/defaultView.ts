/**
 * 默认视图(/welcome 第 2 步):进来之后先看到什么。
 *
 * STORED IN THIS BROWSER ONLY. There is no user-preferences field or endpoint
 * on the backend (the user serializer carries no such column, and the only
 * persisted UI settings — theme, accent, nav mode, locale — are themselves
 * localStorage keys). So this follows them rather than inventing a server
 * setting; it does not follow the operator to another browser.
 */
export type DefaultView = "operator" | "admin";

export const DEFAULT_VIEW_KEY = "soulledger_default_view";

const ROUTES: Record<DefaultView, string> = {
  operator: "/judgment/queue",
  admin: "/dashboard",
};

export function readDefaultView(): DefaultView | null {
  try {
    const saved = localStorage.getItem(DEFAULT_VIEW_KEY);
    return saved === "operator" || saved === "admin" ? saved : null;
  } catch {
    return null;
  }
}

export function writeDefaultView(view: DefaultView): void {
  try {
    localStorage.setItem(DEFAULT_VIEW_KEY, view);
  } catch {
    // Private mode / storage disabled: the choice lasts for this page only.
  }
}

/** Unset keeps the old answer, /dashboard. */
export function routeForView(view: DefaultView | null): string {
  return ROUTES[view ?? "admin"];
}

/** Where login lands. */
export function defaultViewRoute(): string {
  return routeForView(readDefaultView());
}
