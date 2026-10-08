/**
 * components/souls/SoulImportDialog.tsx — the /souls 「导入」 dialog (CSV bulk import).
 *
 * Pinned: choosing a file sends it to the PREVIEW call and nothing else (commit is not reached);
 * the preview table puts each error in the cell it belongs to, with a ✕ glyph and the code's
 * text; the counts line and 「只看有错误的」 narrow to bad rows; the commit button is disabled
 * while any row has an error AND the reason is said beside it, and is enabled only when the
 * preview is clean; a refused commit (422) swaps in the refusal's rows and stays disabled; a
 * file-level 400 shows its own message (with `columns`); a successful commit says how many were
 * created and links to the list narrowed to that batch; the template is a BOM + header + one
 * example row in the importer's own civilization.
 *
 * The 400 / 422 are real AxiosErrors through the real `soulImportFileErrorOf` /
 * `soulImportRowsRefusalOf`, so the dialog is tested against the shapes the API module recognises.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { SoulImportDialog, soulImportTemplate } from "@/src/components/souls/SoulImportDialog";

type Row = {
  row: number;
  status: "ok" | "error";
  values: Record<string, string>;
  errors: { field: string; code: string }[];
};
const values = (name: string) => ({
  name,
  civilization: "CHINESE",
  birth_date: "",
  death_date: "",
  origin_location: "",
  birth_name: "",
  description: "",
});
const OK: Row = { row: 2, status: "ok", values: values("沈青梧"), errors: [] };
const DUP: Row = {
  row: 3,
  status: "error",
  values: values("周慕云"),
  errors: [{ field: "name", code: "duplicate_existing" }],
};
const LONG: Row = {
  row: 4,
  status: "error",
  values: values("王素心"),
  errors: [{ field: "description", code: "too_long" }],
};
const preview = (rows: Row[]) => ({
  total: rows.length,
  ok_count: rows.filter((r) => r.status === "ok").length,
  error_count: rows.filter((r) => r.status === "error").length,
  max_rows: 1000,
  rows,
});

const mockPreview = jest.fn();
const mockCommit = jest.fn();
jest.mock("@soulledger/core/hooks/useSouls", () => ({
  useSoulImportPreview: () => ({ mutate: (...a: unknown[]) => mockPreview(...a), isPending: false }),
  useSoulImportCommit: () => ({ mutate: (...a: unknown[]) => mockCommit(...a), isPending: false }),
}));
const mockSave = jest.fn();
jest.mock("@/src/lib/saveBlob", () => ({ saveBlob: (...args: unknown[]) => mockSave(...args) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { tenant: { code: "EG_DUAT", display_name: "Duat", civilization: "EGYPTIAN" } } }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const CSV = new File(["name,civilization\n沈青梧,CHINESE\n"], "souls.csv", { type: "text/csv" });

function axiosError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("x", "ERR_BAD_REQUEST", config, null, {
    status,
    statusText: "",
    headers: {},
    config,
    data,
  });
}

/** Open the dialog and choose a file; `answer` is what the preview call calls back with. */
function choose(answer: { rows?: Row[]; error?: unknown }) {
  mockPreview.mockImplementation((_form, opts) => {
    if (answer.error) opts.onError(answer.error);
    else opts.onSuccess(preview(answer.rows ?? []));
  });
  render(<SoulImportDialog isOpen onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("souls.import.choose_file"), { target: { files: [CSV] } });
}

const commitButton = () => screen.getByRole("button", { name: /^souls\.import\.commit/ });

beforeEach(() => {
  mockPreview.mockReset();
  mockCommit.mockReset();
  mockSave.mockReset();
});

it("choosing a file calls preview with that file, and never commit", () => {
  choose({ rows: [OK] });
  expect(mockPreview).toHaveBeenCalledTimes(1);
  const form = mockPreview.mock.calls[0][0] as FormData;
  expect(form.get("file")).toBe(CSV);
  expect(mockCommit).not.toHaveBeenCalled();
});

it("shows each error in its own cell, with a glyph and the code's text", () => {
  choose({ rows: [OK, DUP, LONG] });
  const dupRow = screen.getByText("周慕云").closest("tr") as HTMLElement;
  const nameCell = within(dupRow).getByText("周慕云").closest("td") as HTMLElement;
  expect(within(nameCell).getByText("souls.import.row_codes.duplicate_existing")).toBeInTheDocument();
  expect(nameCell.textContent).toContain("✕");
  // a column the table does not show (description) is reported in the status cell, named
  const longRow = screen.getByText("王素心").closest("tr") as HTMLElement;
  const status = within(longRow).getByText("description").closest("td") as HTMLElement;
  expect(status.textContent).toContain("souls.import.row_codes.too_long");
  // the clean row carries no error text at all
  const okRow = screen.getByText("沈青梧").closest("tr") as HTMLElement;
  expect(okRow.textContent).not.toContain("✕");
  expect(okRow.getAttribute("data-status")).toBe("ok");
  // counts line
  expect(screen.getByText("souls.import.summary:3,1,2")).toBeInTheDocument();
});

it("「只看有错误的」 hides the passing rows, and says so when none are left to show", () => {
  choose({ rows: [OK, DUP] });
  expect(screen.getByText("沈青梧")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "souls.import.only_errors" }));
  expect(screen.queryByText("沈青梧")).toBeNull();
  expect(screen.getByText("周慕云")).toBeInTheDocument();
});

it("commit is disabled while any row has an error, and the reason is stated", () => {
  choose({ rows: [OK, DUP] });
  expect(commitButton()).toBeDisabled();
  expect(screen.getByText("souls.import.blocked:1")).toBeInTheDocument();
  fireEvent.click(commitButton());
  expect(mockCommit).not.toHaveBeenCalled();
});

it("commit is disabled before any file is chosen", () => {
  render(<SoulImportDialog isOpen onClose={jest.fn()} />);
  expect(commitButton()).toBeDisabled();
  expect(screen.queryByText(/souls\.import\.blocked/)).toBeNull();
});

it("a clean preview enables commit, sends the same file, then offers the batch", () => {
  choose({ rows: [OK] });
  expect(commitButton()).toBeEnabled();
  expect(screen.queryByText(/souls\.import\.blocked/)).toBeNull();
  mockCommit.mockImplementation((_form, opts) => opts.onSuccess({ created: 1, batch_id: "b-123" }));
  fireEvent.click(commitButton());
  expect((mockCommit.mock.calls[0][0] as FormData).get("file")).toBe(CSV);
  expect(screen.getByText("souls.import.success:1")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "souls.import.view_batch" })).toHaveAttribute(
    "href",
    "/souls?import_batch=b-123"
  );
});

it("a refused commit (422) swaps in the refusal's rows and stays disabled", () => {
  choose({ rows: [OK] });
  mockCommit.mockImplementation((_form, opts) => opts.onError(axiosError(422, preview([OK, DUP]))));
  fireEvent.click(commitButton());
  expect(screen.getByText("souls.import.row_codes.duplicate_existing")).toBeInTheDocument();
  expect(commitButton()).toBeDisabled();
  expect(screen.queryByText(/souls\.import\.success/)).toBeNull();
});

it("a file-level 400 shows its message with the columns, and no table", () => {
  choose({ error: axiosError(400, { code: "missing_columns", columns: ["civilization"] }) });
  expect(screen.getByRole("alert").textContent).toContain("souls.import.file_codes.missing_columns:civilization");
  expect(screen.queryByRole("table")).toBeNull();
  expect(commitButton()).toBeDisabled();
});

it("an unrecognised failure falls back to the generic message", () => {
  choose({ error: new Error("network") });
  expect(screen.getByRole("alert").textContent).toContain("souls.import.file_codes.unknown");
});

it("the template is a BOM, the header and one example row in the caller's own civilization", () => {
  render(<SoulImportDialog isOpen onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "souls.import.template" }));
  const [content, filename] = mockSave.mock.calls[0] as [string, string];
  expect(filename).toBe("souls_import_template.csv");
  expect(content).toBe(soulImportTemplate("EGYPTIAN"));
  expect(content.startsWith("﻿name,civilization,birth_date,death_date,origin_location,birth_name,description\n")).toBe(true);
  expect(content.trim().split("\n")).toHaveLength(2);
  expect(content.split("\n")[1]).toContain(",EGYPTIAN,");
});
