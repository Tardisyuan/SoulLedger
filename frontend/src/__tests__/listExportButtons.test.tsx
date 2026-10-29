/**
 * 「导出」入口(第十五批 C3):/dispatch、/disposition、/cross-judgments 各有一个,
 * 带的就是该列表(该段)用的筛选。权限是各自的导出码(2026-10-29 从读码拆出:dispatch.export /
 * disposition.export / cross_judgment.export)—— 只有读码没有导出码,就没有按钮。
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
    mockPermissions = ["dispatch.read", "dispatch.export"];
    renderWith(<DispatchPage />);
    const buttons = await screen.findAllByRole("button", { name: "common.export" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(dispatchApi.exportCsv).toHaveBeenCalledWith({ section: "proposed" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(csv.data, expect.stringMatching(/^dispatch\.title-plaque\.office\.court\.cn-\d{8}-\d{4}\.csv$/)));
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(dispatchApi.exportCsv).toHaveBeenLastCalledWith({ section: "history" }));
  });

  it("says so, and saves nothing, when the export fails", async () => {
    mockPermissions = ["dispatch.read", "dispatch.export"];
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

describe("export codes are their own (2026-10-29)", () => {
  it("dispatch.read alone: the tables, no export", async () => {
    mockPermissions = ["dispatch.read"];
    renderWith(<DispatchPage />);
    await waitFor(() => expect(dispatchApi.proposed).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "common.export" })).toBeNull();
  });

  it("cross_judgment.read alone: the list, no export", async () => {
    mockPermissions = ["cross_judgment.read"];
    renderWith(<CrossJudgmentsPage />);
    await waitFor(() => expect(crossTenantJudgmentsApi.list).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "common.export" })).toBeNull();
  });

  it("disposition.read alone: the sections, no export", async () => {
    mockPermissions = ["disposition.read"];
    renderWith(<DispositionPage />);
    await waitFor(() => expect(dispositionApi.list).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "common.export" })).toBeNull();
  });
});

describe("/cross-judgments", () => {
  it("offers the export to a reader and sends the list's filters (none by default)", async () => {
    mockPermissions = ["cross_judgment.read", "cross_judgment.export"];
    renderWith(<CrossJudgmentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "common.export" }));
    await waitFor(() => expect(crossTenantJudgmentsApi.exportCsv).toHaveBeenCalledWith({}));
    expect(saveBlob).toHaveBeenCalledWith(csv.data, expect.stringMatching(/^crossJudgments\.title-plaque\.office\.trials-\d{8}-\d{4}\.csv$/));
  });

  it("filters by status and by our side, and the export carries the same filters", async () => {
    mockPermissions = ["cross_judgment.read", "cross_judgment.export"];
    renderWith(<CrossJudgmentsPage />);
    fireEvent.change(await screen.findByRole("combobox", { name: "crossJudgments.filter.side" }), {
      target: { value: "participating" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "crossJudgments.status_label" }), { target: { value: "ACTIVE" } });
    await waitFor(() =>
      expect(crossTenantJudgmentsApi.list).toHaveBeenLastCalledWith({ page: "1", side: "participating", status: "ACTIVE" })
    );
    fireEvent.click(screen.getByRole("button", { name: "common.export" }));
    await waitFor(() => expect(crossTenantJudgmentsApi.exportCsv).toHaveBeenCalledWith({ side: "participating", status: "ACTIVE" }));
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
    mockPermissions = ["disposition.read", "disposition.export"];
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
    // 页级门(rbac-web L-1):没有 disposition.read 整页就是 403,三段一个请求都不发。
    expect(await screen.findByTestId("permission-denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.export" })).toBeNull();
    expect(dispositionApi.list).not.toHaveBeenCalled();
  });
});
