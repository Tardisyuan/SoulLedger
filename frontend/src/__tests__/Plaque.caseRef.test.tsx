/**
 * 身份带右栏的 `caseRef`(灵魂详情的「案号 · 未结 / 已结」)。
 *
 * 有案号:标签「案号」+ 指向审判详情的链接(不是复制按钮)+ 状态字;没有:标签保留,值是
 * `MissingValue`(「—」),没有链接。不给 caseRef 时右栏照旧(meta)。
 * 真 I18nProvider(默认 zh-Hans)—— 断言的是读者看到的字。
 */
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { Plaque } from "@/src/components/plaque/Plaque";

jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { tenant: { code: "CN_DIYU", display_name: "地府" } } }),
}));

const band = (props: Partial<React.ComponentProps<typeof Plaque>>) =>
  render(
    <I18nProvider>
      <Plaque title="灵魂详情" {...props} />
    </I18nProvider>,
  );

describe("Plaque caseRef", () => {
  it("number: the label, a link to the judgment, and the state after a middle dot", () => {
    band({ caseRef: { number: "CN-2026-0007", href: "/judgment/j1", label: "未结" } });
    const cell = document.querySelector("[data-case-ref]") as HTMLElement;
    expect(screen.getByText("案号")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "CN-2026-0007" });
    expect(link).toHaveAttribute("href", "/judgment/j1");
    expect(link).toHaveAttribute("data-case-number", "CN-2026-0007");
    expect(cell.textContent).toBe("CN-2026-0007 · 未结");
    // The number is a link here, not the copy button.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("empty: the label stays, the value is a missing-value dash, nothing is clickable", () => {
    band({ caseRef: {} });
    expect(screen.getByText("案号")).toBeInTheDocument();
    const missing = document.querySelector("[data-case-ref] [data-missing]");
    expect(missing).not.toBeNull();
    expect(missing?.textContent).toBe("—");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("without caseRef the right column is the page's meta, and there is no case cell", () => {
    band({ meta: "2026-10-10" });
    expect(screen.getByText("2026-10-10")).toBeInTheDocument();
    expect(document.querySelector("[data-case-ref]")).toBeNull();
    expect(screen.queryByText("案号")).toBeNull();
  });

  it("the judgment desk's own copyable caseNumber still wins over caseRef", () => {
    band({ caseNumber: "CN-2026-0001", caseRef: { number: "CN-other", href: "/x" } });
    expect(screen.getByRole("button")).toHaveTextContent("CN-2026-0001");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
