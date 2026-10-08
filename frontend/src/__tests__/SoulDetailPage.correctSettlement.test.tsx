/**
 * 「更正结案」在灵魂详情页的门:后端按码名 `soul.correct_settlement`(默认只有 ADMIN)+ 只收 SETTLED。
 * 页面两条都满足才把这一项交给 ⋯ 菜单 —— 不满足就连菜单项都没有,而不是点了再吃 400 / 403。
 * 成功后页面重取灵魂(`soulsApi.get` 再被调用一次)。
 *
 * 身份走 `useTenant` 的桩(真门跑起来),不桩 `RequirePermission`(suiteShape 禁止)。
 */
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulDetailPage from "@/app/souls/[id]/page";
import { makeTranslateWithFallback } from "@/src/contexts/I18nContext";

const SOUL_ID = "soul-1";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: SOUL_ID }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

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

// 可变身份:默认 ADMIN;非 ADMIN 那条换成持 soul.delete(能看见 ⋯)但不持 soul.correct_settlement 的判官。
const mockUser: { role: string; permissions: string[] } = { role: "ADMIN", permissions: [] };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "u", tenant: null, ...mockUser }, tenantCode: null }),
}));

jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazySoulLineChart: () => null,
  LazyLifespanBarChart: () => null,
}));
jest.mock("@/src/components/souls/SoulEditModal", () => ({ SoulEditModal: () => null }));
jest.mock("@soulledger/core/api/ledger", () => ({
  ...jest.requireActual("@soulledger/core/api/ledger"),
  ledgerApi: { inheritance: jest.fn().mockRejectedValue({ response: { status: 409 } }) },
}));

const mockSoulsGet = jest.fn();
const mockCorrect = jest.fn();
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  soulsApi: {
    get: (...args: unknown[]) => mockSoulsGet(...args),
    correctSettlement: (...args: unknown[]) => mockCorrect(...args),
    karma: jest.fn().mockResolvedValue({ data: null }),
    records: jest.fn().mockResolvedValue({ data: [] }),
  },
  judgmentApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  dispositionApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  reincarnationApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }), reborn: jest.fn() },
  eventsApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
}));

const soul = (current_state: string) => ({
  id: SOUL_ID,
  name: "Test Soul",
  civilization: "CHINESE",
  current_state,
  birth_date: null,
  death_date: null,
  birth_name: null,
  origin_location: null,
  date_problems: [],
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SoulDetailPage />
    </QueryClientProvider>
  );
}

const openMenu = async () => {
  const trigger = await screen.findByRole("button", { name: "更多操作" });
  await act(async () => {
    fireEvent.click(trigger);
  });
};
const correctItem = () => screen.queryByRole("menuitem", { name: "souls.detail.correct_settlement.action" });

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.role = "ADMIN";
  mockUser.permissions = [];
  mockSoulsGet.mockResolvedValue({ data: soul("SETTLED") });
});

describe("SoulDetailPage — 更正结案的门", () => {
  it("ADMIN + SETTLED:菜单里有这一项;提交原因后调用 API 并重取灵魂", async () => {
    mockCorrect.mockResolvedValue({ data: soul("DISPOSED") });
    renderPage();
    await openMenu();
    expect(correctItem()).toBeInTheDocument();
    const getsBefore = mockSoulsGet.mock.calls.length;

    fireEvent.click(correctItem()!);
    const reason = await screen.findByLabelText(/souls\.detail\.correct_settlement\.reason/);
    fireEvent.change(reason, { target: { value: "录错了" } });
    fireEvent.click(screen.getByRole("button", { name: "souls.detail.correct_settlement.confirm" }));

    await waitFor(() => expect(mockCorrect).toHaveBeenCalledWith(SOUL_ID, "录错了"));
    await waitFor(() => expect(mockSoulsGet.mock.calls.length).toBeGreaterThan(getsBefore));
  });

  it("ADMIN + 不是 SETTLED:没有这一项", async () => {
    mockSoulsGet.mockResolvedValue({ data: soul("DISPOSED") });
    renderPage();
    await openMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(correctItem()).not.toBeInTheDocument();
  });

  it("非 ADMIN(持 soul.delete、不持 soul.correct_settlement)+ SETTLED:能开菜单,但没有这一项", async () => {
    mockUser.role = "JUDGE";
    mockUser.permissions = ["soul.read", "soul.update", "soul.delete"];
    renderPage();
    await openMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(correctItem()).not.toBeInTheDocument();
  });

  it("非 ADMIN 但被授予了 soul.correct_settlement 码名:与后端一致,有这一项", async () => {
    mockUser.role = "JUDGE";
    mockUser.permissions = ["soul.read", "soul.delete", "soul.correct_settlement"];
    renderPage();
    await openMenu();
    expect(correctItem()).toBeInTheDocument();
  });
});
