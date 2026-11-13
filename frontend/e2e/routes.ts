/**
 * Which routes the three route-table specs open, derived from `app/` rather than hand-written.
 *
 * WHY. `no-route-overflows-the-document`, `the-api-mock-models-what-the-app-calls` and `rendered-contrast` each
 * carried their own list (30 / 22 / 8 entries); together they reached 33 of the 64 static routes, and nothing
 * compared any of them with `app/` (docs/audit/2026-11-13-test-review.md §2 #5). A new page was in none of them
 * until someone remembered. Now each spec opens every static route except the ones its EXCLUDE map names, with the
 * reason written next to it; `src/__tests__/e2eRouteTables.test.ts` checks that every entry is a real route with a
 * reason, and that the three specs still take their list from here.
 *
 * No `@playwright/test` import: that jest guard loads this module too.
 *
 * Dynamic routes (`/souls/[id]` …) need an id a fixture models, so each spec still names the ones it opens.
 */
import { pageRoutes } from "../src/__tests__/support/appRoutes";

export type RouteTable = "overflow" | "apiMock" | "contrast";

/** Every page under `app/` whose URL has no `[param]`, read from disk when the spec file loads. */
export const STATIC_ROUTES: string[] = pageRoutes()
  .map((page) => page.route)
  .filter((route) => !route.includes("["));

/**
 * Opened without a session (`mockApi` only), as a visitor sees them. Everything else gets `setupAuthenticatedPage`.
 * `/` and `/login` render outside AppLayout; `/forgot-password` is public and has no request of its own on load.
 */
export const SIGNED_OUT: ReadonlySet<string> = new Set(["/", "/login", "/forgot-password"]);

/** Routes none of the three specs can open as they are. */
const NOWHERE: Record<string, string> = {
  "/login/verify": "两步验证第二步:要登录第一步留下的 pending token,没有就回登录页;没有这枚令牌的夹具",
  "/reset-password": "要邮件链接里的一次性 uid / token;没有就是「链接失效」那一个状态,没有夹具",
  "/verify-email": "要邮件链接里的一次性 uid / token,打开即验证;没有夹具",
  "/accept-invite": "要邀请信里的一次性 uid / token;没有夹具",
  "/goodbye": "要退出前留在 sessionStorage 的便条(名字与文明),没有就回首页;sign-out-farewell.spec 走真的登出过来",
  "/verdict-print": "只给无头渲染器打开的打印页,要一次性键;按纸面排版,不按视口",
  "/admin/stats": "只做跳转(到 /dashboard),量到的是 /dashboard,那一条已在表里",
  "/admin/assistant/usage": "fixture missing: GET /assist-admin/usage/(Usage 是十六个字段的嵌套结构,ApiMock 还没有)",
};

/**
 * Per spec: the static routes it does not open, each with why. A key that is not a static route under `app/`,
 * or an empty reason, fails `e2eRouteTables.test.ts`.
 */
export const EXCLUDE: Record<RouteTable, Record<string, string>> = {
  overflow: { ...NOWHERE },
  apiMock: {
    ...NOWHERE,
    "/": "未登录的落地页:加载时不保证发出任何 API 请求,而这条 spec 的前提是「至少记到一条」",
    "/login": "未登录的登录页:加载时不保证发出任何 API 请求,而这条 spec 的前提是「至少记到一条」",
    "/forgot-password": "未登录的申请页:加载时自己不发请求,提交才发",
  },
  contrast: { ...NOWHERE },
};

/** The static routes a spec opens: all of them, minus its exclusions. */
export function routesFor(table: RouteTable): string[] {
  return STATIC_ROUTES.filter((route) => !(route in EXCLUDE[table]));
}
