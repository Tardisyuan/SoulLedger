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
import { landingFor } from "@/src/lib/doors";

export type { DefaultView };

export const DEFAULT_VIEW_KEY = "soulledger_default_view";

// 判官进来先到案卷台(Design 第三十批 第 2 步,2026-11-13);此前是 `/judgment/queue`(分诊),它照旧在。
const ROUTES: Record<DefaultView, string> = {
  operator: "/desk",
  admin: "/dashboard",
};

/** 管理员的「管理」视图是总簿(`/desk/overview`,只给 ADMIN);别的角色选了「管理」仍是 /dashboard(总簿对他们是 403)。 */
const ADMIN_LEDGER = "/desk/overview";

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

/** Who is signing in, as far as choosing a landing page needs to know. */
export type ViewUser = { role?: string; permissions?: string[] } | null | undefined;

/**
 * The view for someone who never chose one (review-2026-11-01 Web 1): an
 * administrator lands on the 总簿 (/desk/overview); an officer who can read
 * judgments lands on the 案卷台 (/desk), which is what their day is. Anyone else — a viewer with
 * no judgment access — keeps /dashboard rather than being sent to a 403.
 */
export function defaultViewFor(user: ViewUser): DefaultView {
  if (!user || user.role === "ADMIN") return "admin";
  return user.permissions?.includes("judgment.read") ? "operator" : "admin";
}

/**
 * Unset falls back to the role's view; with no user at all, /dashboard.
 * 守卫 / 观察员 / 版主没有「审」这一门(`src/lib/doors.ts`,第三十批第 4 步):不管选了哪个视图,都去自己那一门。
 */
export function routeForView(view: DefaultView | null, user?: ViewUser): string {
  const own = landingFor(user?.role);
  if (own) return own;
  const chosen = view ?? defaultViewFor(user);
  return chosen === "admin" && user?.role === "ADMIN" ? ADMIN_LEDGER : ROUTES[chosen];
}

/**
 * Where login lands: the server's value. If the server cannot be asked, the
 * operator still gets in — to the local value if one is left, else the role's
 * view. `user` is the one the login response just returned.
 */
export async function defaultViewRoute(user?: ViewUser): Promise<string> {
  try {
    return routeForView(await loadDefaultView(), user);
  } catch {
    return routeForView(readLegacy(), user);
  }
}
