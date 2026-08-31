/**
 * @jest-environment node
 */
/**
 * `middleware.ts` 的登录闸门 —— **主体清单从 `app/` 目录派生**。
 *
 * WHY。这个文件之前不存在,而且没有任何 jest 套件 import 过 `middleware.ts`。
 * 唯一的守卫是 `e2e/home.spec.ts` 里一份写死的 6 条 `protectedRoutes` 清单,
 * 而这个应用有 37 个页面。实证:把 `/ledger` 与 `/notifications` 加进
 * `PUBLIC_PATHS` —— 两个需要登录的页面从此对未登录者敞开 —— 全量 jest 1689
 * passed、`tsc` exit 0、`e2e/home.spec.ts` chromium 17 passed。
 *
 * 所以问题不是「没有测试」,是**清单是手抄的**。手抄的清单不会因为新增了一个
 * 页面而变长,也不会因为某个页面被划进公开而变短 —— 它只会一直是那 6 条。
 *
 * 这里的清单是 `find app -name page.tsx` 走出来的。新增一个页面,它自动进入
 * 被断言的集合;把它划进 `PUBLIC_PATHS`,下面第一条就红。
 *
 * jsdom 里跑不了这个文件:`next/server` 在模块顶层就要 `Request`,而 jsdom 没有。
 * 所以有上面那行 `@jest-environment node`。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware";
import { DEFAULT_LOCALE, LOCALE_COOKIE } from "@/src/config/locale";

const APP_DIR = path.join(__dirname, "..", "..", "app");

/** 每个 `page.tsx` 对应的 URL 路径。
 *
 *  两处转换要说明:`(auth)` 这类路由组不出现在 URL 里,`[id]` 这类动态段要换成
 *  一个具体值 —— 中间件按前缀匹配,占位符原样传进去匹配到的是另一回事。 */
function routesFromDisk(dir = APP_DIR, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const segment = entry.name.startsWith("(")
        ? "" // 路由组:不出现在 URL 里
        : `/${entry.name.replace(/^\[\.{3}?(.+)\]$/, "probe").replace(/^\[(.+)\]$/, "probe")}`;
      out.push(...routesFromDisk(path.join(dir, entry.name), prefix + segment));
    } else if (entry.name === "page.tsx") {
      out.push(prefix === "" ? "/" : prefix);
    }
  }
  return out;
}

const ALL_ROUTES = [...new Set(routesFromDisk())].sort();

/** 不需要登录的那几条,与 `middleware.ts` 的 `PUBLIC_PATHS` 对应。
 *  写死是有意的:这是一个**决定**,新增页面不该自动进来。下面第一条断言比对的
 *  正是「磁盘上的页面减去这几条」。 */
const EXPECTED_PUBLIC = ["/", "/welcome", "/login"];

function request(pathname: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(new URL(`http://localhost:3000${pathname}`));
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
}

function redirectTarget(res: Response): string | null {
  return res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
}

describe("未登录时,除公开路由外每一条都被送去登录页", () => {
  it("走到了一个非平凡数量的路由,否则下面的断言在扫一个空集合", () => {
    // 守卫的守卫。`routesFromDisk` 返回 [] 时,`it.each` 一条都不生成,
    // 而一个生成了零条测试的 each 在汇总里是看不出来的。
    expect(ALL_ROUTES.length).toBeGreaterThan(30);
    for (const p of EXPECTED_PUBLIC) expect(ALL_ROUTES).toContain(p);
  });

  const protectedRoutes = ALL_ROUTES.filter((r) => !EXPECTED_PUBLIC.includes(r));

  it.each(protectedRoutes)("%s 未登录 → 重定向到 /login", (route) => {
    const res = middleware(request(route));
    const location = redirectTarget(res);
    expect(location).not.toBeNull();
    const url = new URL(location!);
    expect(url.pathname).toBe("/login");
    // 回跳地址要带上原路径,否则登录后用户落在别处 —— 这也是「重定向确实是
    // 因为这条路由」的证据,而不是一个对谁都跳的兜底。
    expect(url.searchParams.get("redirect")).toBe(route);
  });

  it.each(EXPECTED_PUBLIC)("%s 未登录也放行", (route) => {
    // 正对照。没有它,一个「什么都重定向」的中间件同样满足上面全部断言。
    expect(redirectTarget(middleware(request(route)))).toBeNull();
  });

  it.each(protectedRoutes)("%s 带着 refresh cookie 就放行", (route) => {
    // 第二个正对照:上面的重定向是因为**没有凭证**,不是因为这条路径本身。
    expect(
      redirectTarget(middleware(request(route, { soulledger_refresh: "tok" })))
    ).toBeNull();
  });
});

describe("中间件不假装自己在做角色鉴权", () => {
  /** `X-Requires-Admin` 已删(2026-08-31)。
   *
   * 它自称「add header for client-side verification」,而**没有任何客户端代码
   * 读它,也读不到** —— 它是 document 响应头。全仓 grep `Requires-Admin`
   * 只有它自己那一行。
   *
   * 更糟的是它的路径清单:`["/admin","/permissions","/menus"]`,而
   * `/tenants`、`/users`、`/organizations`、`/audit` 都是管理面且都不在里面。
   * **一个什么都不做的守卫,配着一份错的清单** —— 而清单读起来像是权威的。
   *
   * 这两条钉住「它没有回来」。真正的闸在页面的 `<RequireAdmin>` /
   * `<RequirePermission>`(见本文件上半部与
   * backend/tests/test_page_gates_match_the_backend.py),以及每个 API 上的
   * `CodenamePermission`。 */
  it.each(["/admin/stats", "/permissions", "/menus", "/tenants", "/audit"])(
    "%s 不再带一个没人读的 X-Requires-Admin",
    (route) => {
      const res = middleware(request(route, { soulledger_refresh: "tok" }));
      expect(res.headers.get("X-Requires-Admin")).toBeNull();
    }
  );

  it("middleware.ts 里不再出现这个头名", () => {
    // 断源码,而不只断行为:一个只在别的路径上打这个头的实现,上面那条会绿。
    const source = readFileSync(
      path.join(__dirname, "..", "..", "middleware.ts"),
      "utf8"
    );
    const mentions = source
      .split("\n")
      .filter((line) => line.includes("X-Requires-Admin"))
      .filter((line) => !line.trimStart().startsWith("//"));
    expect(mentions).toEqual([]);
  });
});

describe("locale 常量只有一份", () => {
  /** `src/config/locale.ts` 的文件头从写下那天起就说「`middleware.ts` 同样从
   * 这里取值」,而 `git log -p --all -- frontend/middleware.ts | grep
   * config/locale` **一次都没命中过**。三份同源常量说好收成一份,实际还是两份,
   * 而注释宣告了收拢已完成。 */
  it("middleware.ts 真的从 src/config/locale 取值", () => {
    const source = readFileSync(
      path.join(__dirname, "..", "..", "middleware.ts"),
      "utf8"
    );
    expect(source).toMatch(/from\s+["']@\/src\/config\/locale["']/);
  });

  it("并且没有自己再抄一份字面量", () => {
    const source = readFileSync(
      path.join(__dirname, "..", "..", "middleware.ts"),
      "utf8"
    );
    const declarations = source
      .split("\n")
      .filter((line) => /^\s*const\s+(LOCALE_COOKIE|SUPPORTED_LOCALES|DEFAULT_LOCALE)\s*=/.test(line));
    expect(declarations).toEqual([]);
  });

  it("中间件写出的 cookie 名就是那个模块导出的那个", () => {
    // 行为侧的对照:上面两条断的是源码,这条断的是结果。
    const res = middleware(request("/", {}));
    expect(res.cookies.get(LOCALE_COOKIE)?.value).toBe(DEFAULT_LOCALE);
  });
});

describe("语言 cookie", () => {
  it("没有 cookie 时落到默认语言", () => {
    const res = middleware(request("/", {}));
    expect(res.cookies.get("soulledger-locale")?.value).toBe("zh-Hans");
  });

  it.each(["zh-Hans", "en", "egy"])("认得 %s", (locale) => {
    const res = middleware(request("/", { "soulledger-locale": locale }));
    expect(res.cookies.get("soulledger-locale")?.value).toBe(locale);
  });

  it("不认得的语言值被换成默认值,而不是原样写回去", () => {
    // 原样写回去意味着 cookie 里的任意字符串会一路流到渲染层。
    const res = middleware(request("/", { "soulledger-locale": "../../etc/passwd" }));
    expect(res.cookies.get("soulledger-locale")?.value).toBe("zh-Hans");
  });
});
