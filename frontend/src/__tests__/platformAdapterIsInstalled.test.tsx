/**
 * 浏览器适配器**真的**被装上了 —— 而且是在根布局里装的。
 *
 * 为什么需要这个文件。`jest.setup.js` 给每个 suite 都装了 web 适配器,所以整套
 * 测试里 `getAccessToken()` 永远是通的 —— **包括在应用自己根本没装的情况下**。
 * 也就是说:如果有人删掉 `app/layout.tsx` 里那一行 `<PlatformProvider />`,
 * 2058 条测试一条都不会红,而真实浏览器里每个请求都会不带 Authorization 头发出去,
 * 然后 401、刷新失败、跳 /login。
 *
 * 这正是这个仓库反复记录的形状:测试脚手架替被测系统做了一件事,于是被测系统
 * 做没做就无人过问。所以这里断两件互不重叠的事:
 *
 *   1. 装载是导入 PlatformProvider 这个模块的副作用(模块级,不是 effect ——
 *      effect 太晚,首屏的查询已经发出去了);
 *   2. 根布局确实导入并渲染了它。
 *
 * 第 2 条读源码而不是渲染 layout:`app/layout.tsx` 是 async server component,
 * 要 `next/headers` 的 cookies(),在 jsdom 里渲染它是在测 Next 的运行时,不是在测
 * 这一行。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { installWebPlatform } from "@/lib/platform/web";

/**
 * 两次 require **必须来自同一个 registry**,这是这个文件唯一的技术要点。
 *
 * 第一版用了 `jest.isolateModules(() => require(Provider))`,结果是绿不了 ——
 * isolateModules 给里面的 require 一份全新的模块注册表,于是 Provider 装的是
 * **另一个** `@soulledger/core/platform` 实例,而断言读的是文件顶部 import 的那个。
 * 适配器装对了,测试照样红。所以这里 resetModules 一次,再从同一个注册表里把
 * 两边都取出来。
 */
function freshCore() {
  jest.resetModules();
  return require("@soulledger/core/platform") as typeof import("@soulledger/core/platform");
}
function loadProvider() {
  require("@/src/components/providers/PlatformProvider");
}

const LAYOUT = path.join(__dirname, "..", "..", "app", "layout.tsx");

afterEach(() => {
  // 还原 jest.setup.js 的全局状态,免得这个文件把后面的 suite 留在空适配器上。
  installWebPlatform();
  sessionStorage.clear();
});

describe("装载是模块级副作用", () => {
  it("导入 PlatformProvider 就把适配器装上了", () => {
    const core = freshCore();
    sessionStorage.setItem("soulledger_access", "TOKEN");
    // 先证明未装载时读不到 —— 否则下面那条断言在适配器根本没生效时也会绿。
    expect(core.getAccessToken()).toBeNull();

    loadProvider();

    expect(core.getAccessToken()).toBe("TOKEN");
  });

  it("装上的是真会读浏览器的那个,不是空实现", () => {
    const core = freshCore();
    // 空实现写哪儿都不落地;真适配器写进 sessionStorage。断的是后者。
    core.platform().session.set("probe", "before");
    expect(sessionStorage.getItem("probe")).toBeNull();

    loadProvider();

    core.platform().session.set("probe", "after");
    expect(sessionStorage.getItem("probe")).toBe("after");
    sessionStorage.removeItem("probe");
  });
});

describe("根布局真的挂了它", () => {
  const source = readFileSync(LAYOUT, "utf8");

  it("读到的确实是 layout.tsx", () => {
    // 路径写错时,下面两条会对着空串跑 —— 而空串里既没有 import 也没有标签,
    // 那时 `toContain` 会红,但红的理由会是错的。这条让理由是对的。
    expect(source).toContain("export default async function RootLayout");
  });

  it("import 了 PlatformProvider", () => {
    expect(source).toMatch(
      /import\s+\{\s*PlatformProvider\s*\}\s+from\s+["']@\/src\/components\/providers\/PlatformProvider["']/
    );
  });

  it("并且渲染了它 —— 只 import 不渲染,打包器可能整块摇掉", () => {
    expect(source).toMatch(/<PlatformProvider\s*\/>/);
  });
});
