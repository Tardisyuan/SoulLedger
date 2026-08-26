import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import eslintParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 11 · 设计系统守卫
//
// 第一波把八档字号、方角、四线宽写进了 tailwind.config.js。但 `theme.extend`
// 只能新增或覆盖,不能删除:`text-sm` 仍然解析,`p-5` 仍然解析,`rounded-lg`
// 仍然解析(只是解析成 0)。设计稿里的六档间距、八档字号、两种圆角全都是
// **限制**,而限制在 Tailwind 里没有表达方式 —— 只能由 lint 施加。
//
// 为什么是 `error` 而不是 `warn`:
//   `npm run lint` 是裸 `eslint .`,没有 `--max-warnings`;ci.yml:98 也只是
//   `npm run lint`。ESLint 在只有 warning 时退出码是 0。所以一条 warn 级规则
//   在这个仓库里等于零 —— CI 照常变绿,没有人会去读那几百行黄字。仓库里已经
//   有一整条记录讲「验证机制会静默失效,失败模式是沉默」;把新守卫设成 warn
//   就是主动再造一个。
//
//   迁移期的出路因此不是降级,而是**基线**:LEGACY 记下每个文件当前的违规
//   条数,超出即报红,低于也报红(基线过期同样是静默失效的一种)。新文件没有
//   条目,额度为 0,第一处违规就红。第三波每迁移一个文件,顺手把数字改小或
//   删掉整行 —— 这是机械操作,且无法被悄悄绕过。
// ─────────────────────────────────────────────────────────────────────────────

// `fileURLToPath(import.meta.url)`, NOT `import.meta.dirname`.
//
// `import.meta.dirname` landed in Node 20.11. On anything older it is
// `undefined`, so `rel()` calls `path.relative(undefined, file)` and every rule
// throws `ERR_INVALID_ARG_TYPE` before it examines a single line. ESLint reports
// that as **exit code 2** — a fatal config error, not the exit 1 a violation
// produces — and `eslint … | tail; echo $?` collapses 2, 1 and 0 into the same
// 0. So on an older Node this whole file silently stops being a check while
// reading, through a pipe, exactly like a clean pass.
//
// This was not hypothetical: it was written and verified under Node 22, and the
// first run under this machine's default shell (v18.20.8) crashed on the first
// file. `fileURLToPath` has been stable since Node 10 and costs one import.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

// ── LEGACY 基线 ──────────────────────────────────────────────────────────────
// 每个键是**当前**该文件的违规条数,由 `npx eslint app src` 实测得出,不是估计。
// 超过 → 报红(有人在遗留文件里新增了违规);低于 → 也报红(基线过期)。
// 没有条目的文件额度是 0 —— 这就是「新文件一律 error」的实现。
// 第三波迁移完一个文件,把对应数字改小,或整行删掉。
//
// 数据搬到了 BASELINE_FILE(35 个文件 / 564 条),因为这份配置本身有 500 行上限,
// 而那 167 行是**数据**,不是逻辑 —— 读配置的人要读的是规则怎么算,不是逐行的
// 数字。论证留在这里,理由同样明确:JSON 写不了注释,而上面那段「为什么是 error
// 不是 warn」「为什么低于基线也报红」是这套机制唯一的说明书,搬进数据文件就没了。
// 所以分界是:**为什么**在 .mjs 里,**多少**在 .json 里。
//
// 为什么是 .json 而不是 .mjs:src/__tests__/designGuardContract.test.ts 也要读它,
// 而那个测试跑在 jest 的 CJS 运行时里(没开 --experimental-vm-modules),
// `import()` 一个 .mjs 会直接抛 —— 该文件顶部那段注释就是为这件事写的。JSON 让
// 两边用**同一种方式读同一份字节**:fs.readFileSync + JSON.parse,没有第二条路径
// 可以和第一条产生分歧。
//
// 搬家引入了一个跨文件同步点,而这正是本仓反复出问题的形状,所以两个方向都堵死:
//   文件读不出来 / 不是合法 JSON → readFileSync 或 JSON.parse 当场抛 → ESLint
//     退出码 **2**(致命配置错误),几百个文件一个都没 lint。响的,不是静默的。
//   文件读成了 `{}` → 每个文件额度变 0,35 个遗留文件立刻爆红。同样是响的。
//   测试读的是**另一份**基线 → designGuardContract 有一条断言 eslint.config.mjs
//     的源码里确实出现了它读的那个文件名,所以两边不可能各读各的。
const BASELINE_FILE = "eslint.design-guard-baseline.json";
const LEGACY = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_FILE), "utf8"));

// 八档字号是**新增**的,旧档仍可解析 —— 这些是被禁的旧档。
const LEGACY_TYPE = /^-?text-(?:xs|sm|base|lg|xl|[2-9]xl)$/;

// 设计稿的间距节奏:{1:4px 2:8px 3:12px 4:16px 6:24px 10:40px 16:64px}。
// `0` / `px` / `auto` 不是节奏值,是「无」和「发丝」,放行。
// 只管**节奏类**工具(padding / margin / gap / space),不管尺寸类
// (w- / h- / max-w-):`w-64` 是一个盒子多宽,不是一次节奏决策。
const RHYTHM = /^-?(?:p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy])-(.+)$/;
const RHYTHM_OK = new Set(["0", "1", "2", "3", "4", "6", "10", "16", "px", "auto"]);

// 按**类名**豁免,不是按文件豁免,也不是按条数放行。
//
// 为什么不是 LEGACY 额度:额度和豁免的后续动作相反。额度说「这是债,去还」,
// 豁免说「这是决定,别动」。而额度还有一个更实际的问题 —— 它是按条数计的,
// 于是 `Badge.tsx` 的 `{space: 1}` 会把**任何**一处间距违规吸收掉:实测往
// Badge.tsx 注入 `p-5` 或 `py-1.5`,退出码都是 0,因为 1 hit ≤ budget 1。
// 一个用来挡回归的检查,被一条为已知例外准备的额度挡住了。
//
// 为什么不是给文件关掉整条规则:那会让 Badge.tsx 里的 `p-5` 也一起过关,
// 和把 jsx-a11y 的三条规则一次性关给六个文件是同一个错误 —— 检查会跑、
// 也会报红,但主体清单选错了。
//
// 所以豁免的粒度是「哪个文件的哪一个类名」。controls 提的版本是按**属性**开
// (徽章竖向内距),那会连带放掉别的文件的 py-0.5;收到「哪个文件的哪一个类名」
// 这一档是 main 的裁定。作者:main;探针数据与「额度是债、豁免是决定」的说法
// 出自 controls。记在这里,是因为这段代码曾经有半天时间没人认领 —— 三个 agent
// 各自能证「不是我」,谁都证不出「是谁」。
//
// py-0.5(2px):徽章的高度由字号定,不由页面节奏定。12px 文字要在不撑高表格
// 行的前提下有内距,2px 是唯一取值。它与 components/ui/data-grid/columns.tsx:150
// 的 EnumBadge 逐字对齐,并有一条测试钉住两者几何一致、可互换无视觉差;改成
// py-1 会给每个徽章上下各加 2px,动的是全站表格行高,且在 columns.tsx 跟着
// 迁移之前新旧徽章会并排显示高度差。那是 EnumBadge 转调 Badge 那一次迁移的
// 事,不是这里的事。
const RHYTHM_EXEMPT = {
  "src/components/ui/Badge.tsx": new Set(["py-0.5"]),
};

// borderRadius 现在整张表都是 0,只有 `full`(身份物)与 `focus`(2px 焦点环)
// 有值。所以下面这些类名是**死类名**:它们不产生视觉差异,但会让读代码的人
// 以为那里有圆角。
const DEAD_RADIUS =
  /^rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?(?:-(?:none|sm|md|lg|xl|[23]xl))?$/;

// Tailwind 原生调色板 —— 绕开了主题感知的 token,浅色模式下失效或过淡。
const RAW_PALETTE =
  /^(?:bg|text|border|ring|ring-offset|divide|outline|fill|stroke|from|via|to|shadow|decoration|accent|caret|placeholder)(?:-(?:t|r|b|l|x|y|s|e|tl|tr|br|bl))?-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)$/;

const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;

// 真值颜色的合法例外。这三处不是疏忽,是这些库不吃 CSS 变量:
//   - @xyflow/react 的 `markerEnd` / edge `style` 走 SVG <marker>,在一个
//     独立的 defs 树里渲染,`hsl(var(--color-accent))` 在那里解析不到。
//   - recharts 的 fill / stroke 是 prop 不是 class,同理。
//   - SettingsDrawer 的强调色选择器里,十六进制**就是数据**:它被写进
//     `--color-accent`(见该文件 hexToHsl 调用)。用 token 表达等于自指。
const HEX_ALLOW = [
  "src/components/workflow/",
  "src/components/charts/",
  "src/components/settings/SettingsDrawer.tsx",
];

// 同一份清单要给**两条**规则用(no-hex-colour 与 no-raw-palette 的任意值分支),
// 所以抽成一个函数而不是各写各的 `HEX_ALLOW.some(...)`。理由不是省三行:这三处
// 论证的是「这个文件里真值颜色是合法的」,而不是「这个文件里 `#` 开头的写法是
// 合法的」。要是任意值分支不认这份清单,`#f59e0b` 在 SettingsDrawer 里放行、
// 同一个颜色写成 `hsl(38 92% 50%)` 就报红 —— 两条规则对同一个已经裁定过的例外
// 给出相反的答案,而下一个人只会挑那条不报红的写法绕过去。
const literalColourAllowed = (file) => HEX_ALLOW.some((p) => file.startsWith(p));

// RAW_PALETTE 的盲区:**任意值**。
//
// `bg-amber-500` 匹配得到,`bg-[hsl(38,92%,50%,0.2)]` 匹配不到 —— 后者绕开
// 具名色阶,直接把三元组写进方括号,拿到的却是同一个「不随主题走的死颜色」。
// app/organizations/page.tsx 曾经有 8 处这种写法,而 38° 正是 `--color-accent`:
// 中国文明被画成了全站按钮的颜色,整整一段时间里基线诚实地报 `palette: 0`,
// 因为规则确实一次也没匹配上。那不是漏报,是这条规则当时根本看不见那种形状。
//
// 判据是**方括号里有没有字面数字**,不是有没有 `hsl(`:
//   bg-[hsl(38,92%,50%,0.2)]              → 红,写死的三元组
//   bg-[hsl(var(--color-civ-mark-cn))]    → 绿,token,主题切换跟着走
//   shadow-[0_0_0_1px_hsl(var(--x))]      → 绿,同上
// 这正是 app/ 下几百处 `[hsl(var(--…))]` 的形状 —— 任意值本身不是问题,
// **任意值里锁死的颜色**才是。
//
// 匹配的是 `chunk`(整个空白分隔的 token)而不是 `bare`。bare 被
// `split(":").pop()` 和 `split("/")[0]` 削过:前者会把 `bg-[color:hsl(…)]` 削成
// `hsl(…)]`(前缀没了,锚不住),后者会把 `bg-[hsl(38_92%_50%/0.2)]` 从斜杠处
// 截断。所以前缀在正则里自己处理变体(`(?:^|:)`)与 `!` 重要标记。
//
// 不管 `#`:`bg-[#f59e0b]` 已经归 no-hex-colour —— 那条规则扫的是整个字符串,
// 不经过 classTokens,方括号拦不住它。两条规则各报一次同一处,只会让人以为
// 有两个问题。
const ARBITRARY_LITERAL_COLOUR =
  /(?:^|:)!?(?:bg|text|border|ring|ring-offset|divide|outline|fill|stroke|from|via|to|shadow|decoration|accent|caret|placeholder)(?:-(?:t|r|b|l|x|y|s|e|tl|tr|br|bl))?-\[[^\]]*?\b(?:hsla?|rgba?|oklch|oklab|lch|lab)\(\s*[.\d]/;

function classTokens(raw) {
  const out = [];
  const re = /\S+/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const chunk = m[0];
    // 去掉变体前缀(dark: / md: / hover: / [&>*]: …)与 `!` 重要标记,
    // 再去掉尾部不透明度(bg-red-500/20)。
    const bare = chunk.split(":").pop().replace(/^!/, "").split("/")[0];
    // `at` 是 chunk 在这个字符串里的字符偏移。必须带着它走:同一个字面量里
    // 完全可能出现两次 `text-xs`,只用 indexOf 会把两处都指到第一处的列号,
    // 于是「同一行报两次同一列」——一条看起来像重复输出、实际是定位错误的红。
    if (bare) out.push({ bare, chunk, at: m.index });
  }
  return out;
}

function locOf(context, node, chunk, at) {
  const sc = context.sourceCode;
  const text = sc.getText(node);
  // 字面量文本比它的值多一个引号/反引号前缀;模板元素则从 ` 或 } 之后开始。
  // 用 `at` 附近的窗口去找,而不是全文 indexOf,这样重复 token 也能落对列。
  const i = text.indexOf(chunk, Math.max(0, at));
  if (i < 0) return { node };
  return {
    loc: {
      start: sc.getLocFromIndex(node.range[0] + i),
      end: sc.getLocFromIndex(node.range[0] + i + chunk.length),
    },
  };
}

/**
 * 造一条「扫描所有字符串字面量里的类名」的规则,带按文件的遗留额度。
 * 扫全部字符串而不只是 className=,是因为这个仓库的类名大量住在 cva()、
 * 三元表达式、以及 {CIVILIZATION: "bg-amber-500"} 这样的映射对象里。
 */
function makeGuard(key, scan) {
  return {
    meta: { type: "problem", schema: [], docs: { description: `Stage 11 设计系统守卫: ${key}` } },
    create(context) {
      const file = rel(context.filename);
      const budget = LEGACY[file]?.[key] ?? 0;
      const hits = [];
      const visit = (node, raw) => {
        if (typeof raw !== "string" || !raw) return;
        // `file` is passed in rather than closed over: `scan` is defined at
        // module scope, where the linted filename does not exist. Closing over
        // it threw `ReferenceError: file is not defined` at lint time, which
        // ESLint reports as exit code 2 — a *fatal* error, distinct from the
        // exit 1 a rule violation produces. A check that crashes is not a
        // check that passes, and `| tail; echo $?` would have shown 0 for both.
        scan(raw, (chunk, at, msg) => hits.push({ node, chunk, at, msg }), file);
      };
      return {
        Literal(node) {
          if (typeof node.value === "string") visit(node, node.value);
        },
        TemplateElement(node) {
          visit(node, node.value.cooked);
        },
        "Program:exit"(program) {
          if (hits.length > budget) {
            // 只报超额的那几处(按出现顺序取末尾),不是整份清单。遗留文件
            // 有 13 处旧字号时,新增 1 处应该得到 1 条红字而不是 14 条 ——
            // 一条淹没在 13 条噪音里的红字,和没有这条红字是一回事。
            const tail = budget
              ? ` —— 本文件遗留额度 ${budget} 条,现在 ${hits.length} 条;标出的是超额的 ${hits.length - budget} 处(按出现顺序取末尾,不一定正是你刚写的那处)。不要抬高 eslint.config.mjs 的 LEGACY 数字。`
              : "";
            for (const h of hits.slice(budget)) {
              context.report({ ...locOf(context, h.node, h.chunk, h.at), message: h.msg + tail });
            }
          } else if (hits.length < budget) {
            context.report({
              node: program,
              message: `LEGACY 基线过期:eslint.config.mjs 给本文件的 ${key} 留了 ${budget} 条额度,实际只剩 ${hits.length} 条。把数字改成 ${hits.length}${hits.length === 0 ? "(或删掉整行)" : ""} —— 留着高位等于给回归留了一个无人看守的缺口。`,
            });
          }
        },
      };
    },
  };
}

const designSystem = {
  rules: {
    "type-scale": makeGuard("type", (raw, report) => {
      for (const { bare, chunk, at } of classTokens(raw)) {
        if (LEGACY_TYPE.test(bare)) {
          report(chunk, at, `\`${bare}\` 不在八档字号里。用 text-01…text-08(11/12/13/15/18/22/32/56px),见 tailwind.config.js 的 fontSize`);
        }
      }
    }),

    "spacing-rhythm": makeGuard("space", (raw, report, file) => {
      for (const { bare, chunk, at } of classTokens(raw)) {
        const m = RHYTHM.exec(bare);
        if (
          m &&
          !RHYTHM_OK.has(m[1]) &&
          !m[1].startsWith("[") &&
          !RHYTHM_EXEMPT[file]?.has(bare)
        ) {
          report(chunk, at, `\`${bare}\` 不在间距节奏里。允许的档位是 1/2/3/4/6/10/16(4/8/12/16/24/40/64px),外加 0、px、auto`);
        }
      }
    }),

    "dead-radius": makeGuard("radius", (raw, report) => {
      for (const { bare, chunk, at } of classTokens(raw)) {
        if (DEAD_RADIUS.test(bare)) {
          report(chunk, at, `\`${bare}\` 是死类名:borderRadius 表里 none/sm/md/lg/xl/2xl/3xl 与 DEFAULT 全部是 0,它不产生任何圆角,只让读代码的人以为这里是圆的。删掉它;确实要圆角就用 rounded-full(身份物)或 rounded-focus(焦点环)`);
        }
      }
    }),

    "no-raw-palette": makeGuard("palette", (raw, report, file) => {
      const literalOK = literalColourAllowed(file);
      for (const { bare, chunk, at } of classTokens(raw)) {
        if (RAW_PALETTE.test(bare)) {
          report(chunk, at, `\`${bare}\` 是 Tailwind 原生调色板,不是主题 token —— 它在深色下能看,切到浅色就失效或过淡。用 canvas / surface-1…4 / hairline / ink / accent`);
        } else if (!literalOK && ARBITRARY_LITERAL_COLOUR.test(chunk)) {
          // else if:一个 token 只报一次。具名色阶和任意值互斥,这里主要是把
          // 「两条分支都命中」这种将来才可能出现的形状挡在外面 —— 同一处报两条
          // 红,会让人以为要改两个地方。
          report(chunk, at, `\`${chunk}\` 把颜色写死在任意值里。方括号绕开了具名色阶,但拿到的还是一个不随主题走的死颜色 —— 浅色模式下它不会变。写成 token:\`bg-[hsl(var(--color-accent))]\`、\`text-[hsl(var(--color-ink))]\`,带不透明度就 \`hsl(var(--color-x)/0.2)\`;真需要真值的地方(xyflow markerEnd / recharts prop / 强调色选择器数据)已在 eslint.config.mjs 的 HEX_ALLOW 里列明`);
        }
      }
    }),

    "no-hex-colour": {
      meta: { type: "problem", schema: [], docs: { description: "Stage 11 设计系统守卫: hex" } },
      create(context) {
        const file = rel(context.filename);
        if (HEX_ALLOW.some((p) => file.startsWith(p))) return {};
        const check = (node, raw) => {
          if (typeof raw !== "string") return;
          for (const m of raw.matchAll(HEX)) {
            context.report({
              ...locOf(context, node, m[0], m.index),
              message: `\`${m[0]}\` 是写死的十六进制颜色。主题切换看不见它。用 hsl(var(--color-…)) 或对应的 Tailwind token;真需要真值的地方(xyflow markerEnd / recharts prop / 强调色选择器数据)已在 eslint.config.mjs 的 HEX_ALLOW 里列明`,
            });
          }
        };
        return {
          Literal(node) {
            if (typeof node.value === "string") check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.cooked);
          },
        };
      },
    },
  },
};


const SHARED_GLOBALS = {
  console: "readonly",
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  fetch: "readonly",
  FormData: "readonly",
  URLSearchParams: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  HTMLElement: "readonly",
  SVGElement: "readonly",
  Element: "readonly",
  Node: "readonly",
  React: "readonly",
};

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "scripts/**", "src/__tests__/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: eslintParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: SHARED_GLOBALS,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // ── 无障碍 ──────────────────────────────────────────────────────────────
  // eslint-plugin-jsx-a11y 一直躺在 node_modules 里(eslint-config-next 的传递
  // 依赖),但这份手写 flat config 从来没有引用过那份 config,所以它一条规则
  // 也没跑过。实证:工作流卡片键盘打不开的那个 bug,`npx eslint
  // app/workflow/page.tsx` 在**修复前**就已经是退出码 0 —— lint 从头到尾
  // 证明不了它。
  //
  // 整套 recommended(34 条)+ label-has-associated-control 实测只报 10 处 /
  // 6 个文件,所以全部按 `error` 接上,而不是挑两条。
  {
    files: ["**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      // recommended 里 label-has-for 是 off(已废弃),它的替代品默认不开。
      "jsx-a11y/label-has-associated-control": "error",
    },
  },
  {
    // 为什么这里是两个 object 而不是一个 —— flat config 的一个 object 会把它
    // `rules` 里的每条规则施加到 `files` 里的每个文件。曾经是 6 个文件 ×
    // 3 条规则写在一起,于是 `src/components/ui/Modal.tsx`(全站共享的对话框
    // 组件)也被关掉了那两条 onClick 规则,而它只需要 no-autofocus。后果不是
    // 多一条红,是少一条:下一个在 Modal 里加 `<div onClick>` 遮罩的人不会被
    // 抓到,而 Modal 恰好是最可能长出遮罩的地方。这是 CLAUDE.md 记的那个子
    // 形态 —— 检查会跑也会报红,但主体清单选错了。清单按理由分,不按方便分。
    // 实证(用 ESLint API 把一个 `<div onClick>` 挂到各文件路径下,不改文件):
    //   合并时 Modal / UserModal / SoulEditModal / profile → 四个全 SILENT
    //   拆开后 同样四个 → 全 RED;AppLayout / SettingsDrawer 仍按理由 SILENT
    //   再合回去 → 又全部 SILENT。双向都跑过。
    // no-autofocus 单独一份清单:这 6 处 autoFocus 全部是对话框/内联编辑打开时
    // 把焦点送进第一个输入框,即 WAI-ARIA APG 对 dialog 的规定动作,不是页面
    // 加载时抢焦点。清单是 `grep -n autoFocus` 的实际命中,只有四个文件:
    //   app/profile/page.tsx:136,187,238   src/components/ui/Modal.tsx:184
    //   src/components/souls/SoulEditModal.tsx:143
    //   src/components/users/UserModal.tsx:168
    // AppLayout.tsx 与 SettingsDrawer.tsx **不在**这里 —— 它们一个 autoFocus
    // 也没有,只需要上面那个块的两条遮罩豁免。把它们顺手带进来会重犯刚修掉的
    // 那个错:清单按方便凑,而不是按每个文件实际需要什么。
    files: [
      "app/profile/page.tsx",
      "src/components/souls/SoulEditModal.tsx",
      "src/components/ui/Modal.tsx",
      "src/components/users/UserModal.tsx",
    ],
    rules: {
      "jsx-a11y/no-autofocus": "off",
    },
  },

  // ── 设计系统守卫 ────────────────────────────────────────────────────────
  {
    // `components/**` 是第三个源根,此前**整个不在这五条规则的视野里**。
    //
    // 实证:往 `components/ui/skeleton.tsx` 注入 `text-sm p-5 rounded-lg bg-red-500`,
    // eslint 退出码 1(别的规则报的),而 design-system 规则报了 **0 条**。那个目录装着
    // `data-table.tsx`(13 个页面的表格基准)、`data-grid/*`、`page-section.tsx` ——
    // 全站最共享的几块,一条设计系统规则都没看过。基线 JSON 里也因此没有任何
    // `components/` 开头的键,所以「44 个文件 / 287 处」那个统计从一开始就漏了它们。
    //
    // 这是第六次同一个形状:检查在跑、会报红、主体清单却选错了。前五次分别是
    // jsx-a11y 那个 6 文件 × 3 规则的合并豁免、Badge 的 `{space:1}` 额度、
    // `domainDisplayContract` 把注释读成调用、`civilizationCopyCoverage` 看不见散文
    // 形态的文案、以及 `readingQuantityContract` 自留的过期正则副本。
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    plugins: { "design-system": designSystem },
    rules: {
      "design-system/type-scale": "error",
      "design-system/spacing-rhythm": "error",
      "design-system/dead-radius": "error",
      "design-system/no-raw-palette": "error",
      "design-system/no-hex-colour": "error",
    },
  },

  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        URLSearchParams: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
];

export default eslintConfig;
