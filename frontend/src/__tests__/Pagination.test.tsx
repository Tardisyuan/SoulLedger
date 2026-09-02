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

/**
 * First / last / jump — the part that changes the shape of the task.
 *
 * The control was prev/next only. At the app's 20 rows a page
 * (`lib/api/client.ts:28`), a tenant with a few thousand souls needed 150+
 * clicks to reach the tail, one page at a time, with no way to say where it
 * wanted to be.
 */
describe("reaching a page that is not adjacent", () => {
  const setup = (page: number, totalPages = 7) => {
    const onPageChange = jest.fn();
    render(
      <Pagination page={page} totalPages={totalPages} count={137} onPageChange={onPageChange} />
    );
    return { onPageChange };
  };

  it("jumps to the first and last page", () => {
    const { onPageChange } = setup(4);

    fireEvent.click(screen.getByLabelText("pagination.first"));
    expect(onPageChange).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByLabelText("pagination.last"));
    expect(onPageChange).toHaveBeenLastCalledWith(7);
  });

  it("commits a typed page on Enter", () => {
    const { onPageChange } = setup(1);

    const box = screen.getByLabelText("pagination.jump");
    fireEvent.change(box, { target: { value: "5" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("clamps rather than rejecting an out-of-range page", () => {
    const { onPageChange } = setup(1);

    const box = screen.getByLabelText("pagination.jump");
    fireEvent.change(box, { target: { value: "999" } });
    fireEvent.blur(box);

    // "999" on a 7-page list means "the end". Bouncing it back with an error
    // would be pedantry about a number the operator did not have to know.
    expect(onPageChange).toHaveBeenCalledWith(7);
  });

  it("restores the current page when the box is left unreadable", () => {
    const { onPageChange } = setup(3);

    const box = screen.getByLabelText("pagination.jump");
    fireEvent.change(box, { target: { value: "abc" } });
    fireEvent.blur(box);

    expect(onPageChange).not.toHaveBeenCalled();
    expect(box).toHaveValue("3");
  });

  it("does not fire for the page it is already on", () => {
    const { onPageChange } = setup(3);

    const box = screen.getByLabelText("pagination.jump");
    fireEvent.change(box, { target: { value: "3" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("keeps every control out of an enclosing form's submit path", () => {
    // This component renders inside page bodies that contain forms. A bare
    // <button> defaults to type=submit, and Enter in a bare input submits too
    // — a page turn would submit whatever form enclosed it.
    setup(4);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("type", "button");
    }
  });
});
