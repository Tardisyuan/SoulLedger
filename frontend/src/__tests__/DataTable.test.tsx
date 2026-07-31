/**
 * Tests for DataTable component
 */
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "pagination.info") return `Page ${params?.page} of ${params?.total} (${params?.count} items)`;
      if (key === "common.prev") return "Previous";
      if (key === "common.next") return "Next";
      if (key === "common.error") return "Something went wrong";
      if (key === "common.retry") return "Retry";
      if (key === "filter.clear_all") return "Clear all";
      if (key === "table.empty") return "No data yet";
      if (key === "table.no_results") return "No matches";
      return key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "1", name: "Alpha" },
  { id: "2", name: "Beta" },
];

const columns: DataTableColumn[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "actions", header: "Actions", srOnlyHeader: true, align: "right" },
];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable<Row>
      caption="Souls table"
      columns={columns}
      data={rows}
      keyExtractor={(item) => item.id}
      renderRow={(item) => (
        <>
          <td>{item.name}</td>
          <td>view</td>
        </>
      )}
      {...props}
    />
  );
}

describe("DataTable", () => {
  it("renders a caption, column headers and one row per item", () => {
    renderTable();
    expect(screen.getByText("Souls table")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("marks header cells as column scope", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(2);
    headers.forEach((th) => expect(th).toHaveAttribute("scope", "col"));
  });

  it("cycles sort none -> asc -> desc -> none on header click", () => {
    const onSortChange = jest.fn();
    const { rerender } = renderTable({ sort: null, onSortChange });

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", direction: "asc" });

    rerender(
      <DataTable<Row>
        caption="Souls table"
        columns={columns}
        data={rows}
        keyExtractor={(item) => item.id}
        renderRow={(item) => <td>{item.name}</td>}
        sort={{ key: "name", direction: "asc" }}
        onSortChange={onSortChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", direction: "desc" });

    rerender(
      <DataTable<Row>
        caption="Souls table"
        columns={columns}
        data={rows}
        keyExtractor={(item) => item.id}
        renderRow={(item) => <td>{item.name}</td>}
        sort={{ key: "name", direction: "desc" }}
        onSortChange={onSortChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith(null);
  });

  it("exposes aria-sort on the sorted column only", () => {
    renderTable({ sort: { key: "name", direction: "asc" }, onSortChange: jest.fn() });
    const [nameHeader, actionsHeader] = screen.getAllByRole("columnheader");
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    expect(actionsHeader).not.toHaveAttribute("aria-sort");
  });

  it("does not render a sort button when onSortChange is omitted", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: /Name/ })).not.toBeInTheDocument();
  });

  it("renders skeleton rows inside a tbody while loading", () => {
    const { container } = renderTable({ isLoading: true, data: undefined, skeletonRows: 3 });
    const table = container.querySelector("table");
    expect(table).toHaveAttribute("aria-busy", "true");
    // Every skeleton <tr> must have a <tbody> parent or the browser reparents it.
    const bodyRows = container.querySelectorAll("tbody > tr");
    expect(bodyRows.length).toBeGreaterThan(0);
    container.querySelectorAll("tr").forEach((tr) => {
      expect(["TBODY", "THEAD"]).toContain(tr.parentElement?.tagName);
    });
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("shows the error state with a retry action", () => {
    const onRetry = jest.fn();
    renderTable({ isError: true, onRetry });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the empty state with a primary action when nothing exists", () => {
    renderTable({
      data: [],
      emptyAction: <button type="button">Create soul</button>,
    });
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(screen.getByText("Create soul")).toBeInTheDocument();
  });

  it("distinguishes a filtered empty result and offers to clear filters", () => {
    const onClearFilters = jest.fn();
    renderTable({
      data: [],
      isFiltered: true,
      onClearFilters,
      emptyAction: <button type="button">Create soul</button>,
    });
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryByText("No data yet")).not.toBeInTheDocument();
    // The create action is wrong copy for a filtered dead end.
    expect(screen.queryByText("Create soul")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear all"));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it("spans the empty state across every column", () => {
    const { container } = renderTable({ data: [] });
    const cell = container.querySelector("tbody td");
    expect(cell).toHaveAttribute("colspan", String(columns.length));
  });

  it("renders pagination when page props are supplied", () => {
    const onPageChange = jest.fn();
    renderTable({ page: 2, totalPages: 5, totalCount: 33, onPageChange });
    expect(screen.getByText(/Page 2 of 5 \(33 items\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Next/));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("hides pagination while loading and when page props are absent", () => {
    const { rerender, container } = renderTable();
    expect(screen.queryByText(/Page/)).not.toBeInTheDocument();

    rerender(
      <DataTable<Row>
        caption="Souls table"
        columns={columns}
        data={rows}
        isLoading
        page={1}
        totalPages={5}
        onPageChange={() => {}}
        keyExtractor={(item) => item.id}
        renderRow={(item) => <td>{item.name}</td>}
      />
    );
    expect(within(container).queryByText(/Page 1 of 5/)).not.toBeInTheDocument();
  });

  it("keeps headers visible in the empty state so columns stay readable", () => {
    renderTable({ data: [] });
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });
});
