/**
 * /judgment 的 CSV 导出(Design 第二十八批 W5):「待审」一面的按钮在筛选条右端,带搜索 / 殿 / 灵魂这组筛选;
 * 「已结案」一面没有筛选条,按钮在表上方右端。两边都不带页码,行数超过 1 万按钮置灰。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JudgmentListPage from "@/app/judgment/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { list: jest.fn(), queueCounts: jest.fn(), courts: jest.fn(), exportCsv: jest.fn() },
  usersApi: { list: jest.fn() },
  soulsApi: { get: jest.fn() },
  PAGE_SIZE: 20,
}));
const { judgmentApi } = jest.requireMock("@soulledger/core/api") as Record<string, Record<string, jest.Mock>>;

jest.mock("@/src/lib/saveBlob", () => ({ saveBlob: jest.fn() }));
let mockSearch = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/judgment",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, formatDate: (v: unknown) => String(v), formatDateTime: (v: unknown) => String(v), locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "yama", role: "JUDGE", permissions: ["judgment.read", "judgment.execute"], tenant: { code: "diyu" } } }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

let pendingTotal = 12;
let concludedCount = 148;
beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  mockSearch = "";
  pendingTotal = 12;
  concludedCount = 148;
  judgmentApi.list.mockImplementation(async (params: Record<string, string>) => ({
    data: { count: params.has_verdict === "true" ? concludedCount : 0, next: null, previous: null, results: [] },
  }));
  judgmentApi.queueCounts.mockImplementation(async () => ({
    data: { mine: 0, unclaimed: pendingTotal, others: 0, deferred: 0, total: pendingTotal },
  }));
  judgmentApi.courts.mockResolvedValue({ data: [] });
  judgmentApi.exportCsv.mockResolvedValue({ data: new Blob(["id\n"]) });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JudgmentListPage />
    </QueryClientProvider>
  );
}
const exportButton = () => screen.findByRole("button", { name: "导出" });

describe("审判队列导出", () => {
  it("待审:请求带当前搜索与灵魂,是未结案,不带页码、不带分组", async () => {
    const soul = "0b0d9c3e-1111-4222-8333-444455556666";
    mockSearch = `q=沈&soul=${soul}`;
    renderPage();
    fireEvent.click(await exportButton());
    await waitFor(() => expect(judgmentApi.exportCsv).toHaveBeenCalledTimes(1));
    const params = judgmentApi.exportCsv.mock.calls[0][0];
    expect(params).toEqual({ search: "沈", soul, has_verdict: "false" });
    expect(params).not.toHaveProperty("page");
    expect(params).not.toHaveProperty("group");
  });

  it("待审:行数超过 1 万置灰,恰好 1 万仍可用", async () => {
    pendingTotal = 10_000;
    const { unmount } = renderPage();
    await waitFor(() => expect(judgmentApi.queueCounts).toHaveBeenCalled());
    expect(await exportButton()).toBeEnabled();
    unmount();

    pendingTotal = 10_001;
    renderPage();
    const button = await exportButton();
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(judgmentApi.exportCsv).not.toHaveBeenCalled();
  });

  it("已结案:请求是已结案、带灵魂,不带页码;超过 1 万置灰", async () => {
    const soul = "0b0d9c3e-1111-4222-8333-444455556666";
    mockSearch = `soul=${soul}`;
    const { unmount } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /已结案/ }));
    await waitFor(() => expect(judgmentApi.list).toHaveBeenCalledWith(expect.objectContaining({ has_verdict: "true" })));
    fireEvent.click(await exportButton());
    await waitFor(() => expect(judgmentApi.exportCsv).toHaveBeenCalledTimes(1));
    expect(judgmentApi.exportCsv.mock.calls[0][0]).toEqual({ has_verdict: "true", soul });
    unmount();

    concludedCount = 10_001;
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /已结案/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "导出" })).toBeDisabled());
  });
});
