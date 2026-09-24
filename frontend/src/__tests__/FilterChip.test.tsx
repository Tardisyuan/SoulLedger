/**
 * 筛选签(规范 v1 §2). "In effect" must be more than a colour: the × and the
 * accent underline appear together, and only when the filter is on.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { FilterChipSelect, FilterChipToggle } from "@/src/components/ui/FilterChip";

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

  it("in effect: underline + × together, and × clears to the empty option", () => {
    const onChange = jest.fn();
    const { container } = render(
      <FilterChipSelect label="状态" value="JUDGING" options={options} onChange={onChange} clearLabel="清除状态" />
    );
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).toContain("shadow-[inset_0_-2px_0_oklch(var(--color-accent))]");
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
    expect(btn.className).not.toContain("--color-accent");
    fireEvent.click(btn);
    expect(onPressedChange).toHaveBeenCalledWith(true);

    rerender(<FilterChipToggle pressed onPressedChange={onPressedChange}>仅看有问题的</FilterChipToggle>);
    expect(screen.getByRole("button", { pressed: true })).toHaveClass("shadow-[inset_0_-2px_0_oklch(var(--color-accent))]");
  });
});
