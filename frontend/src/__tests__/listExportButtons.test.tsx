/**
 * 「导出」入口(第十五批 C3):/dispatch、/disposition、/cross-judgments 各有一个,
 * 带的就是该列表(该段)用的筛选,权限与列表的读码名一致 —— 没有读码名就没有按钮。
 * 内容(哪些行、哪些列)是后端的事,见 backend/tests/test_list_exports_dispatch_disposition_cross.py。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import DispatchPage from "@/app/dispatch/page";
import DispositionPage from "@/app/disposition/page";
import CrossJudgmentsPage from "@/app/cross-judgments/page";
import { crossTenantJudgmentsApi, dispatchApi, dispositionApi } from "@soulledger/core/api";
import { saveBlob } from "@/src/lib/saveBlob";

jest.mock("@soulledger/core/api", () => ({
  dispatchApi: { proposed: jest.fn(), history: jest.fn(), exportCsv: jest.fn() },
  dispositionApi: { list: jest.fn(), execute: jest.fn(), exportCsv: jest.fn() },
  crossTenantJudgmentsApi: { list: jest.fn(), exportCsv: jest.fn() },
  PAGE_SIZE: 20,
}));
jest.mock("@/src/lib/saveBlob", () => ({ saveBlob: jest.fn() }));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(",")}` : key),
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => v,
    locale: "en",
    hydrated: true,
  }),
}));
let mockPermissions: string[] = [];
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({
    user: { id: 1, username: "u", role: "JUDGE", tenant: null, permissions: mockPermissions },
  }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const page = { data: { results: [], count: 0 } };
const csv = { data: new Blob(["a,b"]) };

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = [];
  (dispatchApi.proposed as jest.Mock).mockResolvedValue(page);
  (dispatchApi.history as jest.Mock).mockResolvedValue(page);
  (dispatchApi.exportCsv as jest.Mock).mockResolvedValue(csv);
  (crossTenantJudgmentsApi.list as jest.Mock).mockResolvedValue(page);
  (crossTenantJudgmentsApi.exportCsv as jest.Mock).mockResolvedValue(csv);
  (dispositionApi.exportCsv as jest.Mock).mockResolvedValue(csv);
  const row = (id: string) => ({
    id, soul: `s${id}`, soul_name: `S${id}`, judgment: "j", destination_realm: null, is_eternal: false, is_executed: false,
    executed_at: null, memory_reset: "NONE", sentence_years: 1, term_start: null, term_end: null, notes: "",
    created_at: "2026-01-01", verdict: "PURGATORY", expired_at: null,
  });
  (dispositionApi.list as jest.Mock).mockImplementation((p: { section: string }) =>
    Promise.resolve({ data: { results: [row(p.section)], count: 1, section_counts: {} } })
  );
});

describe("/dispatch", () => {
  it("exports each of its two tables with that table's section, and saves the file", async () => {
    mockPermissions = ["dispatch.read"];
    renderWith(<DispatchPage />);
    const buttons = await screen.findAllByRole("button", { name: "common.export" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(dispatchApi.exportCsv).toHaveBeenCalledWith({ section: "proposed" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(csv.data, "dispatch_proposed.csv"));
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(dispatchApi.exportCsv).toHaveBeenLastCalledWith({ section: "history" }));
  });

  it("says so, and saves nothing, when the export fails", async () => {
    mockPermissions = ["dispatch.read"];
    (dispatchApi.exportCsv as jest.Mock).mockRejectedValue(new Error("boom"));
    renderWith(<DispatchPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "common.export" }))[0]);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("common.export_failed", "error"));
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("has no export without dispatch.read (the page itself is refused)", () => {
    renderWith(<DispatchPage />);
    expect(screen.queryByRole("button", { name: "common.export" })).toBeNull();
  });
});

describe("/cross-judgments", () => {
  it("offers the export to a reader and sends no parameters", async () => {
    mockPermissions = ["cross_judgment.read"];
    renderWith(<CrossJudgmentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "common.export" }));
    await waitFor(() => expect(crossTenantJudgmentsApi.exportCsv).toHaveBeenCalledWith());
    expect(saveBlob).toHaveBeenCalledWith(csv.data, "cross_judgments_export.csv");
  });

  it("offers nothing to someone without cross_judgment.read", async () => {
    mockPermissions = ["soul.read"];
    renderWith(<CrossJudgmentsPage />);
    await waitFor(() => expect(crossTenantJudgmentsApi.list).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "common.export" })).toBeNull();
  });
});

describe("/disposition", () => {
  it("exports each section under the filters its own table uses", async () => {
    mockPermissions = ["disposition.read"];
    renderWith(<DispositionPage />);
    const buttons = await screen.findAllByRole("button", { name: "common.export" });
    expect(buttons).toHaveLength(3);
    for (const b of buttons) fireEvent.click(b);
    await waitFor(() => expect(dispositionApi.exportCsv).toHaveBeenCalledTimes(3));
    expect((dispositionApi.exportCsv as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      { section: "pending" },
      { section: "executing", ordering: "term_end" },
      { section: "expired", soul_reborn: "false" },
    ]);
  });

  it("offers nothing without disposition.read", async () => {
    mockPermissions = ["disposition.execute"];
    renderWith(<DispositionPage />);
    await screen.findAllByTestId("section-count");
    expect(screen.queryByRole("button", { name: "common.export" })).toBeNull();
  });
});
