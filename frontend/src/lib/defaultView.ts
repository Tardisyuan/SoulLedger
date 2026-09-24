/**
 * 默认视图(/welcome 第 2 步):进来之后先看到什么。
 *
 * STORED ON THE SERVER, per user: `GET/PATCH /auth/profile/preferences/`
 * (`User.preferences`). It used to be a localStorage key, so the choice stayed
 * in the browser it was made in; now it follows the operator to any browser.
 *
 * `DEFAULT_VIEW_KEY` is the old key, kept only to be read ONCE: the first time
 * a signed-in operator reaches /welcome or /login with a local value and no
 * server value, the local value is written to the server and the key removed.
 * If that write fails the key stays, so the next attempt migrates it instead.
 * Nothing writes the key any more.
 */
import { authApi, type DefaultView } from "@soulledger/core/api";

export type { DefaultView };

export const DEFAULT_VIEW_KEY = "soulledger_default_view";

const ROUTES: Record<DefaultView, string> = {
  operator: "/judgment/queue",
  admin: "/dashboard",
};

function readLegacy(): DefaultView | null {
  try {
    const saved = localStorage.getItem(DEFAULT_VIEW_KEY);
    return saved === "operator" || saved === "admin" ? saved : null;
  } catch {
    return null;
  }
}

function clearLegacy(): void {
  try {
    localStorage.removeItem(DEFAULT_VIEW_KEY);
  } catch {
    // Storage disabled: there is nothing there to clear either.
  }
}

/**
 * The signed-in operator's choice, from the server — migrating a value left in
 * this browser by the localStorage era the first time there is one to migrate.
 * Rejects if the server cannot be asked; callers decide what that means.
 */
export async function loadDefaultView(): Promise<DefaultView | null> {
  const { data } = await authApi.preferences();
  if (data.default_view) {
    // The server already has an answer; a stale local copy must not ever win.
    clearLegacy();
    return data.default_view;
  }
  const legacy = readLegacy();
  if (!legacy) return null;
  await authApi.updatePreferences({ default_view: legacy });
  clearLegacy();
  return legacy;
}

/** Save the choice for this operator, everywhere they sign in. */
export async function saveDefaultView(view: DefaultView): Promise<DefaultView | null> {
  const { data } = await authApi.updatePreferences({ default_view: view });
  clearLegacy();
  return data.default_view;
}

/** Unset keeps the old answer, /dashboard. */
export function routeForView(view: DefaultView | null): string {
  return ROUTES[view ?? "admin"];
}

/**
 * Where login lands: the server's value. If the server cannot be asked, the
 * operator still gets in — to the local value if one is left, else /dashboard.
 */
export async function defaultViewRoute(): Promise<string> {
  try {
    return routeForView(await loadDefaultView());
  } catch {
    return routeForView(readLegacy());
  }
}
