import path from "node:path";
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

const ROOT = import.meta.dirname;
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

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

    "no-raw-palette": makeGuard("palette", (raw, report) => {
      for (const { bare, chunk, at } of classTokens(raw)) {
        if (RAW_PALETTE.test(bare)) {
          report(chunk, at, `\`${bare}\` 是 Tailwind 原生调色板,不是主题 token —— 它在深色下能看,切到浅色就失效或过淡。用 canvas / surface-1…4 / hairline / ink / accent`);
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

// ── LEGACY 基线 ──────────────────────────────────────────────────────────────
// 每个键是**当前**该文件的违规条数,由 `npx eslint app src` 实测得出,不是估计。
// 超过 → 报红(有人在遗留文件里新增了违规);低于 → 也报红(基线过期)。
// 没有条目的文件额度是 0 —— 这就是「新文件一律 error」的实现。
// 第三波迁移完一个文件,把对应数字改小,或整行删掉。
// 下面这段必须保持合法 JSON:src/__tests__/designGuardContract.test.ts 会
// 按标记切出来 JSON.parse,并逐条核对文件仍然存在(删了文件却留着基线,
// 是这套机制唯一无法自己发现的漏洞 —— 因为 ESLint 根本不会去 lint 一个
// 不存在的文件,那条额度会永远静默地留在配置里)。
// @design-guard-baseline-start
const LEGACY = {
  "app/(auth)/login/page.tsx": {
    "radius": 4,
    "space": 5,
    "type": 5
  },
  "app/admin/stats/error.tsx": {
    "palette": 1,
    "radius": 2,
    "type": 2
  },
  "app/error.tsx": {
    "palette": 1,
    "radius": 2,
    "type": 2
  },
  "app/not-found.tsx": {
    "radius": 1,
    "type": 2
  },
  "src/components/charts/LazyWorkflowEditor.tsx": {
    "radius": 1
  },
  "src/components/connection-status.tsx": {
    "palette": 5,
    "space": 1,
    "type": 1
  },
  "src/components/judgment/JudgmentQueueConsole.tsx": {
    "radius": 16,
    "space": 6,
    "type": 32
  },
  "src/components/judgment/JudgmentQueueContext.tsx": {
    "radius": 4,
    "space": 1,
    "type": 16
  },
  "src/components/layout/AppLayout.tsx": {
    "radius": 16,
    "space": 3,
    "type": 17
  },
  "src/components/layout/MenuGloss.tsx": {
    "type": 1
  },
  "src/components/layout/TenantSignal.tsx": {
    "space": 2
  },
  "src/components/permissions/PermissionFormModal.tsx": {
    "palette": 1,
    "radius": 5,
    "type": 10
  },
  "src/components/permissions/RoleFormModal.tsx": {
    "palette": 1,
    "radius": 4,
    "type": 7
  },
  "src/components/rbac/PermissionDenied.tsx": {
    "type": 2
  },
  "src/components/settings/SettingsDrawer.tsx": {
    "palette": 6,
    "radius": 7,
    "type": 11
  },
  "src/components/social/CommentThread.tsx": {
    "palette": 1,
    "radius": 3,
    "type": 9
  },
  "src/components/social/FollowButton.tsx": {
    "radius": 1,
    "space": 1,
    "type": 1
  },
  "src/components/social/PostCard.tsx": {
    "palette": 17,
    "radius": 1,
    "space": 1,
    "type": 4
  },
  "src/components/social/ProfileCard.tsx": {
    "radius": 2,
    "space": 1,
    "type": 6
  },
  "src/components/social/ProfileEditModal.tsx": {
    "radius": 4,
    "type": 6
  },
  "src/components/social/ReactionBar.tsx": {
    "radius": 1,
    "type": 1
  },
  "src/components/souls/DateProblemsPanel.tsx": {
    "radius": 5,
    "space": 5,
    "type": 5
  },
  "src/components/souls/RebirthFormSelect.tsx": {
    "radius": 1,
    "space": 3,
    "type": 2
  },
  "src/components/souls/SoulEditModal.tsx": {
    "palette": 5,
    "radius": 6,
    "type": 11
  },
  "src/components/souls/SoulKarmaLedgerCard.tsx": {
    "radius": 3,
    "space": 5,
    "type": 12
  },
  "src/components/souls/SoulLifecycleTimeline.tsx": {
    "radius": 8,
    "space": 13,
    "type": 15
  },
  "src/components/souls/SoulReadingPanel.tsx": {
    "radius": 3,
    "space": 6,
    "type": 29
  },
  "src/components/ui/DomainValue.tsx": {
    "radius": 1,
    "space": 2
  },
  "src/components/ui/IconPicker.tsx": {
    "palette": 6,
    "radius": 4,
    "type": 6
  },
  "src/components/ui/Modal.tsx": {
    "palette": 12,
    "radius": 10,
    "space": 4,
    "type": 18
  },
  "src/components/ui/PageError.tsx": {
    "radius": 1,
    "type": 4
  },
  "src/components/ui/Pagination.tsx": {
    "radius": 2,
    "space": 2,
    "type": 3
  },
  "src/components/users/UserDeleteDialog.tsx": {
    "palette": 2,
    "radius": 3,
    "type": 6
  },
  "src/components/users/UserModal.tsx": {
    "palette": 2,
    "radius": 8,
    "type": 14
  },
  "src/components/workflow/WorkflowEditor.tsx": {
    "palette": 10,
    "radius": 18,
    "space": 7,
    "type": 19
  }
};
// @design-guard-baseline-end

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
    // 遗留豁免之一:遮罩层。已报主会话排期,不是「关掉规则求绿」。
    // (no-autofocus 是另一类、另一份清单,在下一个块;两类的名单不重合,
    //  所以是两个 object —— 见下面那段关于为什么不能合并的记录。)
    //
    // AppLayout.tsx:109 / SettingsDrawer.tsx:88 —— 各有一个纯 onClick 的
    // <div> 遮罩层。这正是 click-events-have-key-events 与
    // no-static-element-interactions 要抓的形状(和工作流那个 bug 同款)。
    // 修法是把遮罩换成 <button type="button" aria-label={关闭} className=…>,
    // 或补 role="button" tabIndex={0} onKeyDown={Esc/Enter}。这两个文件不
    // 属于本次改动的所有权范围,所以只挂账不动手。
    //
    // 为什么这里是两个 object 而不是一个 —— flat config 的一个 object 会把它
    // `rules` 里的每条规则施加到 `files` 里的每个文件。这里原先是 6 个文件 ×
    // 3 条规则写在一起,于是 `src/components/ui/Modal.tsx`(全站共享的对话框
    // 组件)也被关掉了那两条 onClick 规则,而它只需要 no-autofocus。后果不是
    // 多一条红,是少一条:下一个在 Modal 里加 `<div onClick>` 遮罩的人不会被
    // 抓到,而 Modal 恰好是最可能长出遮罩的地方。这是 CLAUDE.md 记的那个子
    // 形态 —— 检查会跑也会报红,但主体清单选错了。清单按理由分,不按方便分。
    // 实证(用 ESLint API 把一个 `<div onClick>` 挂到各文件路径下,不改文件):
    //   合并时 Modal / UserModal / SoulEditModal / profile → 四个全 SILENT
    //   拆开后 同样四个 → 全 RED;AppLayout / SettingsDrawer 仍按理由 SILENT
    //   再合回去 → 又全部 SILENT。双向都跑过。
    files: [
      "src/components/layout/AppLayout.tsx",
      "src/components/settings/SettingsDrawer.tsx",
    ],
    rules: {
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
    },
  },
  {
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
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
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
