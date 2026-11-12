/**
 * 筛选签(规范 v1 §2). "In effect" must be more than a colour: the × and the
 * accent underline appear together, and only when the filter is on.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FilterBar, FilterChipSelect, FilterChipToggle } from "@/src/components/ui/FilterChip";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { tZh } from "./support/zhBundle";

const options = [
  { value: "", label: "全部" },
  { value: "JUDGING", label: "审判中" },
];

describe("FilterChipSelect", () => {
  it("at rest: no ×, no underline, a ▾", () => {
    const { container } = render(
      <FilterChipSelect label="状态" value="" options={options} onChange={jest.fn()} clearLabel="清除状态" />
    );
    const chip = container.firstChild as HTMLElement;
    expect(screen.queryByRole("button", { name: "清除状态" })).not.toBeInTheDocument();
    expect(chip.className).not.toContain("shadow-[inset_0_-2px_0_oklch(var(--color-accent))]");
    expect(chip).not.toHaveAttribute("data-active");
    expect(chip).toHaveTextContent("▾");
  });

  it("in effect: ink fill + ✓ + × together (规范 v2 A1), and × clears to the empty option", () => {
    const onChange = jest.fn();
    const { container } = render(
      <FilterChipSelect label="状态" value="JUDGING" options={options} onChange={onChange} clearLabel="清除状态" />
    );
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).toContain("bg-[oklch(var(--color-ink))]");
    expect(chip.className).not.toContain("--color-accent");
    expect(chip).toHaveTextContent("✓");
    expect(chip).toHaveAttribute("data-active", "true");
    expect(chip).not.toHaveTextContent("▾");
    fireEvent.click(screen.getByRole("button", { name: "清除状态" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("the select carries the dimension as its accessible name and reports picks", () => {
    const onChange = jest.fn();
    render(<FilterChipSelect label="状态" value="" options={options} onChange={onChange} clearLabel="清除状态" />);
    fireEvent.change(screen.getByRole("combobox", { name: "状态" }), { target: { value: "JUDGING" } });
    expect(onChange).toHaveBeenCalledWith("JUDGING");
  });
});

describe("FilterChipToggle", () => {
  it("reports its state with aria-pressed and flips on click", () => {
    const onPressedChange = jest.fn();
    const { rerender } = render(
      <FilterChipToggle pressed={false} onPressedChange={onPressedChange}>仅看有问题的</FilterChipToggle>
    );
    const btn = screen.getByRole("button", { name: "仅看有问题的" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).not.toHaveAttribute("data-active");
    expect(btn).not.toHaveTextContent("✓");
    fireEvent.click(btn);
    expect(onPressedChange).toHaveBeenCalledWith(true);

    rerender(<FilterChipToggle pressed onPressedChange={onPressedChange}>仅看有问题的</FilterChipToggle>);
    const on = screen.getByRole("button", { pressed: true });
    expect(on).toHaveAttribute("data-active", "true");
    expect(on).toHaveTextContent("✓");
  });
});

/**
 * 第三十批「卷宗」第 1 步第 4 条:列表的筛选条。桌面一行;393 是 搜索 +「筛选 · N」、快捷 chip 横滑、其余进底部抽屉。
 * jsdom 不跑媒体查询,两种画法都在 DOM 里 —— 这里各自按它的容器查。
 */
describe("FilterBar", () => {
  function Bar({ value = "", onChange = jest.fn(), onToggle = jest.fn() }: { value?: string; onChange?: jest.Mock; onToggle?: jest.Mock }) {
    return (
      <I18nProvider>
        <FilterBar
          selects={[{ label: "状态", value, options, onChange, clearLabel: "清除状态" }]}
          quick={[{ label: "审判中", active: value === "JUDGING", onToggle }]}
          search={(where) => <input aria-label={`搜索-${where}`} />}
        />
      </I18nProvider>
    );
  }
  const narrow = () => document.querySelector("[data-filter-bar-narrow]") as HTMLElement;
  const wide = () => document.querySelector("[data-filter-bar-wide]") as HTMLElement;

  it("两种画法各自藏在对方的宽度里:桌面 ≥ 769 才显示,窄屏 ≤ 768 才显示", () => {
    render(<Bar />);
    expect(wide().className).toMatch(/max-\[768px\]:hidden/);
    expect(narrow().className).toMatch(/min-\[769px\]:hidden/);
    expect(within(wide()).getByRole("combobox", { name: "状态" })).toBeInTheDocument();
    // 窄屏的第一行没有维度下拉,只有搜索与「筛选」;下拉在抽屉里。
    expect(within(narrow()).queryByRole("combobox")).toBeNull();
    expect(within(narrow()).getByLabelText("搜索-narrow")).toBeInTheDocument();
  });

  it("「筛选 · N」数的是已生效的条件;没有生效的就只写「筛选」", () => {
    const { unmount } = render(<Bar />);
    expect(within(narrow()).getByRole("button", { name: tZh("filter.bar.open") })).toBeInTheDocument();
    unmount();
    render(<Bar value="JUDGING" />);
    expect(within(narrow()).getByRole("button", { name: tZh("filter.bar.open_n", { n: "1" }) })).toBeInTheDocument();
  });

  it("快捷 chip:44 高的胶囊,不压缩不截字,aria-pressed 说状态,点一下交给调用方", () => {
    const onToggle = jest.fn();
    render(<Bar value="JUDGING" onToggle={onToggle} />);
    const chip = within(narrow()).getByRole("button", { name: "审判中", pressed: true });
    expect(chip.className).toMatch(/\bh-\(--control-h-sm\)/);
    expect(chip.className).toMatch(/\brounded-full\b/);
    expect(chip.className).toMatch(/\bshrink-0\b/);
    expect(chip.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(chip.className).not.toMatch(/\btruncate\b/);
    expect(chip.parentElement!.className).toMatch(/\bchip-scroll\b/);
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalled();
  });

  it("「筛选」打开底部抽屉:每个维度一行下拉,改了即生效;主按钮是墨色实底、56 那一档,点了收起", async () => {
    const onChange = jest.fn();
    render(<Bar onChange={onChange} />);
    fireEvent.click(within(narrow()).getByRole("button", { name: tZh("filter.bar.open") }));
    const sheet = await screen.findByRole("dialog");
    const select = within(sheet).getByRole("combobox", { name: "状态" });
    fireEvent.change(select, { target: { value: "JUDGING" } });
    expect(onChange).toHaveBeenCalledWith("JUDGING");
    const done = within(sheet).getByRole("button", { name: tZh("filter.bar.done") });
    expect(done.className).toContain("bg-(--main-fill)");
    expect(done.className).toMatch(/\bh-\(--control-h-lg\)/);
  });
});
