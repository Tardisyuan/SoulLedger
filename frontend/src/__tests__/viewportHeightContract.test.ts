/**
 * @jest-environment node
 *
 * `min-h-screen` 只准出现在 AppLayout 之外的路由上。
 *
 * WHY THIS FILE EXISTS. `src/components/layout/AppLayout.tsx:461` 把页面放进一个
 * `min-h-[calc(100vh-4rem)]` 的槽位里。页面再写一次 `min-h-screen`,就是 100vh
 * 嵌在 100vh−4rem 里 —— 内容再短也永远多出 64px 死滚动,而且它不报错、不报类型、
 * 不影响任何断言:只是每一条路由都多一根滚动条。
 *
 * 这个缺陷这轮出现了**三次**,三次都是被人读出来的,没有一次是被检查抓到的:
 *   1. 46 个页面文件各自写了一遍(PageShell 的文件头第 3 条记着,
 *      `PageShell.test.tsx` 为 PageShell 钉住了它);
 *   2. `PageSpinner` 自己带着它 —— 而那是 30 个 `loading.tsx` 都采用的组件,
 *      等于把刚删掉的东西从后门发回给每一条路由,它的测试当时还**断言**着它;
 *   3. `app/loading.tsx` 与 `app/admin/stats/loading.tsx` 两份手抄的转圈。
 *
 * 每次修完都「查了一遍别处」,每次都漏。所以这里不再靠查,靠一条会红的规则。
 *
 * 为什么不做成 eslint 规则:合法与否取决于**路由**,不取决于类名 ——
 * `AppLayoutWrapper` 命中 AUTH_PATHS / PUBLIC_PATHS 时直接 `return children`,
 * 那几条路由没有槽位,必须自己给高度。一条只看类名的 lint 规则要么误伤它们,
 * 要么就得把豁免写进配置,而那正是「主体清单选错了」的温床。
 */
import fs from "node:fs";
import path from "node:path";

import { isOutsideAppLayout, pageRoutes, shellFreeLists } from "./support/appRoutes";

// 叫 FRONTEND 不叫 ROOT:jestAlwaysRunList 把名字里带 ROOT 的句柄当成「摸到仓库根」,
// 标成 `*`,于是只改文档的推送也跑它。这份测试只读 frontend/。
const FRONTEND = path.resolve(__dirname, "../..");
const APP = path.join(FRONTEND, "app");

/**
 * 另一类合法,与上面那张表**不是同一件事**,所以分开放。
 *
 * `app/layout.tsx` 的 `min-h-screen` 在 `<body>` 上 —— body 不在槽位里,它**包着**
 * 槽位。把它塞进按路由豁免的那张表会让「这条路由没有 AppLayout」和「这个元素是
 * AppLayout 的祖先」读成同一个理由,而它们下一步该做的事完全不同:前者随路由变,
 * 后者永远不变。
 */
const CONTAINS_APP_LAYOUT: Record<string, string> = {
  "app/layout.tsx": "<body> — AppLayout 的祖先,不是它的内容",
};

/**
 * 允许写 `min-h-screen` 的文件,以及它们各自对应哪些豁免路由 —— **推导**,不手写。
 *
 * 2026-11-10 之前这是一张手写表(路由组 `(auth)` 到 URL 的映射当时被认为不可机械推导),
 * 加 `/goodbye` 就得来这里补一行。现在 `support/appRoutes.ts` 把每个 `page.tsx` 映射到
 * 它的 URL,再用 `AppLayoutWrapper` 自己的两个数组判断它在不在外壳里:
 *   - 一个 `page.tsx`,它的路由不在外壳里 → 豁免;
 *   - `app/` 之下(不含根)的一个 `layout.tsx`,它管的页面里有一个不在外壳里 → 豁免
 *     (`(auth)/layout.tsx` 包着 `/login`)。根 `app/layout.tsx` 不走这条,见上面那张表。
 * 已知的天花板:`(auth)/layout.tsx` 同时包着 `/forgot-password` 等走外壳的页面,
 * 它的豁免对那几页偏宽 —— 与此前手写表一样宽,不是这次放开的。
 */
function outsideAppLayout(): Record<string, string[]> {
  const lists = shellFreeLists();
  const out: Record<string, string[]> = {};
  for (const { file, route } of pageRoutes()) {
    if (!isOutsideAppLayout(route, lists)) continue;
    out[file] = [...(out[file] ?? []), route];
    // 管着这一页的每一层 layout.tsx(到 app/ 为止,不含根)。
    for (let dir = path.posix.dirname(file); dir !== "app"; dir = path.posix.dirname(dir)) {
      const layout = `${dir}/layout.tsx`;
      if (fs.existsSync(path.join(FRONTEND, layout))) out[layout] = [...(out[layout] ?? []), route];
    }
  }
  return out;
}

const OUTSIDE_APP_LAYOUT = outsideAppLayout();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = walk(APP);

describe("min-h-screen 只出现在 AppLayout 之外", () => {
  it("扫描器确实扫到了 app/ 下的文件(否则下面那条是空遍历、恒绿)", () => {
    expect(FILES.length).toBeGreaterThan(60);
    expect(FILES.map((f) => path.relative(FRONTEND, f))).toContain("app/page.tsx");
  });

  it("AppLayout 槽位里的文件一个都没有写 min-h-screen", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const rel = path.relative(FRONTEND, file);
      if (rel in OUTSIDE_APP_LAYOUT || rel in CONTAINS_APP_LAYOUT) continue;
      // 注释里提到这个类名是允许的 —— 这一轮有四个文件的注释在解释为什么**不**
      // 写它,把那些判成违规会教人删掉解释,而解释正是下一个读者需要的东西。
      const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      if (code.includes("min-h-screen")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("AppLayoutWrapper 两个数组里的每一条都豁免着一个真页面", () => {
    const { auth, publik } = shellFreeLists();
    // 读不到数组(改成了别的写法)时两边都是空,豁免也是空 —— 下面那条会对着空集合绿。
    expect(auth.length + publik.length).toBeGreaterThan(0);

    // 只有反向。正向那半条(每个豁免文件的路由都被 isOutsideAppLayout 判成外壳外)2026-11-13 删掉了:
    // 那张表就是用同一个函数筛出来的,断言它等于断言函数等于它自己,永远绿。
    // 「外壳里的文件没有写」在上一条,「推导没有把全体页面都判成外壳外」在下一条。
    // 反向:两个数组里的每一条都必须落在磁盘上一个真页面上。指着不存在页面的一条
    // 不豁免任何文件,读起来却像在豁免(`/register` 就是这样)。
    const pages = pageRoutes();
    for (const entry of [...auth, ...publik]) {
      const alone = auth.includes(entry) ? { auth: [entry], publik: [] } : { auth: [], publik: [entry] };
      const claimed = pages.some((p) => isOutsideAppLayout(p.route, alone) && p.file in OUTSIDE_APP_LAYOUT);
      expect({ entry, claimed }).toMatchObject({ claimed: true });
    }
  });

  it("推导真的分得清外壳内外(否则豁免可能是全体页面)", () => {
    // 守卫的守卫:一个把每页都判成「外壳外」的推导会让上面那条规则形同虚设。
    const pages = pageRoutes();
    const outside = pages.filter((p) => p.file in OUTSIDE_APP_LAYOUT);
    expect(outside.length).toBeGreaterThan(0);
    expect(pages.length - outside.length).toBeGreaterThan(30);
  });
});
