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
  const { snippets, filePath } = JSON.parse(process.argv[1]);
  const out = [];
  for (const code of snippets) {
    const [r] = await e.lintText(code, { filePath });
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
//
// 顺带钉死一个「修法本身会静默失效」的坑,因为它在本仓的 shell 里成立:
// 想保留管道又拿真退出码时最常被复制的 `${PIPESTATUS[0]}` 是 **bash** 的写法,
// 而这里的 shell 是 zsh 5.9。zsh 用小写、下标从 1 起的 `pipestatus`,写大写
// 那个不报错,只求值成**空串**。实测三档:
//   exit 0 → PIPESTATUS[0]=[]  pipestatus[1]=[0]   pipefail $?=[0]
//   exit 1 → PIPESTATUS[0]=[]  pipestatus[1]=[1]   pipefail $?=[1]
//   exit 2 → PIPESTATUS[0]=[]  pipestatus[1]=[2]   pipefail $?=[2]
// 空串再喂给 `[ "$x" -ne 0 ]` 会炸或被当成假 —— 一个到处被抄的稳妥写法,在这里
// 静默失效。可移植的只有两条:`set -o pipefail`,或者根本不用管道:
// `cmd > /tmp/out 2>&1; echo $?` 然后 grep 那个文件。`${pipestatus[1]}` 只在
// zsh 对,别写进给别人抄的地方。(zsh 行为由 controls 指出,上表是复跑的。)
/** `filePath` 是有意留出来的参数,不是通用化。规则挂在 eslint.config.mjs 的一个
 *  `files:` glob 上,而这套探针一直只从 `src/__design_guard_probe__.tsx` 这一条
 *  路径打进去 —— 于是「glob 被收窄」这件事本身没有任何测试。它已经发生过两次:
 *  `components/**` 曾整个在名单外,`lib/**` 与 `hooks/**` 到 2026-08-30 才补上。
 *  下面「规则覆盖到每个源码目录」那一段就是靠这个参数写的。 */
function lintAll(
  snippets: string[],
  filePath = "src/__design_guard_probe__.tsx"
): Msg[][] {
  const raw = execFileSync(process.execPath, ["-e", RUNNER, JSON.stringify({ snippets, filePath })], {
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

describe("设计系统规则覆盖到每一个存放源码的目录", () => {
  /** 规则本身有没有效,上面那一段管;这一段管的是它**被指向了哪里**。
   *
   *  两次实证,同一个形状:
   *    - `components/**` 曾不在 glob 里。往 `components/ui/skeleton.tsx` 注入
   *      `text-sm p-5 rounded-lg bg-red-500`,五条设计系统规则报 0 条。
   *    - `lib/**` 与 `hooks/**` 同样不在。往 `lib/utils.ts` 加一个 `#ef4444`
   *      和一个裸调色板 class,`npm run lint` exit 0;同一段放进
   *      `src/components/ui/Badge.tsx` 就红。
   *
   *  两次都不是规则坏了,是名单选错了。所以这里断言的是**路径**,而每条断言
   *  用的是一段五条规则都会命中的代码 —— 只要 glob 漏掉这个目录,五条一起哑。 */
  const OFFENDING =
    '<div className="text-sm p-5 rounded-lg bg-red-500" style={{ color: "#ef4444" }} />';
  const DIRECTORIES = [
    "app/__design_guard_probe__.tsx",
    "src/__design_guard_probe__.tsx",
    "components/__design_guard_probe__.tsx",
    "lib/__design_guard_probe__.tsx",
    "hooks/__design_guard_probe__.tsx",
  ];

  it.each(DIRECTORIES)("%s 受五条规则约束", (filePath) => {
    const [msgs] = lintAll([OFFENDING], filePath);
    const fired = new Set(
      msgs.map((m) => m.ruleId).filter((r): r is string => !!r?.startsWith("design-system/"))
    );
    expect([...fired].sort()).toEqual([
      "design-system/dead-radius",
      "design-system/no-hex-colour",
      "design-system/no-raw-palette",
      "design-system/spacing-rhythm",
      "design-system/type-scale",
    ]);
  });

  it("换成一个不该被覆盖的目录时探针确实会哑(反对照)", () => {
    // 没有这一条,一个「对任何路径都报错」的配置也能让上面五条全绿,
    // 而那意味着上面测的根本不是 glob。
    const [msgs] = lintAll([OFFENDING], "e2e/__design_guard_probe__.tsx");
    const fired = msgs.filter((m) => m.ruleId?.startsWith("design-system/"));
    expect(fired).toEqual([]);
  });
});

describe("设计系统守卫:每条规则单独可证伪", () => {
  const cases: Array<[string, string, string]> = [
    ["design-system/type-scale", "旧档字号", '<div className="text-sm" />'],
    ["design-system/spacing-rhythm", "节奏外间距", '<div className="p-5" />'],
    ["design-system/dead-radius", "归零的死圆角", '<div className="rounded-lg" />'],
    ["design-system/no-raw-palette", "裸调色板", '<div className="bg-red-500" />'],
    // 具名色阶之外的第二种形状。这条规则原本只认 `bg-amber-500`,任意值里的
    // 三元组它一次也没匹配上 —— 而 app/organizations/page.tsx 那 8 处正是这种
    // 写法,基线当时诚实地记着 `palette: 0`。现在代码里这一类是零命中,所以
    // 这条探针是它唯一会被跑到的地方:没有它,规则改坏了没人会知道。
    [
      "design-system/no-raw-palette",
      "任意值里写死的三元组",
      '<div className="bg-[hsl(38,92%,50%,0.2)]" />',
    ],
    ["design-system/no-hex-colour", "写死的十六进制", '<div style={{ color: "#abcdef" }} />'],
    ["jsx-a11y/click-events-have-key-events", "只能点不能敲", "<div onClick={() => {}}>x</div>"],
    ["jsx-a11y/no-static-element-interactions", "非交互元素接交互", "<div onClick={() => {}}>x</div>"],
  ];

  // 全部违规片段 + 一个「全部合规」片段,一次子进程跑完。
  // `bg-[hsl(var(--…))]` 这三种形状必须留在这里,而且必须和上面那条任意值探针
  // 一起读:两条合起来才钉住了判据是「方括号里有没有**字面数字**」,而不是
  // 「有没有 `[hsl(`」。少了这半边,把正则收紧成匹配所有 `-[hsl(` 会照样让上面
  // 那条探针变红、测试全绿 —— 而 app/ 下几百处正当的 token 任意值会一起爆红,
  // 到那时最省事的做法就是把整条规则删掉。带斜杠的不透明度写法要一并钉住:
  // classTokens 会在 `/` 处截断,截断后的残段不能被误判成字面颜色。
  const CLEAN =
    'export const P = () => (<div className="p-4 gap-6 mx-auto text-04 text-01 rounded-full rounded-focus bg-surface-1 text-ink border-hairline ' +
    'bg-[hsl(var(--color-accent))] border-[hsl(var(--color-civ-mark-cn)/0.4)] shadow-[0_0_0_1px_hsl(var(--color-hairline))]" />);\n';
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
  // 基线原本是 eslint.config.mjs 里 `@design-guard-baseline-start/-end` 之间的一段,
  // 这里靠切标记拿到它。数据搬进独立文件后,切法换成直接读那份文件 —— 这消掉了
  // 一个真实的失效模式(标记被改名或被格式化掉,slice 得到空串或 `{}`,下面几条
  // it.each 就变成空遍历、恒绿),但换来一个新的:**两边可能读的不是同一份基线**。
  //
  // 所以下面第一条断言 eslint.config.mjs 的源码里确实出现了这个文件名。少了它,
  // 有人新增 eslint.design-guard-baseline.v2.json、只把配置改过去,这里会继续读
  // 那份没人用的旧文件,把一份僵尸基线核对得干干净净 —— 每条测试都绿,而绿的是
  // 一个已经不参与 lint 的对象。
  const BASELINE_FILE = "eslint.design-guard-baseline.json";
  const config = fs.readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8");
  const baseline: Record<string, Record<string, number>> = JSON.parse(
    fs.readFileSync(path.join(ROOT, BASELINE_FILE), "utf8"),
  );

  it("eslint.config.mjs 读的就是这一份基线", () => {
    expect(config).toContain(BASELINE_FILE);
  });

  it("读得出来,而且非空", () => {
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
    // pathspec 必须与 eslint.config.mjs 的 `files` glob 覆盖同样的三个源根。
    //
    // 这里原本只写 `app` 与 `src`。glob 扩到 `components/**` 之后,那 7 个根
    // `components/` 文件的基线键在这条断言眼里全成了「未跟踪」—— 它们其实
    // `git ls-files` 逐个列得出来,是已跟踪的旧文件,只是新近才被守卫看见。
    // 于是一条用来抓「新文件混进基线」的检查,报的是一批老文件。
    //
    // 同一套机制的第三条腿漏了同一个目录:glob 漏过一次(规则根本没看),
    // 基线漏过一次(没有 components/ 开头的键),这里是第三次。三处各自
    // 维护一份「哪些目录算数」的清单,而它们之间没有任何东西强制一致。
    const tracked = new Set(
      execFileSync("git", ["ls-files", "--", "app", "src", "components"], { cwd: ROOT, encoding: "utf8" })
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
