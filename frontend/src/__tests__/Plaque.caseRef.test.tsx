/**
 * 页面经 `usePlaque` 报给页头的 `caseRef`(灵魂详情的「案号 · 未结 / 已结」)与 `caseNumber`(审判台)。
 *
 * 第三十批「卷宗」起身份带撤掉了,这几样写在 PageShell 页头标题上方那一行等宽小字里(殿名在前)。
 * 有案号:指向审判详情的链接(不是复制按钮)+ 状态字;没有:写「案号 —」(`MissingValue`),没有链接。
 * 不给 caseRef 时没有这一格;页面报的 `meta` 写在标题下面那一行。
 * 真 I18nProvider(默认 zh-Hans)—— 断言的是读者看到的字。
 */
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/src/contexts/I18nContext";
import type { PlaqueText } from "@/src/components/plaque/Plaque";
import { PlaqueValueProvider } from "@/src/components/plaque/pageHeadContext";
import { PageShell } from "@/src/components/ui/PageShell";

jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { tenant: { code: "CN_DIYU", display_name: "地府" } } }),
}));

const head = (plaque: PlaqueText) =>
  render(
    <I18nProvider>
      <PlaqueValueProvider value={plaque}>
        <PageShell title="灵魂详情">body</PageShell>
      </PlaqueValueProvider>
    </I18nProvider>,
  );
const metaLine = () => document.querySelector("[data-page-shell-eyebrow]") as HTMLElement | null;

describe("页头的案号格(caseRef / caseNumber)", () => {
  it("number: a link to the judgment, and the state after a middle dot, after the hall", () => {
    head({ hall: "酆都 · 第一殿", caseRef: { number: "CN-2026-0007", href: "/judgment/j1", label: "未结" } });
    const cell = document.querySelector("[data-case-ref]") as HTMLElement;
    const link = screen.getByRole("link", { name: "CN-2026-0007" });
    expect(link).toHaveAttribute("href", "/judgment/j1");
    expect(link).toHaveAttribute("data-case-number", "CN-2026-0007");
    expect(cell.textContent).toBe("CN-2026-0007 · 未结");
    expect(metaLine()!.textContent).toBe("酆都 · 第一殿 · CN-2026-0007 · 未结");
    // The number is a link here, not the copy button.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("allHref + allCount: '全部 N 场 ›' linking to the soul's judgment list", () => {
    head({ caseRef: { number: "CN-2026-0007", href: "/judgment/j1", label: "已结", allHref: "/judgment?soul=s1", allCount: 3 } });
    const all = screen.getByRole("link", { name: "全部 3 场 ›" });
    expect(all).toHaveAttribute("href", "/judgment?soul=s1");
  });

  it("without allCount (one judgment) there is no 'all' link", () => {
    head({ caseRef: { number: "CN-2026-0007", href: "/judgment/j1", label: "已结" } });
    expect(screen.queryByText(/全部/)).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("empty: the label stays, the value is a missing-value dash, nothing is clickable", () => {
    head({ caseRef: {} });
    expect(metaLine()).toHaveTextContent("案号");
    const missing = document.querySelector("[data-case-ref] [data-missing]");
    expect(missing).not.toBeNull();
    expect(missing?.textContent).toBe("—");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("without caseRef there is no case cell; the page's meta is the line under the title", () => {
    head({ meta: "2026-10-10" });
    expect(document.querySelector("[data-page-shell-subtitle]")).toHaveTextContent("2026-10-10");
    expect(document.querySelector("[data-case-ref]")).toBeNull();
    expect(metaLine()).toBeNull();
  });

  it("the judgment desk's own copyable caseNumber still wins over caseRef", () => {
    head({ caseNumber: "CN-2026-0001", caseRef: { number: "CN-other", href: "/x" } });
    expect(screen.getByRole("button")).toHaveTextContent("CN-2026-0001");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("the band's second title is not drawn: the page head has one title, the page's <h1>", () => {
    head({ title: "灵魂详情 · 第二个标题", hall: "酆都 · 第一殿" });
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")).toHaveTextContent("灵魂详情");
    expect(screen.queryByText(/第二个标题/)).toBeNull();
  });
});
