/**
 * Tests for the DataGrid column taxonomy (design doc §1) and the selection
 * capability (§6). Migrated screens (app/audit/page.tsx, app/permissions/page.tsx)
 * are exercised indirectly through this — every cell they render goes through
 * renderGridCell, so a regression here is a regression everywhere.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { DataGrid } from "@/components/ui/data-grid/DataGrid";
import type { DataGridColumn } from "@/components/ui/data-grid/columns";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "pagination.info") return `Page ${params?.page} of ${params?.total}`;
      if (key === "common.prev") return "Previous";
      if (key === "common.next") return "Next";
      if (key === "common.error") return "Something went wrong";
      if (key === "common.retry") return "Retry";
      if (key === "filter.clear_all") return "Clear all";
      if (key === "table.empty") return "No data";
      if (key === "table.no_results") return "No matches";
      return key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

interface Row {
  id: string;
  code: string | null;
  label: string;
  karma: number | null;
  status: "alive" | "disposed";
}

const rows: Row[] = [
  { id: "1", code: "soul.create", label: "Apr Soul", karma: 310, status: "alive" },
  { id: "2", code: null, label: "Beta Soul", karma: 0, status: "disposed" },
];

const columns: DataGridColumn<Row>[] = [
  { type: "identifier", key: "code", header: "Code", value: (r) => r.code },
  { type: "text", key: "label", header: "Label", value: (r) => r.label },
  {
    type: "numeric",
    key: "karma",
    header: "Karma",
    value: (r) => r.karma,
    format: (n) => (n >= 0 ? `+${n}` : String(n)),
  },
  {
    type: "enum",
    key: "status",
    header: "Status",
    value: (r) => ({ tone: r.status === "alive" ? "success" : "neutral", label: r.status }),
  },
  {
    type: "actions",
    key: "actions",
    header: "Actions",
    srOnlyHeader: true,
    menuLabel: "Row actions",
    primary: (r) => ({ label: "Edit", onSelect: () => onEdit(r) }),
    items: (r) => [{ key: "delete", label: "Delete", tone: "danger", onSelect: () => onDelete(r) }],
  },
];

const onEdit = jest.fn();
const onDelete = jest.fn();

beforeEach(() => {
  onEdit.mockClear();
  onDelete.mockClear();
});

describe("DataGrid column taxonomy", () => {
  it("renders an identifier column in mono, and an em dash when the value is missing", () => {
    render(<DataGrid<Row> caption="Rows" columns={columns} data={rows} keyExtractor={(r) => r.id} />);
    expect(screen.getByText("soul.create")).toBeInTheDocument();
    // Beta Soul's code is null — the identifier empty state is a dash, not blank.
    expect(screen.getAllByText("—")[0]).toBeInTheDocument();
  });

  it("distinguishes a zero numeric value from a missing one", () => {
    render(<DataGrid<Row> caption="Rows" columns={columns} data={rows} keyExtractor={(r) => r.id} />);
    // karma: 0 must render "+0", not the empty-state dash.
    expect(screen.getByText("+0")).toBeInTheDocument();
    expect(screen.getByText("+310")).toBeInTheDocument();
  });

  it("renders enum values as badges with their label", () => {
    render(<DataGrid<Row> caption="Rows" columns={columns} data={rows} keyExtractor={(r) => r.id} />);
    expect(screen.getByText("alive")).toBeInTheDocument();
    expect(screen.getByText("disposed")).toBeInTheDocument();
  });

  it("puts one primary verb inline and the rest behind the overflow trigger", () => {
    render(<DataGrid<Row> caption="Rows" columns={columns} data={rows} keyExtractor={(r) => r.id} />);
    const editButtons = screen.getAllByText("Edit");
    expect(editButtons).toHaveLength(2);
    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledWith(rows[0]);

    // Delete is not visible until the "⋯" trigger opens the menu.
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    const triggers = screen.getAllByRole("button", { name: "Row actions" });
    fireEvent.click(triggers[0]);
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith(rows[0]);
  });
});

describe("DataGrid selection", () => {
  function renderWithSelection(selectedIds: Set<string>, onToggleRow = jest.fn(), onToggleAllVisible = jest.fn()) {
    render(
      <DataGrid<Row>
        caption="Rows"
        columns={columns}
        data={rows}
        keyExtractor={(r) => r.id}
        selection={{
          selectedIds,
          getId: (r) => r.id,
          onToggleRow,
          onToggleAllVisible,
          onClear: jest.fn(),
          labels: {
            selectedCount: (n) => `${n} selected`,
            clearSelection: "Clear selection",
            selectAllLabel: "Select all",
          },
        }}
      />
    );
    return { onToggleRow, onToggleAllVisible };
  }

  it("shows no bulk bar when nothing is selected", () => {
    renderWithSelection(new Set());
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("shows the bulk bar and count once a row is selected", () => {
    renderWithSelection(new Set(["1"]));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("toggles one row via its checkbox", () => {
    const { onToggleRow } = renderWithSelection(new Set());
    const checkboxes = screen.getAllByRole("checkbox");
    // First checkbox is select-all; row checkboxes follow.
    fireEvent.click(checkboxes[1]);
    expect(onToggleRow).toHaveBeenCalledWith("1");
  });

  it("toggles every visible row via select-all", () => {
    const { onToggleAllVisible } = renderWithSelection(new Set());
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(onToggleAllVisible).toHaveBeenCalledWith(["1", "2"]);
  });
});
