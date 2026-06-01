/**
 * Tests for Pagination component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { Pagination } from "@/src/components/ui/Pagination";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "pagination.info") return `Page ${params?.page} of ${params?.total} (${params?.count} items)`;
      if (key === "common.prev") return "← Previous";
      if (key === "common.next") return "Next →";
      return key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

describe("Pagination", () => {
  it("renders page info and navigation buttons", () => {
    render(<Pagination page={1} totalPages={5} count={50} onPageChange={() => {}} />);
    expect(screen.getByText(/Page 1 of 5/)).toBeInTheDocument();
    expect(screen.getByText(/Previous/)).toBeInTheDocument();
    expect(screen.getByText(/Next/)).toBeInTheDocument();
  });

  it("disables previous button on first page", () => {
    render(<Pagination page={1} totalPages={5} count={50} onPageChange={() => {}} />);
    const prevBtn = screen.getByText(/Previous/).closest("button");
    expect(prevBtn).toBeDisabled();
  });

  it("disables next button on last page", () => {
    render(<Pagination page={5} totalPages={5} count={50} onPageChange={() => {}} />);
    const nextBtn = screen.getByText(/Next/).closest("button");
    expect(nextBtn).toBeDisabled();
  });

  it("calls onPageChange when next is clicked", () => {
    const onPageChange = jest.fn();
    render(<Pagination page={2} totalPages={5} count={50} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByText(/Next/));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("calls onPageChange when previous is clicked", () => {
    const onPageChange = jest.fn();
    render(<Pagination page={3} totalPages={5} count={50} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByText(/Previous/));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("hides when totalPages is 1 and showInfo is false", () => {
    const { container } = render(<Pagination page={1} totalPages={1} count={5} onPageChange={() => {}} showInfo={false} />);
    expect(container.firstChild).toBeNull();
  });
});
