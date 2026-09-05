/**
 * 被截断的值要有办法看全。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 先更正一件事:读屏**一直**拿得到全文。审计说拿不到,那条是错的。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 实测构建产物(`.next/static/chunks/*.css`):
 *
 *     .truncate{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
 *
 * 三条都是**视觉**属性 —— 文本节点是完整的,留在 DOM 里。所以读屏、复制粘贴、
 * 页内查找都拿得到全文。`line-clamp-2` 同理。
 *
 * 真正断掉的是**看得见的人**:
 *
 *   鼠标:没有 `title`,只能改窗口宽度
 *   触摸:没有 hover,`title` 也帮不上 —— **这一层仍然没有覆盖**
 *
 * 所以这次做的是把鼠标那一层补齐(45 处里 44 处此前没有任何东西),并把触摸
 * 那一层的缺口写下来而不是假装它被补上了。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么没有加 Tooltip
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `@base-ui/react` 的 `tooltip/` 子路径已经装好了,0 新依赖。但它的触发是
 * hover / focus,对一个不可聚焦的 `<span>` **既不解决触摸也不解决读屏** ——
 * 而这两条正是 `title` 的真缺陷。它只解决「延迟不可控」和「不能有结构」,
 * 那两条这里都不是问题。触摸可达的是 `Popover`(已在用),但把每一个可能被
 * 截断的值都变成一个可点开的浮层,是给 45 个位置加一个交互层去解决一个
 * 「窗口窄的时候才出现」的问题。
 *
 * 更好的那条路径在树里已经有雏形:`IdentifierChip`(`DomainValue.tsx:199`)
 * 的自述正是这件事 ——「读起来短,复制得全」—— 但它只服务 id。把它推广到
 * 一般文本是一次真正的修复,也是一次比这次大得多的改动,不在这次范围里。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这道守卫问的是什么
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 只看**承载数据**的截断:元素上有 `truncate`,而且它的内容是一个表达式
 * (`{...}`)。静态文案被截断是排版问题,不是数据恢复问题 —— 那句话就写在源码里。
 *
 * 两处豁免,而且是按**行为**豁免不是按路径:`SidebarMenuItem` 的两处已经带着
 * `aria-label={label}`(同一轮加的),再加一个 `title` 是同一串字的第三份拷贝;
 * 而侧栏的宽度是照着这些标签设计的。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["app", "src", "components"].map((d) =>
  path.join(__dirname, "..", "..", d)
);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...tsxFiles(full));
    } else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const FILES = ROOTS.filter((r) => {
  try {
    return statSync(r).isDirectory();
  } catch {
    return false;
  }
}).flatMap(tsxFiles);

/**
 * 一行里同时有 `truncate` 和一个 `{表达式}` 内容,却没有 `title=`。
 *
 * 按行而不是按 AST:这些都是单行 JSX 元素,而一个 AST 版本要理解 className
 * 里的模板串、`cn()` 调用和展开属性 —— 那是一个大得多的东西,为了同一个答案。
 * 代价写明:跨行写开的元素这条规则看不见。
 */
/**
 * `truncate` **和** `line-clamp-N`。
 *
 * 第一版只扫 `truncate`,于是 `components/ui/data-grid/columns.tsx` 的 `text`
 * 列漏掉了 —— 它用 `line-clamp-2`,夹的是**两行之后**的内容,连省略号之后那一段
 * 都读不到,而它装的正是描述、理由、新身份这类长文本。同一个缺陷,另一个类名。
 *
 * 规则的主体清单选窄了,和这个仓库记过的其它几次一样。
 */
const TRUNCATING_VALUE = /truncate|line-clamp-\d/;
const HAS_EXPRESSION = /\{[A-Za-z_]/;
const HAS_TITLE = /title=/;

/** 按行为豁免的位置。加一项要写理由。 */
const EXEMPT = [
  {
    file: "src/components/layout/SidebarMenuItem.tsx",
    why: "同一轮已经给这两处加了 `aria-label={label}` —— 同一串字,再加 title 是第三份拷贝",
  },
];

function offenders(): string[] {
  const found: string[] = [];
  for (const full of FILES) {
    const rel = path.relative(path.join(__dirname, "..", ".."), full);
    if (EXEMPT.some((e) => rel === e.file)) continue;
    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
      if (!TRUNCATING_VALUE.test(line)) return;
      if (!HAS_EXPRESSION.test(line)) return;
      if (HAS_TITLE.test(line)) return;
      found.push(`${rel}:${i + 1}`);
    });
  }
  return found;
}

describe("the scan is looking at something", () => {
  it("finds the app's tsx files", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(80);
  });

  it("finds truncating elements at all", () => {
    // 45 today. A floor: a rule with no subjects is a rule that cannot fail.
    const truncating = FILES.filter((f) => TRUNCATING_VALUE.test(readFileSync(f, "utf8")));
    expect(truncating.length).toBeGreaterThanOrEqual(15);
  });
});

describe("a truncated value can be read in full", () => {
  it("每一处承载数据的截断都带 title", () => {
    expect(offenders()).toEqual([]);
  });
});
