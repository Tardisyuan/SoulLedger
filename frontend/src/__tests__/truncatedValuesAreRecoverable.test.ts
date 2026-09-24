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
 * 一个带 `truncate` 的 JSX 元素,内容里有 `{表达式}`,开标签上却没有 `title=`。
 *
 * ~~按行而不是按 AST……代价写明:跨行写开的元素这条规则看不见。~~
 * 2026-09-14(审计 FT-07)实测那个代价不是边角:prettier 会把稍长的元素拆成
 * 开标签一行、内容一行,于是 `ProfileCard.tsx` 的用户名、`judgment/[id]` 的
 * 主审·结案时间、`profile` 页的五个字段、`tenants` 的代码行、顶栏的问候语、
 * `SoulLifecycleTimeline` 的两行明细全部漏网 —— 11 处,而规则是绿的。
 *
 * 现在不看换行:在去掉注释的源码里,从每个 `truncate` 往回找最近的 `<Tag`,
 * 按花括号深度与引号向前走到开标签的 `>`,确认类名确实落在这个开标签里;
 * 内容取到下一个 `</` 为止。仍然不是 AST —— 上限写明:类名若先存进变量再
 * `className={X}` 传入,这里看不见(今天没有这种写法)。
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
const TRUNCATING_VALUE = /\btruncate\b|\bline-clamp-\d/;
const HAS_EXPRESSION = /\{[A-Za-z_(]/;
const HAS_TITLE = /\btitle=/;
/** `{t("some.key")}` alone is copy, not data: static text truncated is layout. */
const STATIC_COPY = /\{\s*tf?\(\s*(["'])[^"']*\1\s*\)\s*\}/g;

/** 按行为豁免的位置。加一项要写理由。 */
const EXEMPT = [
  {
    file: "src/components/layout/SidebarMenuItem.tsx",
    why: "同一轮已经给这两处加了 `aria-label={label}` —— 同一串字,再加 title 是第三份拷贝",
  },
];

/** Comments blanked to spaces, so offsets and line numbers survive. */
function blankComments(source: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<![:\w])\/\/[^\n]*/g, blank);
}

/** The JSX opening tag that contains `idx`, brace- and quote-aware; null if none. */
function openingTagAround(src: string, idx: number): { start: number; end: number } | null {
  let start = src.lastIndexOf("<", idx);
  while (start !== -1 && !/[A-Za-z]/.test(src[start + 1] ?? "")) start = src.lastIndexOf("<", start - 1);
  if (start === -1) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && c === ">") return i > idx ? { start, end: i } : null;
  }
  return null;
}

function offendersIn(rel: string, raw: string): string[] {
  const src = blankComments(raw);
  const found: string[] = [];
  const seen = new Set<number>();
  for (const m of src.matchAll(new RegExp(TRUNCATING_VALUE, "g"))) {
    const tag = openingTagAround(src, m.index ?? 0);
    if (!tag || seen.has(tag.start)) continue;
    seen.add(tag.start);
    if (src[tag.end - 1] === "/") continue; // self-closing: no content to lose
    const open = src.slice(tag.start, tag.end + 1);
    const content = src.slice(tag.end + 1, src.indexOf("</", tag.end));
    if (!HAS_EXPRESSION.test(content.replace(STATIC_COPY, ""))) continue;
    if (HAS_TITLE.test(open)) continue;
    found.push(`${rel}:${src.slice(0, tag.start).split("\n").length}`);
  }
  return found;
}

function offenders(): string[] {
  return FILES.flatMap((full) => {
    const rel = path.relative(path.join(__dirname, "..", ".."), full);
    if (EXEMPT.some((e) => rel === e.file)) return [];
    return offendersIn(rel, readFileSync(full, "utf8"));
  });
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

describe("the scanner does not depend on line breaks", () => {
  it("sees an element whose content sits on the next line", () => {
    const src = '<h2\n  className="text-md truncate"\n>\n  {profile.username}\n</h2>';
    expect(offendersIn("x.tsx", src)).toEqual(["x.tsx:1"]);
  });

  it("accepts a title on the opening tag, copy-only content, and self-closing tags", () => {
    expect(offendersIn("x.tsx", '<h2 title={u}\n className="truncate">\n{u}\n</h2>')).toEqual([]);
    expect(offendersIn("x.tsx", '<h3 className="truncate">\n{t("a.b")}\n</h3>')).toEqual([]);
    expect(offendersIn("x.tsx", '<Skeleton className={cn("truncate", x)} />')).toEqual([]);
  });

  it("ignores the class named in a comment", () => {
    expect(offendersIn("x.tsx", '{/* `truncate` here */}\n<p>{value}</p>')).toEqual([]);
  });
});

describe("a truncated value can be read in full", () => {
  it("每一处承载数据的截断都带 title", () => {
    expect(offenders()).toEqual([]);
  });
});
