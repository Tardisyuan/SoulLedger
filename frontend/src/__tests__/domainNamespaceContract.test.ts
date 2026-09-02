/**
 * @jest-environment node
 *
 * 每一个被 `<DomainEnum namespace="…">` 引用的命名空间，三份 bundle 里都必须有。
 *
 * WHY THIS FILE EXISTS. `src/components/social/PostCard.tsx` 渲染
 * `<DomainEnum namespace="social.visibility" value={post.visibility} />`，而
 * `social.visibility` **在 en / zh-Hans / egy 三份里一个都没有**。后果不是报错：
 * `DomainEnum` 解析不到就落到 `MissingValue`，于是生产环境里每一条帖子的可见性
 * 徽章都渲染成「—」。没有任何东西报红，因为——
 *
 *   * 键集契约只比对**三份 bundle 之间**是否一致。三份一致地都缺同一个东西时，
 *     它是绿的。这正是 `civilizationCopyCoverage.test.ts` 存在的理由，但那一条
 *     只覆盖四个文明相关的六个命名空间，不覆盖别的。
 *   * `tsc` 看不见：`namespace` 是 `string`，不是键的联合类型。
 *   * 组件也不会喊：渲染 MissingValue 是它对「这一格没有记录」的正常反应，
 *     而「翻译没写」和「数据没有」在它眼里长得一模一样。
 *
 * 扫描的是 `namespace="…"` 而不是 `t("…")`。字面量 `t()` 调用有 809 处，实测
 * 全部能解析——那一族没有洞。有洞的是这一族，因为命名空间只是**前缀**，成员由
 * 运行时数据带来，所以「这个键存在吗」这个问题在源码里根本没有被问出来过。
 *
 * 断言的是命名空间存在且是个非空对象，不是逐个成员齐全：成员的权威来源在后端
 * 枚举里，那由 `backend/tests/test_frontend_statute_enums.py` 与
 * `civilizationCopyCoverage.test.ts` 各自按自己的主体清单守。这里守的是让
 * `social.visibility` 溜过去的那一个洞，不多不少。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const LOCALES = ["en", "zh-Hans", "egy"] as const;

const SOURCE_DIRS = ["app", "src", "components"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every `namespace="…"` literal reachable from a component, with where it came from. */
function collectNamespaces(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const dir of SOURCE_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/namespace=\{?"([a-zA-Z0-9_.]+)"/g)) {
        const rel = path.relative(ROOT, file);
        const seen = found.get(m[1]) ?? [];
        if (!seen.includes(rel)) seen.push(rel);
        found.set(m[1], seen);
      }
    }
  }
  return found;
}

function resolve(bundle: unknown, dotted: string): unknown {
  let cur: unknown = bundle;
  for (const seg of dotted.split(".")) {
    if (typeof cur !== "object" || cur === null || !(seg in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const NAMESPACES = collectNamespaces();
const BUNDLES = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, "..", "packages", "core", "messages", `${l}.json`), "utf8"))]),
) as Record<(typeof LOCALES)[number], unknown>;

describe("每个 DomainEnum 命名空间在三份 bundle 里都存在", () => {
  // 防空转。扫描器一旦失效——正则改坏、目录改名、`namespace` 换了写法——
  // 下面那条 it.each 就会变成空遍历、恒绿，而恒绿和「全都齐了」在 CI 输出里
  // 长得一模一样。这正是本文件要挡的那类失效，所以它自己先要挡住。
  it("扫描器确实扫到了东西", () => {
    expect(NAMESPACES.size).toBeGreaterThanOrEqual(15);
    expect([...NAMESPACES.keys()]).toContain("social.visibility");
  });

  it.each([...NAMESPACES.keys()].sort())("%s", (ns) => {
    for (const locale of LOCALES) {
      const node = resolve(BUNDLES[locale], ns);
      expect({ locale, ns, node }).toMatchObject({
        node: expect.any(Object),
      });
      expect(Object.keys(node as object).length).toBeGreaterThan(0);
    }
  });

  it("三份 bundle 为同一个命名空间给出同一组成员键", () => {
    // 三份一致地都缺，是键集契约唯一抓不到的形状；这里反过来钉住：既然存在，
    // 就必须三份的成员键完全相同，否则切一次语言就少一个徽章。
    for (const ns of NAMESPACES.keys()) {
      const keysets = LOCALES.map((l) => {
        const node = resolve(BUNDLES[l], ns);
        return Object.keys((node ?? {}) as object).sort();
      });
      expect({ ns, "zh-Hans": keysets[1] }).toEqual({ ns, "zh-Hans": keysets[0] });
      expect({ ns, egy: keysets[2] }).toEqual({ ns, egy: keysets[0] });
    }
  });
});
