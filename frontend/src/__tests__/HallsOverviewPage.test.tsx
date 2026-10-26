/**
 * 各殿概况(第五十四批 O-1/O-2):一殿一行,只有数;0 的待办项不写;埃及不轮回写「不适用」;
 * 每一格都只读进入那一殿再跳到对应页;加载失败与空态是两句不同的话;两种排序。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tenantsApi, type HallOverviewRow } from "@soulledger/core/api";
import HallsOverviewPage from "@/app/halls/page";
import { sortHalls } from "@/src/lib/hallsOverview";

const mockEnterHall = jest.fn();
const mockShowToast = jest.fn();
jest.mock("@/src/components/impersonation/wireImpersonation", () => ({
  enterHall: (...args: unknown[]) => mockEnterHall(...args),
}));
jest.mock("@/src/components/ui/Toast", () => ({ showToast: (...args: unknown[]) => mockShowToast(...args) }));
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  tenantsApi: { overview: jest.fn() },
}));
jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const overview = tenantsApi.overview as jest.Mock;

const row = (over: Partial<HallOverviewRow> = {}): HallOverviewRow => ({
  code: "CN_DIYU",
  hall_names: { "zh-Hans": "酆都第十殿", en: "Tenth Court" },
  civilization: "CHINESE",
  is_active: true,
  todo: { approvals: 3, dispatch_proposals: 0, cooldowns: 2, letters_awaiting: 3, total: 8 },
  judgments: { at_city_god: 5, held: 2, claimed: 14, unclaimed: 6 },
  rebirth_quota: [
    { rebirth_form: "DIVINE", limit: 20, used: 18 },
    { rebirth_form: "HUMAN", limit: 20, used: 20 },
    { rebirth_form: "ANIMAL", limit: null, used: 4 },
    { rebirth_form: "HUNGRY_GHOST", limit: null, used: 0 },
  ],
  open_appeals: 4,
  ...over,
});
const duat = row({
  code: "EG_DUAT",
  hall_names: { "zh-Hans": "真理之厅" },
  civilization: "EGYPTIAN",
  todo: { approvals: 2, dispatch_proposals: 0, cooldowns: 0, letters_awaiting: 0, total: 2 },
  judgments: { at_city_god: 0, held: 0, claimed: 3, unclaimed: 9 },
  rebirth_quota: [],
  open_appeals: 0,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HallsOverviewPage />
    </QueryClientProvider>
  );
}

const rowOf = (code: string) => screen.getByText(code).closest("tr") as HTMLElement;

beforeEach(() => jest.clearAllMocks());

describe("各殿概况", () => {
  it("一殿一行:名字用当前语言的殿名、代号作副标;待办拆项不写 0;满了的道加「已满」;埃及写不适用", async () => {
    overview.mockResolvedValue({ data: [row(), duat] });
    renderPage();
    const diyu = await waitFor(() => rowOf("CN_DIYU"));
    expect(within(diyu).getByText("酆都第十殿")).toBeInTheDocument();
    expect(within(diyu).queryByText("Tenth Court")).toBeNull();
    const parts = within(diyu).getByTestId("todo-parts");
    expect(parts).toHaveTextContent("halls.overview.todo_approvals(3)");
    expect(parts).toHaveTextContent("halls.overview.todo_letters(3)");
    expect(parts).not.toHaveTextContent("todo_dispatch");
    expect(within(diyu).getByText("rebirths.quota.full_badge").closest("[data-quota-form]")).toHaveAttribute("data-quota-form", "HUMAN");
    // 不限且本月没办过的道不写
    expect(diyu.querySelector('[data-quota-form="HUNGRY_GHOST"]')).toBeNull();
    expect(within(rowOf("EG_DUAT")).getByText("common.value.inapplicable")).toBeInTheDocument();
    expect(within(rowOf("EG_DUAT")).queryByTestId("todo-parts")).toHaveTextContent("halls.overview.todo_approvals(2)");
  });

  it("分段条四格宽度按件数,互不相交", async () => {
    overview.mockResolvedValue({ data: [row()] });
    renderPage();
    const diyu = await waitFor(() => rowOf("CN_DIYU"));
    const width = (k: string) => (diyu.querySelector(`[data-segment="${k}"]`) as HTMLElement).style.width;
    expect(width("claimed")).toBe(`${(14 / 27) * 100}%`);
    expect(width("unclaimed")).toBe(`${(6 / 27) * 100}%`);
  });

  it("点任何一格都先只读进入那一殿,再到对应页", async () => {
    overview.mockResolvedValue({ data: [row(), duat] });
    mockEnterHall.mockResolvedValue(undefined);
    renderPage();
    const diyu = await waitFor(() => rowOf("CN_DIYU"));
    fireEvent.click(within(diyu).getByRole("button", { name: "halls.overview.enter_label(酆都第十殿)" }));
    await waitFor(() => expect(mockEnterHall).toHaveBeenCalledWith("CN_DIYU", "/dashboard"));
    fireEvent.click(within(rowOf("EG_DUAT")).getByRole("button", { name: /judgments_label/ }));
    await waitFor(() => expect(mockEnterHall).toHaveBeenLastCalledWith("EG_DUAT", "/judgment"));
  });

  it("进不去时提示,不跳", async () => {
    overview.mockResolvedValue({ data: [row()] });
    mockEnterHall.mockRejectedValue(new Error("403"));
    renderPage();
    const diyu = await waitFor(() => rowOf("CN_DIYU"));
    fireEvent.click(within(diyu).getByRole("button", { name: "halls.overview.enter_label(酆都第十殿)" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("halls.overview.enter_failed", "error"));
  });

  it("加载失败与没有殿是两句不同的话", async () => {
    overview.mockRejectedValue(new Error("500"));
    renderPage();
    expect(await screen.findByText("halls.overview.load_failed")).toBeInTheDocument();
    expect(screen.queryByText("halls.overview.empty")).toBeNull();
  });

  it("空态", async () => {
    overview.mockResolvedValue({ data: [] });
    renderPage();
    expect(await screen.findByText("halls.overview.empty")).toBeInTheDocument();
    expect(screen.queryByText("halls.overview.load_failed")).toBeNull();
  });
});

describe("sortHalls", () => {
  const a = row({ code: "A", todo: { ...row().todo, total: 1 }, judgments: { ...row().judgments, unclaimed: 9 } });
  const b = row({ code: "B", todo: { ...row().todo, total: 5 }, judgments: { ...row().judgments, unclaimed: 0 } });
  const c = row({ code: "C", todo: { ...row().todo, total: 5 }, judgments: { ...row().judgments, unclaimed: 3 } });

  it("默认按代号;待办多的在前,同数再按无人认领", () => {
    expect(sortHalls([c, a, b], "code").map((r) => r.code)).toEqual(["A", "B", "C"]);
    expect(sortHalls([a, b, c], "todo").map((r) => r.code)).toEqual(["C", "B", "A"]);
  });
});
