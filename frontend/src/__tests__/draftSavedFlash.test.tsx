/**
 * 规范 v3「草稿保存」:「已保存」opacity 0→1→0,160 + 160ms(进场 / 出场);减少动态效果下静态显示
 * 1.5s 后移除。只在一次保存成功(`saves` 加一)时闪,不在挂载时闪。
 */
import { readFileSync } from "node:fs";
import { act, render, screen } from "@testing-library/react";

import { DraftStatusLine, type DraftStatus } from "@/src/components/judgment/JudgmentDraftAutosave";
import { GLOBALS_CSS } from "./support/globalsCssTokens";

let reduced = false;
beforeEach(() => {
  jest.useFakeTimers();
  reduced = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: reduced && q.includes("reduce"), media: q }),
  });
});
afterEach(() => jest.useRealTimers());
afterAll(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function saveOnce() {
  const view = render(<DraftStatusLine status={"idle" as DraftStatus} saves={3} />);
  expect(screen.queryByTestId("draft-saved-flash")).toBeNull();
  view.rerender(<DraftStatusLine status="idle" saves={4} />);
  return view;
}

it("flashes 「已保存」 for 320ms on the saved-flash animation after a save", () => {
  saveOnce();
  const flash = screen.getByTestId("draft-saved-flash");
  expect(flash).toHaveClass("animate-saved-flash");
  act(() => jest.advanceTimersByTime(319));
  expect(screen.getByTestId("draft-saved-flash")).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId("draft-saved-flash")).toBeNull();
});

it("reduced motion: static, no animation class, removed after 1.5s", () => {
  reduced = true;
  saveOnce();
  expect(screen.getByTestId("draft-saved-flash")).not.toHaveClass("animate-saved-flash");
  act(() => jest.advanceTimersByTime(1499));
  expect(screen.getByTestId("draft-saved-flash")).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId("draft-saved-flash")).toBeNull();
});

it("a failed save does not flash", () => {
  const view = render(<DraftStatusLine status="saving" saves={1} />);
  view.rerender(<DraftStatusLine status="failed" saves={1} />);
  expect(screen.queryByTestId("draft-saved-flash")).toBeNull();
});

it("the animation is 0→1 over 160 on the enter curve, then 1→0 over 160 on the exit curve, back to back", () => {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  expect(css).toMatch(
    /--animate-saved-flash: content-in var\(--transition-duration-fast\) var\(--ease-enter\) both, row-exit var\(--transition-duration-fast\) var\(--ease-exit\) var\(--transition-duration-fast\) forwards;/
  );
  expect(css).toMatch(/--transition-duration-fast: 160ms;/);
});
