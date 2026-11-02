/**
 * /souls 的「导出 CSV」(W-8):带列表当前的筛选 / 搜索,不带页码,也不带 `ids`
 * (带 `ids` 的是批量条的「导出」,见 SoulsBatchRecycle.test.tsx)。行数取列表的 `count`。
 * 文件里有哪些行是后端的事,见 backend/tests/test_soul_export.py。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulsPage from "@/app/souls/page";

let mockRows: Record<string, unknown>[] = [];
jest.mock("@soulledger/core/hooks/useSouls", () => ({
  useSoulImportPreview: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, reset: jest.fn() }),
  useSoulImportCommit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, reset: jest.fn() }),
  useSouls: () => ({
    data: { results: mockRows, count: 21 },
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: jest.fn(),
  }),
  useSoul: () => ({ isLoading: false, isError: false }),
  useCreateSoul: () => ({ mutateAsync: jest.fn() }),
  useBatchRecycleSouls: () => ({ mutate: jest.fn(), isPending: false }),
}));

const mockExportCsv = jest.fn();
const mockExport = jest.fn();
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  PAGE_SIZE: 20,
  soulsApi: {
    list: jest.fn().mockResolvedValue({ data: { count: 0, results: [] } }),
    export: (...args: unknown[]) => mockExport(...args),
    exportCsv: (...args: unknown[]) => mockExportCsv(...args),
  },
}));
let mockSearch = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
const mockSave = jest.fn();
jest.mock("@/src/lib/saveBlob", () => ({ saveBlob: (...args: unknown[]) => mockSave(...args) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { role: "OPERATOR", permissions: ["soul.read", "soul.export"] } }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockSearch = "";
  mockRows = [];
  mockExportCsv.mockResolvedValue({ data: new Blob(["id\n"]) });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SoulsPage />
    </QueryClientProvider>
  );
}

it("导出 CSV 带当前的搜索与状态筛选,不带页码、不带 ids,文件交给 saveBlob", async () => {
  mockSearch = "q=沈&state=JUDGING";
  renderPage();
  const button = await screen.findByRole("button", { name: "common.export_scope:21" });
  expect(button).toHaveTextContent("common.export_csv");
  fireEvent.click(button);
  await waitFor(() => expect(mockExportCsv).toHaveBeenCalledTimes(1));
  const params = mockExportCsv.mock.calls[0][0];
  expect(params).toEqual({ search: "沈", state: "JUDGING" });
  expect(params.page).toBeUndefined();
  expect(params).not.toHaveProperty("ids");
  expect(mockExport).not.toHaveBeenCalled();
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
});

it("没有筛选时导出整份列表:请求不带任何筛选", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "common.export_scope:21" }));
  await waitFor(() => expect(mockExportCsv).toHaveBeenCalledTimes(1));
  expect(mockExportCsv.mock.calls[0][0]).toEqual({});
});

// 审计 1017 #9:「显示已归档」同处置页;开着时列表与导出都带 `show_archived=1`,已归档的行标「□ 已归档」。
it("「显示已归档」开着时导出带 show_archived=1,已归档的行标出来,其余的不标", async () => {
  mockRows = [
    { id: "a1", name: "沈青梧", civilization: "CHINESE", current_state: "DISPOSED", birth_date: null, death_date: null, date_problems: [], has_date_warning: false, has_record_error: false, is_eval_identity: false, is_archived: true },
    { id: "b2", name: "Marguerite Vey", civilization: "EUROPEAN", current_state: "JUDGING", birth_date: null, death_date: null, date_problems: [], has_date_warning: false, has_record_error: false, is_eval_identity: false, is_archived: false },
  ];
  renderPage();
  const toggle = await screen.findByRole("button", { name: "records.archive.show_archived" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "common.export_scope:21" }));
  await waitFor(() => expect(mockExportCsv).toHaveBeenCalledTimes(1));
  expect(mockExportCsv.mock.calls[0][0]).toEqual({ show_archived: "1" });

  const marks = screen.getAllByTestId("soul-archived");
  expect(marks).toHaveLength(1);
  expect(marks[0].closest("tr")).toHaveTextContent("沈青梧");
});

// 表头是「死亡时间、孟婆汤」,单元格曾是反的:日期落在孟婆汤一列下(演示数据第一次把两列都填满时才看出来)。
it("死亡日期落在「死亡时间」列下,不落在孟婆汤列下", async () => {
  mockRows = [
    { id: "a1", name: "沈青梧", civilization: "CHINESE", current_state: "DISPOSED", birth_date: null, death_date: { year: 1303, month: 4, day: 6 }, merit_score: 1, demerit_score: 0, karmic_balance: 1, is_archived: false, date_problems: [], soup_taken_at: null },
  ];
  renderPage();
  const headers = (await screen.findAllByRole("columnheader")).map((h) => h.textContent ?? "");
  const column = headers.findIndex((h) => h.includes("souls.death"));
  expect(column).toBeGreaterThan(0);
  const cells = screen.getByText("沈青梧").closest("tr")!.querySelectorAll("td");
  expect(cells[column]).toHaveTextContent("1303");
});
