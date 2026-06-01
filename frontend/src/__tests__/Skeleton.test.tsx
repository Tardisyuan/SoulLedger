/**
 * Tests for Skeleton components
 */
import { render } from "@testing-library/react";
import { Skeleton, TableSkeleton, CardSkeleton, ListSkeleton } from "@/components/ui/skeleton";

describe("Skeleton components", () => {
  it("renders Skeleton with default className", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders Skeleton with custom className", () => {
    const { container } = render(<Skeleton className="w-10 h-10" />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders TableSkeleton with default rows", () => {
    const { container } = render(<TableSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders TableSkeleton with custom rows and cols", () => {
    const { container } = render(<TableSkeleton rows={3} cols={5} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders CardSkeleton", () => {
    const { container } = render(<CardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders ListSkeleton with default count", () => {
    const { container } = render(<ListSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders ListSkeleton with custom count", () => {
    const { container } = render(<ListSkeleton count={5} />);
    expect(container.firstChild).toBeTruthy();
  });
});
