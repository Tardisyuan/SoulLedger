/**
 * PageShell —— Stage 11 B 页面外壳。
 *
 * 这个文件盯的不是「渲染出来了吗」，是四条会被无声破坏的规格：
 *   1. `variant="full"` 的含义是**不加 max-width**，不是加一个大的 max-width；
 *   2. 全站唯一的 sticky 是筛选栏（`top-16`），页头**不**跟着滚；
 *   3. 外壳里不许出现 `min-h-screen`（AppLayout 已经给了
 *      `min-h-[calc(100vh-4rem)]`，再写一次就是 64px 死滚动，`app/` 下现有 47 个
 *      文件犯了这个，PageShell 不能把它带进新代码）；
 *   4. 分页位在空结果下保留占位，不塌陷。
 *
 * 每条都写成「断言缺席」而不只是「断言在场」—— 前三条的失败模式都是多出来一个
 * 类名，而「该有的类名还在」在多出来的时候照样是绿的。
 *
 * 文件末尾的 `describe("PageShell density")` 里还有三条**扫源码**的守卫:一条路由
 * 里每个壳的 density 要一致、`<h2>` 的两个角色、顶层区块节奏跟着 density 走。
 * 它们读文件而不是渲染树,因为那三件事都由**页面怎么写**决定,壳看不见;而且
 * jsdom 不解析自定义属性,`text-06` 的 600 在渲染断言里根本不存在。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { PageShell, type PageShellVariant } from "@/src/components/ui/PageShell";

/** 外壳自己负责列宽的四个容器位。variant 的断言只看它们。 */
const WIDTH_SLOTS = [
  "data-page-shell-header",
  "data-page-shell-filters",
  "data-page-shell-body",
  "data-page-shell-pagination",
] as const;

/**
 * 取某个 slot 里真正带列宽类名的那个盒子。
 * header / filters 是外框（管边框与 sticky），列宽在它们的直接子元素上；
 * body / pagination 自己就是那个盒子。
 */
function widthBox(container: HTMLElement, slot: string): HTMLElement {
  const outer = container.querySelector<HTMLElement>(`[${slot}]`);
  if (!outer) throw new Error(`slot [${slot}] not rendered`);
  if (slot === "data-page-shell-body" || slot === "data-page-shell-pagination") {
    return outer;
  }
  const inner = outer.firstElementChild as HTMLElement | null;
  if (!inner) throw new Error(`slot [${slot}] has no inner box`);
  return inner;
}

/** 整棵树上所有元素的 class 字符串（含根元素）。 */
function allClasses(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("*")).map(
    (el) => el.getAttribute("class") ?? ""
  );
}

/** 四个位都给满，这样 variant 的断言能一次覆盖全部四个容器。 */
function renderFull(variant: PageShellVariant) {
  return render(
    <PageShell
      variant={variant}
      title="判决卷宗"
      filters={<span>filters</span>}
      pagination={{ count: <span>共 133 条</span>, controls: <button>下一页</button> }}
    >
      <p>body</p>
    </PageShell>
  );
}

describe("PageShell · variant 决定列宽", () => {
  it("prose 给四个容器位都上 max-w-prose", () => {
    const { container } = renderFull("prose");
    for (const slot of WIDTH_SLOTS) {
      expect(widthBox(container, slot).className).toContain("max-w-prose");
    }
  });

  it("page 给四个容器位都上 max-w-page", () => {
    const { container } = renderFull("page");
    for (const slot of WIDTH_SLOTS) {
      expect(widthBox(container, slot).className).toContain("max-w-page");
    }
  });

  it("不传 variant 时默认是 page", () => {
    const { container } = render(<PageShell title="默认">body</PageShell>);
    expect(container.querySelector("[data-page-shell]")).toHaveAttribute(
      "data-variant",
      "page"
    );
    expect(widthBox(container, "data-page-shell-body").className).toContain("max-w-page");
  });

  it("full 不给任何一个容器位加 max-width —— 是不加类名，不是加一个值", () => {
    const { container } = renderFull("full");
    for (const slot of WIDTH_SLOTS) {
      const cls = widthBox(container, slot).className;
      // `max-w-none` 也算违规：它是「一个 max-width 决定」，会改变外部
      // className 覆盖时 tailwind-merge 的行为。
      expect(cls).not.toMatch(/\bmax-w-/);
      // mx-auto 跟着 max-width 走；没有 max-width 时它是 no-op，留着只会
      // 让类名列表说谎。
      expect(cls).not.toMatch(/\bmx-auto\b/);
    }
  });

  it("full 下仍然保留 px-6 的水平留白（不设上限 ≠ 顶到边）", () => {
    const { container } = renderFull("full");
    for (const slot of WIDTH_SLOTS) {
      expect(widthBox(container, slot).className).toMatch(/\bpx-6\b/);
    }
  });
});

describe("PageShell · 滚动行为", () => {
  it("页头不 sticky", () => {
    const { container } = renderFull("page");
    const header = container.querySelector<HTMLElement>("[data-page-shell-header]")!;
    expect(header.className).not.toMatch(/\bsticky\b/);
    expect(widthBox(container, "data-page-shell-header").className).not.toMatch(
      /\bsticky\b/
    );
  });

  it("筛选栏 sticky 在 top-16，高 56（h-14 + 上下各 12 padding）", () => {
    const { container } = renderFull("page");
    const filters = container.querySelector<HTMLElement>("[data-page-shell-filters]")!;
    expect(filters.className).toMatch(/\bsticky\b/);
    expect(filters.className).toMatch(/\btop-16\b/);
    const inner = widthBox(container, "data-page-shell-filters");
    expect(inner.className).toMatch(/\bh-14\b/);
    expect(inner.className).toMatch(/\bpy-3\b/);
  });

  it("筛选栏是全树唯一的 sticky —— 不传 filters 时一处 sticky 都没有", () => {
    const { container } = render(
      <PageShell title="无筛选" pagination={{ count: <span>0</span> }}>
        body
      </PageShell>
    );
    expect(container.querySelector("[data-page-shell-filters]")).toBeNull();
    expect(allClasses(container).filter((c) => /\bsticky\b/.test(c))).toHaveLength(0);
  });

  it("外壳里没有 min-h-screen —— AppLayout 已经给了 min-h-[calc(100vh-4rem)]", () => {
    const { container } = renderFull("full");
    const offenders = allClasses(container).filter((c) => /\bmin-h-screen\b/.test(c));
    expect(offenders).toEqual([]);
  });
});

describe("PageShell · 页头两行", () => {
  it("每页仅一处 h1，用 text-07", () => {
    const { container } = render(
      <PageShell title="判决卷宗" subtitle="一句副标题" eyebrow="LEDGER / 0042">
        <h2>区块标题</h2>
      </PageShell>
    );
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("判决卷宗");
    expect(h1s[0].className).toMatch(/\btext-07\b/);
  });

  it("eyebrow 是 text-01 + font-mono + uppercase", () => {
    const { container } = render(<PageShell title="T" eyebrow="LEDGER / 0042">body</PageShell>);
    const eyebrow = container.querySelector<HTMLElement>("[data-page-shell-eyebrow]")!;
    expect(eyebrow).toHaveTextContent("LEDGER / 0042");
    expect(eyebrow.className).toMatch(/\btext-01\b/);
    expect(eyebrow.className).toMatch(/\bfont-mono\b/);
    expect(eyebrow.className).toMatch(/\buppercase\b/);
  });

  it("副标题是 text-04 + text-[oklch(var(--color-ink-subtle))]", () => {
    const { container } = render(<PageShell title="T" subtitle="一句副标题">body</PageShell>);
    const sub = container.querySelector<HTMLElement>("[data-page-shell-subtitle]")!;
    expect(sub.className).toMatch(/\btext-04\b/);
    expect(sub.className).toContain("text-[oklch(var(--color-ink-subtle))]");
  });

  it("不画面包屑 —— AppLayout.tsx:260 已经有一条，两边都画就是重复", () => {
    const { container } = render(
      <PageShell title="判决卷宗" eyebrow="LEDGER / 0042">
        body
      </PageShell>
    );
    // 面包屑是 <nav><ol>；PageShell 一个导航地标都不产生。
    expect(container.querySelectorAll("nav")).toHaveLength(0);
    expect(container.querySelectorAll("ol")).toHaveLength(0);
  });

  it("eyebrow / subtitle / actions 不传就整段不渲染，不留空盒子", () => {
    const { container } = render(<PageShell title="光杆标题">body</PageShell>);
    expect(container.querySelector("[data-page-shell-eyebrow]")).toBeNull();
    expect(container.querySelector("[data-page-shell-subtitle]")).toBeNull();
    expect(container.querySelector("[data-page-shell-actions]")).toBeNull();
  });
});

describe("PageShell · 四个标准位", () => {
  it("isLoading 时给 skeleton，不给 children", () => {
    const { queryByText } = render(
      <PageShell title="T" isLoading skeleton={<div>SKELETON</div>}>
        <div>CHILDREN</div>
      </PageShell>
    );
    expect(queryByText("SKELETON")).toBeInTheDocument();
    expect(queryByText("CHILDREN")).not.toBeInTheDocument();
  });

  it("isEmpty 时给 empty，不给 children", () => {
    const { queryByText } = render(
      <PageShell title="T" isEmpty empty={<div>EMPTY</div>}>
        <div>CHILDREN</div>
      </PageShell>
    );
    expect(queryByText("EMPTY")).toBeInTheDocument();
    expect(queryByText("CHILDREN")).not.toBeInTheDocument();
  });

  it("同时 isLoading 与 isEmpty 时给 skeleton —— 还在加载不该先闪一下空态", () => {
    const { queryByText } = render(
      <PageShell
        title="T"
        isLoading
        isEmpty
        skeleton={<div>SKELETON</div>}
        empty={<div>EMPTY</div>}
      >
        <div>CHILDREN</div>
      </PageShell>
    );
    expect(queryByText("SKELETON")).toBeInTheDocument();
    expect(queryByText("EMPTY")).not.toBeInTheDocument();
  });

  it("isEmpty 但没给 empty 时退回 children，不是空白", () => {
    const { queryByText } = render(
      <PageShell title="T" isEmpty>
        <div>CHILDREN</div>
      </PageShell>
    );
    expect(queryByText("CHILDREN")).toBeInTheDocument();
  });
});

describe("PageShell · 分页位", () => {
  it("左计数、右翻页，压在一条 2px 规则线之下", () => {
    const { container } = render(
      <PageShell
        title="T"
        pagination={{ count: <span>共 133 条</span>, controls: <button>下一页</button> }}
      >
        body
      </PageShell>
    );
    const count = container.querySelector<HTMLElement>(
      "[data-page-shell-pagination-count]"
    )!;
    const controls = container.querySelector<HTMLElement>(
      "[data-page-shell-pagination-controls]"
    )!;
    expect(count).toHaveTextContent("共 133 条");
    expect(controls).toHaveTextContent("下一页");
    // 计数在前、翻页在后 —— DOM 顺序即左右，也即读屏顺序。
    expect(count.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    const rule = count.parentElement!;
    expect(rule.className).toMatch(/\bborder-t-2\b/);
    expect(rule.className).toMatch(/\bjustify-between\b/);
  });

  it("空结果时保留占位不塌陷：两半都空也仍有 min-h-14 的分页条", () => {
    const { container } = render(
      <PageShell title="T" isEmpty empty={<div>EMPTY</div>} pagination={{}}>
        body
      </PageShell>
    );
    const pagination = container.querySelector<HTMLElement>(
      "[data-page-shell-pagination]"
    );
    expect(pagination).not.toBeNull();
    expect(pagination!.firstElementChild!.className).toMatch(/\bmin-h-14\b/);
  });

  it("不传 pagination 就没有分页位（不是一条空规则线）", () => {
    const { container } = render(<PageShell title="T">body</PageShell>);
    expect(container.querySelector("[data-page-shell-pagination]")).toBeNull();
    expect(allClasses(container).filter((c) => /\bborder-t-2\b/.test(c))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 源码扫描共用的三件小工具。下面 describe 里三条守卫(density 一致、`<h2>` 两个
// 角色、顶层区块节奏)都读源文件而不是渲染树 —— 它们盯的是**页面怎么写**,而
// 那件事在 jsdom 里看不见:`text-06` 的 600 来自 `--text-06--font-weight`,
// 而 jsdom 不解析自定义属性,于是渲染断言对一个什么都没 emit 的 token 也是绿的。

const FRONTEND = path.join(__dirname, "..", "..");

/** 递归收集 `.tsx`,`accept` 决定收哪些文件名。 */
function collectTsx(dir: string, accept: (_name: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectTsx(full, accept));
    else if (e.name.endsWith(".tsx") && accept(e.name)) out.push(full);
  }
  return out;
}

/**
 * 把注释里的字符换成空格、换行原样保留 —— 于是行号仍然指向源文件,而注释里
 * 写出来的 `<h2>` 不再被当成一个元素。
 *
 * 这不是假想的顾虑:`src/components/ui/PageShell.tsx` 的文件头就用反引号写了
 * 四次 `<h2>` 来记录这条规矩本身,`SettingsDrawer.tsx` 的行注释里也有一处。
 * 不剥注释的话,**这条守卫会去检查描述这条守卫的那段散文**。
 */
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^([ \t]*)\/\/.*$/gm, (_m, indent: string) => indent);
}

/** 字符偏移 → 源文件行号(1 起)。 */
function lineAt(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

/**
 * 两个角色之外的 `<h2>`,连同**不改它**的理由。键是相对 `frontend/` 的路径,
 * 值是当时量到的那段排版。
 *
 * `app/notifications/page.tsx` 的这个 `<h2>` 是通知列表里**每一行**的标题
 * (`notifications.map` 里,一屏几十个),13px、和它下面那条 `<p>` 消息同一档,
 * 靠 `font-medium` 分辨。它既不是区块标签(内容是后端来的通知标题,全大写
 * 加 0.1em 字距对 CJK 是错的),也不是面板标题(22px 铺满一个列表行是另一种错)。
 * 两个角色是 2026-09-07 那次普查得出的,而那次普查**没有看到这一处** —— 所以
 * 这里记的是「规则的依据不覆盖这一例」,不是「这一例可以违规」。
 *
 * 这条豁免会自己失效:下面的守卫要求每个键都真的命中一次。谁改了这一处排版,
 * 或把它从 `<h2>` 换成别的标签,这一条就变成陈旧的,守卫报红要求把它删掉 ——
 * 一份不会陈旧的白名单才是这个仓库真正怕的东西。
 */
const H2_ROLE_EXEMPTIONS = new Map<string, string>([
  ["app/notifications/page.tsx", "text-03 font-medium"],
]);

/**
 * `density` —— 统一是默认,不是唯一。
 *
 * 迁移时 33 条路由都拿到同一套正文节奏 `px-6 py-6`,对一张可排序的表格那是对的:
 * 操作员在扫描,多余的留白就是他一秒钟里少看到的一行。缺陷不是统一,是**没有
 * 出口** —— 真正被读的那几条路由只能从壳内部顶开它。实测 2026-09-02:
 * `app/judgment/[id]` 在四处写 `gap-10 mt-10`,`app/ledger` 写 `space-y-10`。
 *
 * 全仓 935 处纵向节奏里 96% 挤在 ≤24px,≥48px 的只有 6 处(0.6%)。宏观节奏
 * 一直存在,只是没人走得到。
 */
describe("PageShell density", () => {
  it("defaults to table, so the other thirty routes do not move", () => {
    const { container } = render(<PageShell title="T">x</PageShell>);
    const body = container.querySelector("[data-page-shell-body]");
    expect(body).toHaveAttribute("data-density", "table");
    expect(body?.className).toContain("py-6");
    // 断言缺席:默认档不许悄悄带上文档档的节奏。
    expect(body?.className).not.toContain("pt-10");
    expect(body?.className).not.toContain("pb-16");
  });

  it("document actually changes the body rhythm", () => {
    const { container } = render(
      <PageShell title="T" density="document">x</PageShell>
    );
    const body = container.querySelector("[data-page-shell-body]");
    expect(body).toHaveAttribute("data-density", "document");
    expect(body?.className).toContain("pt-10");
    expect(body?.className).toContain("pb-16");
    expect(body?.className).not.toContain("py-6");
  });

  it("changes only the vertical rhythm — column width stays the variant's job", () => {
    const widthOf = (density?: "table" | "document") => {
      const { container } = render(
        <PageShell title="T" variant="prose" density={density}>x</PageShell>
      );
      const cls = container.querySelector("[data-page-shell-body]")?.className ?? "";
      return cls.split(/\s+/).filter((c) => c.startsWith("max-w") || c === "mx-auto").sort();
    };
    expect(widthOf("document")).toEqual(widthOf("table"));
    expect(widthOf("table").length).toBeGreaterThan(0);
  });

  /**
   * 一条路由里的每个 `<PageShell>` 必须同意自己是什么。
   *
   * 这些页面为加载态、错误态和正文各渲染一个壳。只给正文那个加 density,
   * 加载完成的瞬间正文就会跳一次 —— **我第一次改就是这么错的**:
   * 正则只匹配了每个文件的第一个 `<PageShell`,而那恰好是加载态。
   */
  it("keeps every PageShell in one route agreeing on its density", () => {
    const APP = path.join(__dirname, "..", "..", "app");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name === "page.tsx") out.push(full);
      }
      return out;
    };
    const routes = walk(APP);
    expect(routes.length).toBeGreaterThan(20);

    const disagreeing: string[] = [];
    for (const file of routes) {
      const src = readFileSync(file, "utf8");
      const shells = src.match(/<PageShell\b/g)?.length ?? 0;
      if (shells < 2) continue;
      const declared = (src.match(/density="document"/g) ?? []).length;
      if (declared !== 0 && declared !== shells) {
        disagreeing.push(
          `${path.relative(APP, file)}  ${shells} shells, ${declared} declared document`
        );
      }
    }
    if (disagreeing.length > 0) {
      throw new Error(
        `A route renders several PageShells (loading / error / content) and only ` +
          `some of them declare density="document". The body rhythm changes the ` +
          `moment the page finishes loading, which reads as a jump.\n\n` +
          disagreeing.join("\n")
      );
    }
    expect(disagreeing).toEqual([]);
  });

  /**
   * 规则一:`<h2>` 只有两个角色,各钉一个 step。
   *
   *     区块标签 (eyebrow)  text-01 uppercase   卡片/图表/区段上方那行小字
   *     面板标题             text-06            一整块面板/区段的标题
   *
   * 规矩本身写在 `src/components/ui/PageShell.tsx` 的文件头第 4 条 —— 壳拥有
   * `<h1>`(text-07)与 eyebrow(text-01 font-mono uppercase),`<h2>` 归页面,
   * 于是这条规矩**在壳里只是散文**,没有任何东西执行它。这条守卫是执行的那一半。
   *
   * 三种失败各自断言,因为它们看起来一点都不像:
   *   - 用了第三档(text-03/05 一类):同一个语义槽出现第三种字号;
   *   - `text-01` 没有 `uppercase`:11px + 0.1em 字距的正文,读起来是坏掉的标签;
   *   - `text-06` 上再写 `font-semibold`:**逐像素相同**,所以它永远不会被看出来。
   *     `--text-06--font-weight` 已经是 600。留着的坏处不是渲染,是它读起来像
   *     「不写就不粗」—— 上一轮删掉 4 处,第 5 处(actors)是这一轮删的。
   *
   * 扫描面覆盖 `app/` **与 `src/components/`**。2026-09-07 那次普查只扫了 `app/`,
   * 报出 19 个 `<h2>`,实际 32 个 —— 漏掉的 13 个全在 `src/components/`,而
   * 「漏掉」和「没有违例」在报告里长得一模一样。所以下面先断言扫描面本身。
   */
  it("pins every <h2> to one of the two roles the shell declares", () => {
    const files = ["app", path.join("src", "components")].flatMap((root) =>
      collectTsx(path.join(FRONTEND, root), () => true)
    );
    // 扫描面的下限。regex 打错或走错目录时,`offenders` 会是空数组 —— 一条
    // 永远绿的检查比没有检查更坏,所以这里先证明它确实看到了东西。
    expect(files.length).toBeGreaterThan(100);

    const found: { file: string; line: number; tag: string; steps: string[] }[] = [];
    for (const file of files) {
      const src = blankComments(readFileSync(file, "utf8"));
      const re = /<h2\b[\s\S]*?>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        found.push({
          file: path.relative(FRONTEND, file).split(path.sep).join("/"),
          line: lineAt(src, m.index),
          tag: m[0],
          steps: [...new Set(m[0].match(/\btext-0[1-8]\b/g) ?? [])],
        });
      }
    }
    expect(found.length).toBeGreaterThanOrEqual(30);
    // 具体地断言 `src/components/` 那一半在场 —— 它是上一轮整个漏掉的那一半。
    expect(found.filter((h) => h.file.startsWith("src/")).length).toBeGreaterThanOrEqual(10);

    const offenders: string[] = [];
    const exemptionsHit = new Set<string>();
    for (const h of found) {
      const step = h.steps.length === 1 ? h.steps[0] : null;
      let why: string | null = null;
      if (step === null) {
        why =
          `pins ${h.steps.length} type steps (${h.steps.join(", ") || "none"}) — ` +
          `an <h2> declares exactly one`;
      } else if (step === "text-01" && !/\buppercase\b/.test(h.tag)) {
        why = `text-01 without uppercase — the eyebrow role is an uppercase label, not an 11px title`;
      } else if (step === "text-06" && /\bfont-semibold\b/.test(h.tag)) {
        why =
          `font-semibold on text-06 is a no-op — --text-06--font-weight is already 600, ` +
          `so this renders byte-identical and reads as "it would be light without me"`;
      } else if (step !== "text-01" && step !== "text-06") {
        why = `${step} is neither role (eyebrow = text-01 uppercase, panel title = text-06)`;
      }
      if (why === null) continue;

      const exempt = H2_ROLE_EXEMPTIONS.get(h.file);
      if (exempt !== undefined && h.tag.includes(exempt)) {
        exemptionsHit.add(h.file);
        continue;
      }
      offenders.push(`${h.file}:${h.line}  ${why}`);
    }

    const stale = [...H2_ROLE_EXEMPTIONS.keys()].filter((f) => !exemptionsHit.has(f));
    if (stale.length > 0) {
      throw new Error(
        `H2_ROLE_EXEMPTIONS lists a heading that no longer exists in that shape. ` +
          `The entry is now a claim about code that is not there — delete it (and its ` +
          `reason) rather than leaving a white-list nobody re-derives.\n\n` +
          stale.join("\n")
      );
    }
    if (offenders.length > 0) {
      throw new Error(
        `<h2> has exactly two roles and each pins one step: the eyebrow label is ` +
          `"text-01 uppercase", the panel title is "text-06" (its 600 comes from ` +
          `--text-06--font-weight, so font-semibold beside it is a no-op). The rule is ` +
          `written in src/components/ui/PageShell.tsx's file header.\n\n` +
          offenders.join("\n")
      );
    }
    expect(offenders).toEqual([]);
  });

  /**
   * 规则二:正文槽里**顶层区块之间**的节奏,挂在壳的 `density` 上。
   *
   *     density="table"(默认)   space-y-6    24px
   *     density="document"       space-y-10   40px
   *
   * 壳给的是四周内边距,区块之间那一格是页面自己写的 `<div className="space-y-*">`
   * —— 而 2026-09-07 实测它分成两派、同一个槽位。壳不能自己接管它(它看不见
   * children 是什么,DataTable 路由的正文只有一个孩子,而任何有两个以上未包裹
   * 孩子的路由都会被静默重排),所以值由页面写、规矩由这里执行。
   *
   * `loading.tsx` 一并扫,密度取**同目录 `page.tsx`** 的:骨架屏没有壳,两边不
   * 一致正是「加载一结束就跳一格」那条缺陷,而它恰好是 density 这组测试写来防的。
   * 上一轮的普查就漏了 `app/permissions/loading.tsx`。
   *
   * 断言写成「不许出现另一档的值」而不是「必须出现本档的值」:大多数路由一处
   * `space-y-*` 都没有(正文只有一个孩子),要求在场会把它们全判成违规。
   */
  it("keeps the top-level section rhythm on the density the shell declares", () => {
    const APP = path.join(FRONTEND, "app");
    const files = collectTsx(APP, (n) => n === "page.tsx" || n === "loading.tsx");
    expect(files.filter((f) => path.basename(f) === "page.tsx").length).toBeGreaterThan(20);
    expect(files.filter((f) => path.basename(f) === "loading.tsx").length).toBeGreaterThan(10);

    const RHYTHM = { table: "space-y-6", document: "space-y-10" } as const;
    const offenders: string[] = [];
    const observed = { table: 0, document: 0 };

    for (const file of files) {
      const owner =
        path.basename(file) === "loading.tsx"
          ? path.join(path.dirname(file), "page.tsx")
          : file;
      // 少数 loading.tsx 没有同目录的 page.tsx(路由段只做布局)——没有壳可问,
      // 就没有可执行的规矩。
      if (!existsSync(owner)) continue;
      const density = /density="document"/.test(readFileSync(owner, "utf8"))
        ? "document"
        : "table";
      const right = RHYTHM[density];
      const wrong = density === "document" ? RHYTHM.table : RHYTHM.document;

      const src = blankComments(readFileSync(file, "utf8"));
      const wrongRe = new RegExp(`\\b${wrong}\\b`, "g");
      let m: RegExpExecArray | null;
      while ((m = wrongRe.exec(src)) !== null) {
        offenders.push(
          `${path.relative(APP, file).split(path.sep).join("/")}:${lineAt(src, m.index)}  ` +
            `${wrong} under density="${density}" — that density's rhythm is ${right}`
        );
      }
      if (new RegExp(`\\b${right}\\b`).test(src)) observed[density] += 1;
    }

    // 两档都要真的在树上被看到。只观察到一档时,这条守卫对另一档是**从未运行过**
    // 的,而它照样是绿的 —— 那正是这个仓库反复踩到的失败形状。
    expect(observed.table).toBeGreaterThan(0);
    expect(observed.document).toBeGreaterThan(0);

    if (offenders.length > 0) {
      throw new Error(
        `A route's top-level section rhythm disagrees with the density its PageShell ` +
          `declares. density="table" (the default) is space-y-6; density="document" is ` +
          `space-y-10. Either the shell is the wrong density for this route, or the ` +
          `spacing was picked by eye. The rule is written in ` +
          `src/components/ui/PageShell.tsx on the density prop.\n\n` +
          offenders.join("\n")
      );
    }
    expect(offenders).toEqual([]);
  });
});
