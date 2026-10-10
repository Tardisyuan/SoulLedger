/**
 * 打印(第十五批 C1)。jsdom 不排版也不分页,所以这里只测可测的:
 *   · PrintFrame 带出殿名、24px 殿印、案号 / 编号,并在挂载期间把页码前后的字写进根元素;
 *   · 打印时 Collapse 渲染收着的内容(`beforeprint`),打印完回到收着;
 *   · `app/print.css` 里「打印时隐藏」的元素清单、黑白(不写色值)、页码边距盒仍在。
 * 真正的版面(页眉页脚每页重复、第 N 页 / 共 M 页)要在浏览器的打印预览里看。
 */
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrintFrame } from "@/src/components/print/PrintFrame";
import { Collapse } from "@/src/components/ui/Collapse";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (k: string) => ({ "print.page_pre": "第 ", "print.page_mid": " 页 / 共 ", "print.page_post": " 页" })[k] ?? k,
  }),
}));

const root = () => document.documentElement.style;

describe("PrintFrame", () => {
  it("carries hall, a 24px mark and the reference; the page-number words live on the root only while mounted", () => {
    const { container, unmount } = render(
      <PrintFrame hall="酆都 · 第十殿" reference="CN-2026-0007" referenceLabel="案号">
        <p>body</p>
      </PrintFrame>
    );
    const doc = container.querySelector("[data-print-doc]")!;
    expect(doc.querySelector("[data-print-hall]")).toHaveTextContent("酆都 · 第十殿");
    expect(doc.querySelector("[data-print-reference]")).toHaveTextContent("案号 CN-2026-0007");
    expect(doc.querySelector("[data-print-head] svg[data-brand-mark]")).toHaveAttribute("width", "24");
    expect(doc.querySelector("[data-print-body]")).toHaveTextContent("body");
    expect(root().getPropertyValue("--print-page-pre")).toBe('"第 "');
    expect(root().getPropertyValue("--print-page-mid")).toBe('" 页 / 共 "');
    expect(root().getPropertyValue("--print-page-post")).toBe('" 页"');
    unmount();
    expect(root().getPropertyValue("--print-page-pre")).toBe("");
  });

  it("prints no reference cell text while there is no reference yet", () => {
    const { container } = render(
      <PrintFrame referenceLabel="案号" reference={null}>
        <p>body</p>
      </PrintFrame>
    );
    expect(container.querySelector("[data-print-reference]")).toBeEmptyDOMElement();
  });
});

describe("Collapse while printing", () => {
  it("renders a closed section for the printer and puts it away afterwards", () => {
    render(
      <Collapse open={false} id="c1">
        <p>folded content</p>
      </Collapse>
    );
    expect(screen.queryByText("folded content")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(screen.getByText("folded content")).toBeInTheDocument();
    expect(document.getElementById("c1")).not.toHaveAttribute("hidden");
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    // Put away again: no longer open (the leave phase marks it).
    expect(document.getElementById("c1")?.getAttribute("data-collapse")).toBe("leave");
  });
});

describe("app/print.css", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/print.css"), "utf8");
  const printBlock = css.slice(css.indexOf("@media print"));

  it("hides the interactive elements, and nothing else interactive is left to print", () => {
    const hidden = printBlock.slice(printBlock.indexOf("/* 交互件不印"), printBlock.indexOf("/* 折叠区"));
    for (const sel of ["button", "input", "select", "textarea", '[role="tablist"]', "[data-print-hide]"]) {
      expect(hidden).toContain(`[data-print-doc] ${sel}`);
    }
    expect(hidden).toContain("display: none !important");
  });

  it("is black and white by system colour: no hex, rgb, hsl, oklch or named colour values", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|oklch|lab|lch)\(/);
    expect(css).not.toMatch(/:\s*(black|white|gray|grey)\b/);
    expect(printBlock).toContain("CanvasText");
  });

  it("repeats header and footer as table groups and keeps the page-number margin box", () => {
    expect(printBlock).toMatch(/\[data-print-head\]\s*\{\s*display: table-header-group/);
    expect(printBlock).toMatch(/\[data-print-foot\]\s*\{\s*display: table-footer-group/);
    expect(css).toContain("@bottom-right");
    expect(css).toContain("counter(page)");
    expect(css).toContain("counter(pages)");
  });

  it("only touches pages that mounted a print document", () => {
    const rules = [...printBlock.matchAll(/^\s{2}([^\s@/*][^{]*)\{/gm)].map((m) => m[1].trim()).filter((s) => !/^(html|body)/.test(s));
    expect(rules.length).toBeGreaterThan(5);
    for (const sel of rules) expect(sel).toMatch(/data-print-|print-doc/);
  });
});
