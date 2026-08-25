/**
 * @jest-environment node
 *
 * 守卫的守卫。
 *
 * eslint.config.mjs 里那五条设计系统规则、那两条键盘可达性规则,和 lib/utils.ts
 * 里 tailwind-merge 的字号分组,都是**验证机制**。这个仓库有一整条记录讲验证
 * 机制会静默失效 —— 失效时它们不报错,只是不再报红,而「不报红」和「没问题」
 * 在 CI 输出里长得一模一样。所以每一条都必须有一个会因为它消失而变红的测试。
 *
 * 这里不重写规则的逻辑,而是**驱动真正的 ESLint**去 lint 一段故意违规的代码,
 * 断言它确实被抓住。规则被删掉、被降级成 warn、`files` 通配符被改窄、插件没
 * 挂上 —— 任何一种,这里都会红。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { cn } from "@/lib/utils";

const ROOT = path.resolve(__dirname, "../..");

type Msg = { ruleId: string | null; severity: number; fatal?: boolean; message: string };

// ESLint 必须在**子进程**里跑,不能用 jest 内的 ESLint API:flat config 是
// eslint.config.mjs,ESLint 用动态 import() 加载它,而 jest 的 CJS 运行时没开
// --experimental-vm-modules,那个 import 会直接抛。子进程是原生 node,没这问题。
//
// 另外 parserOptions.project 要求文件真实存在于 tsconfig 里,而这里 lint 的是
// 内存中的虚拟文件。被测的七条规则都不需要类型信息,所以只关掉类型服务 ——
// 其余配置完全走仓库里那一份,测的必须是真配置,不是一份为测试搭的复制品。
const RUNNER = `
(async () => {
  const { ESLint } = require("eslint");
  const e = new ESLint({ cwd: process.cwd(), overrideConfig: { languageOptions: { parserOptions: { project: null } } } });
  const snippets = JSON.parse(process.argv[1]);
  const out = [];
  for (const code of snippets) {
    const [r] = await e.lintText(code, { filePath: "src/__design_guard_probe__.tsx" });
    out.push(r.messages);
  }
  process.stdout.write(JSON.stringify(out));
})();
`;

// execFileSync 在子进程非零退出时**抛异常**,这一条是有意的:配置本身崩掉
// (比如规则里引用了作用域外的变量)时 eslint 的退出码是 **2**,不是 1 ——
// 「配置炸了」和「发现了违规」是两个不同的失败,而 `eslint … | tail; echo $?`
// 会把退出码 2 和退出码 0 一起读成 0,于是崩溃的检查和通过的检查长得一模一样。
// 实测:把 `RHYTHM_EXEMPT[file]` 改成一个未定义变量 → eslint REAL_EXIT=2、
// 管道后 $?=0、而这里 jest REAL_EXIT=1(七条规则测试同时红)。所以这套契约
// 测试对「配置根本没跑起来」也是红的,不只对「规则失效」。
function lintAll(snippets: string[]): Msg[][] {
  const raw = execFileSync(process.execPath, ["-e", RUNNER, JSON.stringify(snippets)], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const all: Msg[][] = JSON.parse(raw);
  for (const msgs of all) {
    const fatal = msgs.find((m) => m.fatal);
    if (fatal) throw new Error(`probe failed to parse: ${fatal.message}`);
  }
  return all;
}

describe("设计系统守卫:每条规则单独可证伪", () => {
  const cases: Array<[string, string, string]> = [
    ["design-system/type-scale", "旧档字号", '<div className="text-sm" />'],
    ["design-system/spacing-rhythm", "节奏外间距", '<div className="p-5" />'],
    ["design-system/dead-radius", "归零的死圆角", '<div className="rounded-lg" />'],
    ["design-system/no-raw-palette", "裸调色板", '<div className="bg-red-500" />'],
    ["design-system/no-hex-colour", "写死的十六进制", '<div style={{ color: "#abcdef" }} />'],
    ["jsx-a11y/click-events-have-key-events", "只能点不能敲", "<div onClick={() => {}}>x</div>"],
    ["jsx-a11y/no-static-element-interactions", "非交互元素接交互", "<div onClick={() => {}}>x</div>"],
  ];

  // 全部违规片段 + 一个「全部合规」片段,一次子进程跑完。
  const CLEAN =
    'export const P = () => (<div className="p-4 gap-6 mx-auto text-04 text-01 rounded-full rounded-focus bg-surface-1 text-ink border-hairline" />);\n';
  let fired: Array<Array<string | null>>;
  let clean: Msg[];

  beforeAll(() => {
    const snippets = [...cases.map(([, , jsx]) => `export const P = () => (${jsx});\n`), CLEAN];
    const all = lintAll(snippets);
    clean = all[all.length - 1];
    fired = all.slice(0, -1).map((msgs) => msgs.map((m) => m.ruleId));
  }, 60_000);

  it.each(cases.map((c, i) => [...c, i] as [string, string, string, number]))(
    "%s 抓得住%s",
    (ruleId, _what, _jsx, i) => {
      expect(fired[i]).toContain(ruleId);
    },
  );

  it("这些规则都是 error,不是 warn(裸 `eslint .` 遇到 warning 退出码仍是 0)", () => {
    const all = lintAll([
      'export const P = () => (<div className="p-5 text-sm rounded-lg bg-red-500" onClick={() => {}}>x</div>);\n',
    ])[0];
    const guarded = all.filter(
      (m) => m.ruleId?.startsWith("design-system/") || m.ruleId?.startsWith("jsx-a11y/"),
    );
    expect(guarded.length).toBeGreaterThanOrEqual(6);
    expect(guarded.filter((m) => m.severity !== 2)).toEqual([]);
  }, 60_000);

  it("放行被批准的词汇 —— 否则第三波迁完仍然是红的,规则就会被删掉", () => {
    expect(clean.filter((m) => m.ruleId?.startsWith("design-system/"))).toEqual([]);
  });
});

describe("LEGACY 基线", () => {
  const config = fs.readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8");
  const slice = config.split("@design-guard-baseline-start")[1]?.split("@design-guard-baseline-end")[0] ?? "";
  const json = slice.slice(slice.indexOf("{"), slice.lastIndexOf("}") + 1);
  const baseline: Record<string, Record<string, number>> = JSON.parse(json);

  it("被切得出来,而且非空", () => {
    expect(Object.keys(baseline).length).toBeGreaterThan(0);
  });

  // 这是整套机制唯一无法自己发现的漏洞:文件被删掉后,ESLint 根本不会去 lint
  // 一个不存在的路径,那条额度就永远静默地留在配置里 —— 直到有人新建一个同名
  // 文件,凭空继承一份违规额度。
  it.each(Object.keys(baseline))("%s 仍然存在", (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
  });

  /**
   * 基线只能记**遗留**。
   *
   * 这条是补一个已经发生过的洞:基线是用「当时磁盘上的 app/ 与 src/」实测生成的,
   * 而生成那一刻,同一波并行的几个代理已经把新建组件写进了工作区。于是
   * `src/components/ui/Badge.tsx` —— 一个当天新建、没有任何历史的文件 —— 拿到了
   * `{ "space": 1 }`,把它的 `py-0.5` 静默吸收掉了。controls 用探针钉死了这一点:
   * 把整串换成 `p-5` 或 `py-1.5`(两个本该报红的例子)在这个文件里都不红,因为
   * 1 hit ≤ budget 1;换成两条违规才红。用它自己的话说,别的文件那个绿是挣来的,
   * Badge 这个绿是买来的。
   *
   * 新文件写进基线,是把一个**当下的设计决定**登记成一笔**待还的债** —— 这两件事
   * 要求的后续动作相反:债要还,决定要留下来被人读到。所以规则是:基线里的每个
   * 路径都必须是 git 已跟踪的文件。
   *
   * 那一项后来按出路 (a) 落地了:Badge 的 `py-0.5` 从 LEGACY 额度改成了
   * eslint.config.mjs 里 `RHYTHM_EXEMPT` 的按类名豁免,所以下面这张待定表现在
   * 是空的。表空了这两条测试就是空遍历、恒绿 —— 留着零成本,下次再有跨文件的
   * 设计决定待定时它就位了。
   */
  const PENDING_DECISION: Record<string, string> = {};

  it("基线里没有本波新建的文件(新文件额度必须是 0)", () => {
    const tracked = new Set(
      execFileSync("git", ["ls-files", "--", "app", "src"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .filter(Boolean),
    );
    const untracked = Object.keys(baseline).filter(
      (rel) => !tracked.has(rel) && !(rel in PENDING_DECISION),
    );
    expect(untracked).toEqual([]);
  });

  it("待定项没有过期(定了之后这张表必须清空)", () => {
    for (const rel of Object.keys(PENDING_DECISION)) {
      // 还留在待定表里,就必须还在基线里 —— 否则这条注释在描述一个不存在的状态。
      expect(Object.keys(baseline)).toContain(rel);
    }
  });

  it("额度都是正整数", () => {
    for (const [rel, budgets] of Object.entries(baseline)) {
      for (const [key, n] of Object.entries(budgets)) {
        expect({ rel, key, n }).toMatchObject({ n: expect.any(Number) });
        expect(n).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * 豁免也会过期。
 *
 * `RHYTHM_EXEMPT` 是「决定」的落点,而决定的寿命和代码一样长 —— 不会更长。
 * 等 components/ui/data-grid/columns.tsx 的 EnumBadge 转调 Badge、徽章统一到
 * py-1,`Badge.tsx` 里就不再有 `py-0.5`,而那条豁免会安静地留在配置里,继续
 * 为一个不存在的类名放行。它的失败模式和 LEGACY 基线过期是同一个:不报错,
 * 只是不再报红。所以这里钉住豁免引用的文件和类名必须都还在用。
 */
describe("RHYTHM_EXEMPT 豁免没有过期", () => {
  const config = fs.readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8");
  // 锚点必须要求名字后面紧跟 `=`。这里原本是 `indexOf("const RHYTHM_EXEMPT")`,
  // 它在**两个**方向上都错:`const RHYTHM_EXEMPT_RENAMED` 会被它认下(重命名
  // 逃过检查),而 `const  RHYTHM_EXEMPT  =`(const 与名字之间两个空格)反而认
  // 不出(一次格式化就让下面三条变成空遍历、恒绿)。换成正则两头都修好,代价
  // 是零 —— 这不是取舍。controls 给的真值表,我复跑过:
  //   const RHYTHM_EXEMPT = {         indexOf ✓  regex ✓
  //   const  RHYTHM_EXEMPT  =  {      indexOf ✗  regex ✓   ← 旧锚点在这里失效
  //   const RHYTHM_EXEMPT_RENAMED = { indexOf ✓  regex ✗   ← 旧锚点在这里放行
  const anchor = /const\s+RHYTHM_EXEMPT\s*=/.exec(config);
  const body = anchor ? config.slice(anchor.index) : "";
  const entries = [...body.slice(0, body.indexOf("};")).matchAll(/"([^"]+)":\s*new Set\(\[([^\]]*)\]\)/g)].map(
    (m) => [m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((c) => c[1])] as const,
  );

  it("解析得出条目(正则失效的话下面两条会变成空遍历、恒绿)", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries.map(([f]) => f))("%s 仍然存在", (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
  });

  it.each(entries.flatMap(([f, cs]) => cs.map((c) => [f, c])))(
    "%s 仍然在用 %s",
    (rel, cls) => {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src).toContain(cls);
    },
  );
});

/**
 * tailwind-merge 不读 tailwind.config.js —— 它有自己硬编码的分组表。所以
 * `text-01`…`text-08` 这批**新增**字号,除非在 lib/utils.ts 里显式登记进
 * font-size 组,否则会掉进 text-COLOR 组,和文字色互相吞掉。
 *
 * 这两处现在是手工同步的。下面这个测试遍历的是 tailwind.config.js 的键,
 * 断言的是 `cn()` 的**行为** —— 所以往 config 里加第九档而忘了改 utils.ts,
 * 这里立刻红,不需要任何人记得同时改两个地方。
 */
describe("tailwind-merge 认识八档字号", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const twConfig = require("../../tailwind.config.js");
  const scale: string[] = Object.keys(twConfig.theme.extend.fontSize);

  it("配置里确实有一套自定义字号", () => {
    expect(scale.length).toBeGreaterThan(0);
  });

  it.each(scale)("text-%s 不与文字色互相吞掉", (step) => {
    const size = `text-${step}`;
    expect(cn("text-black", size).split(" ").sort()).toEqual(["text-black", size].sort());
    expect(cn(size, "text-black").split(" ").sort()).toEqual(["text-black", size].sort());
  });

  it("各档之间仍然互相覆盖(同一属性,后者胜)", () => {
    expect(cn(`text-${scale[0]}`, `text-${scale[scale.length - 1]}`)).toBe(`text-${scale[scale.length - 1]}`);
  });
});
