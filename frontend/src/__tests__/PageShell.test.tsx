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
 */
import { readFileSync, readdirSync } from "node:fs";
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

  it("副标题是 text-04 + text-[hsl(var(--color-ink-subtle))]", () => {
    const { container } = render(<PageShell title="T" subtitle="一句副标题">body</PageShell>);
    const sub = container.querySelector<HTMLElement>("[data-page-shell-subtitle]")!;
    expect(sub.className).toMatch(/\btext-04\b/);
    expect(sub.className).toContain("text-[hsl(var(--color-ink-subtle))]");
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
});
