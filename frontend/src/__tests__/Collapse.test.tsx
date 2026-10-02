/**
 * Collapse —— 行展开与整节折叠的收起契约(Design 第三批回复,2026-10-03):
 * 点下去 aria-expanded=false;内容立刻 inert;动画结束再 hidden;焦点在内容里就先还给触发按钮。
 * jsdom 不跑 CSS 动画,所以 animationend 由测试手动派发。
 */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { Collapse } from "@/src/components/ui/Collapse";

function Harness({ initial = false, rows }: { initial?: boolean; rows?: number }) {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls="body" onClick={() => setOpen((o) => !o)}>
        toggle
      </button>
      <Collapse open={open} id="body" rows={rows}>
        <button type="button" onClick={() => setOpen(false)}>
          inner
        </button>
      </Collapse>
    </>
  );
}

const toggle = () => screen.getByRole("button", { name: "toggle" });
const body = () => document.getElementById("body")!;

it("starts closed with nothing rendered, and expands with row-expand", () => {
  render(<Harness />);
  expect(document.getElementById("body")).toBeNull();
  fireEvent.click(toggle());
  expect(body()).toHaveClass("row-expand");
  expect(body()).not.toHaveAttribute("inert");
  expect(body()).not.toHaveAttribute("hidden");
});

it("collapse: aria-expanded false and inert at once, hidden only after the animation", () => {
  render(<Harness />);
  fireEvent.click(toggle());
  fireEvent.click(toggle());
  expect(toggle()).toHaveAttribute("aria-expanded", "false");
  expect(body()).toHaveAttribute("inert");
  expect(body()).toHaveClass("row-collapse");
  expect(body()).not.toHaveAttribute("hidden");
  // A bubbling animationend from the content's own fade is not the end of the collapse.
  fireEvent.animationEnd(screen.getByRole("button", { name: "inner", hidden: true }));
  expect(body()).not.toHaveAttribute("hidden");
  fireEvent.animationEnd(body());
  expect(body()).toHaveAttribute("hidden");
});

it("moves focus back to the trigger when it was inside the content", () => {
  render(<Harness />);
  fireEvent.click(toggle());
  const inner = screen.getByRole("button", { name: "inner" });
  inner.focus();
  fireEvent.click(inner);
  expect(toggle()).toHaveFocus();
  expect(body()).toHaveAttribute("inert");
});

it("reopening clears inert and hidden and plays the expand again", () => {
  render(<Harness />);
  fireEvent.click(toggle());
  fireEvent.click(toggle());
  fireEvent.animationEnd(body());
  fireEvent.click(toggle());
  expect(body()).not.toHaveAttribute("hidden");
  expect(body()).not.toHaveAttribute("inert");
  expect(body()).toHaveClass("row-expand");
});

it("content open from the start does not animate in", () => {
  render(<Harness initial />);
  expect(body()).not.toHaveClass("row-expand");
  fireEvent.click(toggle());
  expect(body()).toHaveClass("row-collapse");
});

it("more than 40 rows: opacity only, no height animation", () => {
  render(<Harness rows={41} />);
  fireEvent.click(toggle());
  expect(body()).toHaveClass("collapse-fade-in");
  expect(body()).not.toHaveClass("row-expand");
  fireEvent.click(toggle());
  expect(body()).toHaveClass("collapse-fade-out");
  expect(body()).not.toHaveClass("row-collapse");
  fireEvent.animationEnd(body());
  expect(body()).toHaveAttribute("hidden");
});

it("40 rows still animates the height", () => {
  render(<Harness rows={40} />);
  fireEvent.click(toggle());
  expect(body()).toHaveClass("row-expand");
});
