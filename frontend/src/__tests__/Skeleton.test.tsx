/**
 * Tests for Skeleton components
 */
import { act, render } from "@testing-library/react";
import { Skeleton, TableSkeleton, CardSkeleton, ListSkeleton, SKELETON_DELAY_MS } from "@/components/ui/skeleton";

describe("Skeleton 400 ms delay (规范 v1 §1.7:骨架屏不闪烁)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("is laid out but invisible until 400 ms, then appears", () => {
    const { container } = render(<Skeleton className="h-4" />);
    const el = container.firstChild as HTMLElement;
    // Present from the first frame: the space is reserved, nothing jumps.
    expect(el.getAttribute("data-slot")).toBe("skeleton");
    expect(el.className).toContain("invisible");

    act(() => { jest.advanceTimersByTime(399); });
    expect(el.className).toContain("invisible");

    act(() => { jest.advanceTimersByTime(1); });
    expect(el.className).not.toContain("invisible");
    expect(el.className).toContain("animate-pulse");
  });

  it("exports the spec's number", () => {
    expect(SKELETON_DELAY_MS).toBe(400);
  });

  it("a load that finishes before 400 ms never shows the skeleton", () => {
    const { container, unmount } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    act(() => { jest.advanceTimersByTime(200); });
    expect(el.className).toContain("invisible");
    unmount();
    // The pending timer is cleared: advancing past 400 ms must not warn about
    // a state update on an unmounted component.
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    act(() => { jest.advanceTimersByTime(1000); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("Skeleton components", () => {
  // FT-12 (2026-09-13): all seven cases here used to be `container.firstChild
  // .toBeTruthy()` — true for literally any non-empty render, so a component
  // that ignored its `rows`/`cols`/`count` prop entirely, or dropped the
  // caller's `className`, passed just as well as a correct one. Each case now
  // asserts the one thing its prop is supposed to control.

  it("renders Skeleton with the default pulse class and no extra class", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("animate-pulse");
  });

  it("renders Skeleton with the caller's className appended, not replacing the default", () => {
    const { container } = render(<Skeleton className="w-10 h-10" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("w-10");
    expect(el.className).toContain("h-10");
  });

  it("renders TableSkeleton with a header row plus the default 5 body rows of 4 cells", () => {
    const { container } = render(
      <table>
        <tbody>
          <TableSkeleton />
        </tbody>
      </table>
    );
    const rows = container.querySelectorAll("tr");
    expect(rows).toHaveLength(1 + 5);
    for (const row of rows) {
      expect(row.querySelectorAll("td")).toHaveLength(4);
    }
  });

  it("renders TableSkeleton with custom rows and cols, not the defaults", () => {
    const { container } = render(
      <table>
        <tbody>
          <TableSkeleton rows={3} cols={5} />
        </tbody>
      </table>
    );
    const rows = container.querySelectorAll("tr");
    expect(rows).toHaveLength(1 + 3);
    for (const row of rows) {
      expect(row.querySelectorAll("td")).toHaveLength(5);
    }
  });

  it("renders CardSkeleton with its three placeholder bars", () => {
    const { container } = render(<CardSkeleton />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("renders ListSkeleton with the default 3 cards (9 bars: 3 per card)", () => {
    const { container } = render(<ListSkeleton />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3 * 3);
  });

  it("renders ListSkeleton with a custom count, not the default", () => {
    const { container } = render(<ListSkeleton count={5} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(5 * 3);
  });
});
