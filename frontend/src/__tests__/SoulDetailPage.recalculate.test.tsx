/**
 * 「重算功过」(W-10):`POST /ledger/calculate/<id>/`,后端要码名 `ledger.manage`。
 * 页面只在持有这个码名时给这一项(在 ⋯ 菜单里,Design 第三十七批 W-11a);点了先确认,确认后调 API,成功重取灵魂(页头的功 / 过读的是 Soul 自己的分)
 * 并报一句成功;失败报一句失败,不报成功。
 *
 * 身份走 `useTenant` 的桩(真门跑起来),不桩 `RequirePermission`(suiteShape 禁止)。
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulDetailPage from "@/app/souls/[id]/page";
import { makeTranslateWithFallback } from "@/src/contexts/I18nContext";

const SOUL_ID = "soul-1";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: SOUL_ID }),
}));
const mockToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockToast }) }));

const mockT = (key: string) => key;
const mockI18n = { t: mockT, tf: makeTranslateWithFallback(mockT), formatDate: (v: unknown) => String(v), locale: "en" };
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

jest.mock("@soulledger/core/hooks/useSouls", () => ({
  ...jest.requireActual("@soulledger/core/hooks/useSouls"),
  useUpdateSoul: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteSoul: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const mockUser: { role: string; permissions: string[] } = { role: "JUDGE", permissions: [] };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "u", tenant: null, ...mockUser }, tenantCode: null }),
}));

jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazySoulLineChart: () => null,
  LazyLifespanBarChart: () => null,
}));
jest.mock("@/src/components/souls/SoulEditModal", () => ({ SoulEditModal: () => null }));

const mockRecalculate = jest.fn();
jest.mock("@soulledger/core/api/ledger", () => ({
  ...jest.requireActual("@soulledger/core/api/ledger"),
  ledgerApi: {
    inheritance: jest.fn().mockRejectedValue({ response: { status: 409 } }),
    recalculate: (...args: unknown[]) => mockRecalculate(...args),
  },
}));

const mockSoulsGet = jest.fn();
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  soulsApi: {
    get: (...args: unknown[]) => mockSoulsGet(...args),
    karma: jest.fn().mockResolvedValue({ data: null }),
    records: jest.fn().mockResolvedValue({ data: [] }),
  },
  judgmentApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  dispositionApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  reincarnationApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }), reborn: jest.fn() },
  eventsApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
}));

const SOUL = {
  id: SOUL_ID,
  name: "Test Soul",
  civilization: "CHINESE",
  current_state: "SETTLED",
  birth_date: null,
  death_date: null,
  birth_name: null,
  origin_location: null,
  date_problems: [],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SoulDetailPage />
    </QueryClientProvider>
  );
}

/** 「重算功过」住在 ⋯ 菜单里:先开菜单,再找那一项。这组权限里没有 `soul.delete` —— 菜单照样出现。 */
const findButton = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));
  return screen.findByRole("menuitem", { name: "souls.detail.recalculate" });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.role = "JUDGE";
  mockUser.permissions = ["soul.read", "soul.update", "ledger.manage"];
  mockSoulsGet.mockResolvedValue({ data: SOUL });
});

describe("SoulDetailPage — 重算功过", () => {
  it("持 ledger.manage:确认后调 API,重取灵魂并报成功", async () => {
    mockRecalculate.mockResolvedValue({ data: { soul_id: SOUL_ID, merit_score: 1, demerit_score: 0, karmic_balance: 1 } });
    renderPage();
    fireEvent.click(await findButton());
    const getsBefore = mockSoulsGet.mock.calls.length;
    // 没确认之前什么都不发。
    expect(mockRecalculate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "common.confirm" }));

    await waitFor(() => expect(mockRecalculate).toHaveBeenCalledWith(SOUL_ID));
    await waitFor(() => expect(mockSoulsGet.mock.calls.length).toBeGreaterThan(getsBefore));
    expect(mockToast).toHaveBeenCalledWith("souls.detail.recalculate_success", "success");
    expect(mockToast).not.toHaveBeenCalledWith(expect.anything(), "error");
  });

  it("失败:报失败,不报成功", async () => {
    mockRecalculate.mockRejectedValue({ response: { status: 404, data: { error: "NOT_FOUND", message: "Soul not found" } } });
    renderPage();
    fireEvent.click(await findButton());
    fireEvent.click(await screen.findByRole("button", { name: "common.confirm" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("souls.detail.recalculate_failed", "error"));
    expect(mockToast).not.toHaveBeenCalledWith("souls.detail.recalculate_success", "success");
  });

  it("不持 ledger.manage:没有这一项(这组权限下连 ⋯ 都没有)", async () => {
    mockUser.permissions = ["soul.read", "soul.update"];
    renderPage();
    await screen.findByRole("button", { name: "souls.detail.edit" });
    expect(screen.queryByRole("button", { name: "更多操作" })).not.toBeInTheDocument();
    expect(screen.queryByText("souls.detail.recalculate")).not.toBeInTheDocument();
  });

  it("增改功过跟着 ledger.manage 走,不再跟 soul.update(2026-10-29 第 19 条)", async () => {
    const { soulsApi } = jest.requireMock("@soulledger/core/api") as { soulsApi: { karma: jest.Mock } };
    soulsApi.karma.mockResolvedValue({
      data: {
        reading: { kind: "BALANCE", civilization: "CHINESE", merit: 0, demerit: 0, balance: 0 },
        merit_score: 0, demerit_score: 0, karmic_balance: 0, record_count: 0, records: [],
      },
    });
    try {
    mockUser.permissions = ["soul.read", "soul.update"];
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SoulDetailPage />
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByRole("tab", { name: /souls.detail.profile.tab_records/ }));
    await waitFor(() => expect(soulsApi.karma).toHaveBeenCalled());
    await screen.findByRole("tab", { name: /souls.detail.profile.tab_records/, selected: true });
    expect(screen.queryByTestId("record-add")).not.toBeInTheDocument();
    unmount();

    mockUser.permissions = ["soul.read", "ledger.manage"];
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /souls.detail.profile.tab_records/ }));
    expect(await screen.findByTestId("record-add")).toBeInTheDocument();
    } finally {
      soulsApi.karma.mockResolvedValue({ data: null });
    }
  });

  it("不再是页头上的独立按钮", async () => {
    renderPage();
    await screen.findByRole("button", { name: "更多操作" });
    expect(screen.queryByRole("button", { name: "souls.detail.recalculate" })).not.toBeInTheDocument();
  });
});
