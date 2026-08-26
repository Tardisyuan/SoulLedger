/**
 * @jest-environment node
 *
 * `min-h-screen` 只准出现在 AppLayout 之外的路由上。
 *
 * WHY THIS FILE EXISTS. `src/components/layout/AppLayout.tsx:418` 把页面放进一个
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

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "app");

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
 * 允许写 `min-h-screen` 的文件,以及它们各自对应哪一条豁免路由。
 *
 * 这张表是手写的 —— 路由组 `(auth)` 到 URL 的映射不是机械可推的。所以下面有
 * 一条测试把它与 `AppLayoutWrapper` 里那两个数组双向对上:任何人新增一条公开
 * 路由而不更新这里,那条测试就会红,而不是让一个新的全屏页悄悄合法。
 */
const OUTSIDE_APP_LAYOUT: Record<string, string> = {
  "app/page.tsx": "/ — PUBLIC_PATHS",
  "app/(auth)/layout.tsx": "/login, /register — AUTH_PATHS",
  "app/(auth)/login/page.tsx": "/login — AUTH_PATHS",
};

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
    expect(FILES.map((f) => path.relative(ROOT, f))).toContain("app/page.tsx");
  });

  it("AppLayout 槽位里的文件一个都没有写 min-h-screen", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const rel = path.relative(ROOT, file);
      if (rel in OUTSIDE_APP_LAYOUT || rel in CONTAINS_APP_LAYOUT) continue;
      // 注释里提到这个类名是允许的 —— 这一轮有四个文件的注释在解释为什么**不**
      // 写它,把那些判成违规会教人删掉解释,而解释正是下一个读者需要的东西。
      const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      if (code.includes("min-h-screen")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("豁免清单与 AppLayoutWrapper 的两个数组对得上", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/components/layout/AppLayoutWrapper.tsx"),
      "utf8",
    );
    const read = (name: string) => {
      const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
      expect(m).not.toBeNull();
      return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    };
    const auth = read("AUTH_PATHS");
    const publik = read("PUBLIC_PATHS");

    // 每个豁免文件的注记里必须写明它对应哪条路由,而那条路由必须真的在这两个
    // 数组里 —— 否则豁免是在为一条已经不存在的路由放行。
    for (const [file, note] of Object.entries(OUTSIDE_APP_LAYOUT)) {
      const routes = note.split("—")[0].split(",").map((r) => r.trim());
      for (const route of routes) {
        expect({ file, route, known: [...auth, ...publik].includes(route) }).toMatchObject({
          known: true,
        });
      }
    }

    // 反向:两个数组里的每一条路由都必须被某个豁免文件认领。新增一条公开路由
    // 却不更新这里,这条会红。
    for (const route of [...auth, ...publik]) {
      const claimed = Object.values(OUTSIDE_APP_LAYOUT).some((n) =>
        n.split("—")[0].split(",").map((r) => r.trim()).includes(route),
      );
      expect({ route, claimed }).toMatchObject({ claimed: true });
    }
  });
});
