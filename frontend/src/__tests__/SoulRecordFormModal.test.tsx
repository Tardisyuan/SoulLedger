/**
 * 功过台账的「新增一条 / 修改」:表单发出什么、拦下什么、后端的 400 落在哪、存好后的律条快照,
 * 以及台账本身只在传了 `edit`(调用方判过 `soul.update`)时才画这两个入口。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { LedgerRecord } from "@soulledger/core/api/ledger";
import { SoulLedgerBook } from "@/src/components/souls/SoulLedgerBook";
import { SoulRecordFormModal } from "@/src/components/souls/SoulRecordFormModal";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  soulsApi: { addRecord: jest.fn(), updateRecord: jest.fn() },
}));
const { soulsApi } = jest.requireMock("@soulledger/core/api") as {
  soulsApi: { addRecord: jest.Mock; updateRecord: jest.Mock };
};

function mockStatute(id: string, code: string, civilization: string, clauses: string[] = []) {
  return { id, code, civilization, display_title: `${code}题`, payload_json: { clauses: clauses.map((c) => ({ condition_zh: c })) } };
}
jest.mock("@soulledger/core/hooks/useStatutes", () => ({
  useAllStatutes: () => ({
    data: [
      mockStatute("st-cn", "CN-1", "CHINESE", ["赈济穷民百钱", "施药"]),
      mockStatute("st-eu", "EU-1", "EUROPEAN"),
    ],
  }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, formatDate: (v: string) => v, locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@soulledger/core/platform", () => ({
  ...jest.requireActual("@soulledger/core/platform"),
  notify: jest.fn(),
}));

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const RECORD: LedgerRecord = {
  id: "r1", type: "DEMERIT", category: "GREED", description: "克扣", original_weight: 7, effective_weight: 7,
  years_elapsed: 0, decay_factor: 1, civilization: "CHINESE", recorded_at: "2020-01-01T00:00:00Z",
  event_date: { year: 1990, month: 5, day: 6 }, is_milestone: false,
  statute_clause: "CN-1:施药", occurrence_count: 3,
  statute_snapshot: { statute_id: "st-cn", code: "CN-1", revision: 1, effective_from: "2020-01-01", title: { zh: "题" }, text: {}, source: "", hash: "h", at: "2020-01-01T00:00:00Z" },
  life_stage: "ADULTHOOD", evidence_source: "WITNESS", evidence_note: "邻人",
};

const label = (key: string) => screen.getByLabelText(new RegExp(tZh(key)));
const lastCall = (mock: jest.Mock) => mock.mock.calls[mock.mock.calls.length - 1];

beforeEach(() => {
  soulsApi.addRecord.mockReset();
  soulsApi.updateRecord.mockReset();
});

function openAdd(onClose = jest.fn()) {
  wrap(<SoulRecordFormModal isOpen onClose={onClose} soulId="s1" civilization="CHINESE" />);
  return onClose;
}

describe("新增", () => {
  it("sends the form as typed, with no event_date unless one was entered, and closes when no statute was cited", async () => {
    soulsApi.addRecord.mockResolvedValue({ data: { statute_snapshot: null } });
    const onClose = openAdd();
    fireEvent.change(label("ledger.book.col_item"), { target: { value: "  赈济  " } });
    fireEvent.change(label("ledger.figure_scale_weight"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("common.save") }));
    await waitFor(() => expect(soulsApi.addRecord).toHaveBeenCalled());
    expect(lastCall(soulsApi.addRecord)).toEqual([
      "s1",
      {
        record_type: "MERIT", category: "OTHER", description: "赈济", weight: 12, occurrence_count: null,
        statute_clause: "", statute: null, life_stage: "", evidence_source: "", evidence_note: "",
      },
    ]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("blocks an empty description and a weight outside 1–100 before any request", () => {
    openAdd();
    fireEvent.change(label("ledger.figure_scale_weight"), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("common.save") }));
    expect(screen.getByText(tZh("common.field_required"))).toBeInTheDocument();
    expect(screen.getByText(tZh("ledger.book.form.weight_range"))).toBeInTheDocument();
    expect(soulsApi.addRecord).not.toHaveBeenCalled();
  });

  it("lists only the soul's own civilization's statutes, and a count needs a clause (and the reverse)", () => {
    openAdd();
    const select = label("ledger.book.form.statute") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "st-cn"]);
    fireEvent.change(label("ledger.book.form.occurrence_count"), { target: { value: "2" } });
    fireEvent.change(label("ledger.book.form.statute") as HTMLSelectElement, { target: { value: "st-cn" } });
    fireEvent.change(label("ledger.book.col_item"), { target: { value: "事" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("common.save") }));
    expect(screen.getByText(tZh("ledger.book.form.count_needs_clause"))).toBeInTheDocument();
    expect(soulsApi.addRecord).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(new RegExp(`^${tZh("ledger.book.clause")}`)), { target: { value: "施药" } });
    fireEvent.change(label("ledger.book.form.occurrence_count"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("common.save") }));
    expect(screen.getByText(tZh("ledger.book.form.clause_needs_count"))).toBeInTheDocument();
    expect(soulsApi.addRecord).not.toHaveBeenCalled();
  });

  it("sends code:clause with the statute id, then shows the snapshot the server froze", async () => {
    soulsApi.addRecord.mockResolvedValue({
      data: { statute_snapshot: { code: "CN-1", title: { zh: "赈济篇", en: "Relief" } } },
    });
    const onClose = openAdd();
    fireEvent.change(label("ledger.book.col_item"), { target: { value: "施药" } });
    fireEvent.change(label("ledger.book.form.statute"), { target: { value: "st-cn" } });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${tZh("ledger.book.clause")}`)), { target: { value: "施药" } });
    fireEvent.change(label("ledger.book.form.occurrence_count"), { target: { value: "2" } });
    fireEvent.change(label("ledger.book.col_date"), { target: { value: "1990-05-06" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("common.save") }));
    await waitFor(() => expect(soulsApi.addRecord).toHaveBeenCalled());
    expect(lastCall(soulsApi.addRecord)[1]).toMatchObject({
      statute: "st-cn", statute_clause: "CN-1:施药", occurrence_count: 2, event_date: "1990-05-06",
    });
    const snapshot = await screen.findByTestId("record-snapshot");
    expect(snapshot).toHaveTextContent("CN-1 赈济篇");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: tZh("common.close") }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's 400 under the field it names", async () => {
    soulsApi.addRecord.mockRejectedValue({ response: { status: 400, data: { occurrence_count: ["Ensure this value is greater than or equal to 1."] } } });
    openAdd();
    fireEvent.change(label("ledger.book.col_item"), { target: { value: "事" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("common.save") }));
    expect(await screen.findByText(/Ensure this value is greater than or equal to 1/)).toBeInTheDocument();
    expect(label("ledger.book.form.occurrence_count")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("修改", () => {
  function openEdit() {
    wrap(<SoulRecordFormModal isOpen onClose={jest.fn()} soulId="s1" civilization="CHINESE" record={RECORD} />);
  }

  it("prefills from the ledger row and leaves the date out unless it was touched", async () => {
    soulsApi.updateRecord.mockResolvedValue({ data: { statute_snapshot: null } });
    openEdit();
    expect((label("ledger.book.col_item") as HTMLTextAreaElement).value).toBe("克扣");
    expect((label("ledger.figure_scale_weight") as HTMLInputElement).value).toBe("7");
    expect((label("ledger.book.col_date") as HTMLInputElement).value).toBe("1990-05-06");
    expect((label("ledger.book.form.statute") as HTMLSelectElement).value).toBe("st-cn");
    fireEvent.change(label("ledger.figure_scale_weight"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("common.save") }));
    await waitFor(() => expect(soulsApi.updateRecord).toHaveBeenCalled());
    const [id, recordId, data] = lastCall(soulsApi.updateRecord);
    expect([id, recordId]).toEqual(["s1", "r1"]);
    expect(data).toMatchObject({
      record_type: "DEMERIT", weight: 9, statute: "st-cn", statute_clause: "CN-1:施药", occurrence_count: 3,
      life_stage: "ADULTHOOD", evidence_source: "WITNESS", evidence_note: "邻人",
    });
    expect(data).not.toHaveProperty("event_date");
    expect(soulsApi.addRecord).not.toHaveBeenCalled();
  });

  it("sends event_date: null when the date was cleared", async () => {
    soulsApi.updateRecord.mockResolvedValue({ data: { statute_snapshot: null } });
    openEdit();
    fireEvent.change(label("ledger.book.col_date"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("common.save") }));
    await waitFor(() => expect(soulsApi.updateRecord).toHaveBeenCalled());
    expect(lastCall(soulsApi.updateRecord)[2]).toMatchObject({ event_date: null });
  });
});

describe("台账里的入口", () => {
  it("draws 新增一条 and a 修改 per row only when `edit` is given", () => {
    const { unmount } = wrap(<SoulLedgerBook records={[RECORD]} />);
    expect(screen.queryByTestId("record-add")).toBeNull();
    expect(document.querySelector("[data-record-edit]")).toBeNull();
    unmount();
    wrap(<SoulLedgerBook records={[RECORD]} edit={{ soulId: "s1", civilization: "CHINESE" }} />);
    expect(screen.getByTestId("record-add")).toHaveTextContent(tZh("ledger.book.form.add_button"));
    const edit = document.querySelector('[data-record-edit="r1"]') as HTMLElement;
    fireEvent.click(edit);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(tZh("ledger.book.form.edit_title"))).toBeInTheDocument();
  });

  it("offers 新增一条 on an empty book too", () => {
    wrap(<SoulLedgerBook records={[]} edit={{ soulId: "s1", civilization: "CHINESE" }} />);
    fireEvent.click(screen.getByTestId("record-add"));
    expect(screen.getByText(tZh("ledger.book.form.add_title"))).toBeInTheDocument();
  });
});
