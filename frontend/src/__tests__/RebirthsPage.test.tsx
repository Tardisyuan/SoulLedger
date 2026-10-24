/**
 * app/rebirths/page.tsx —「转生登记簿」(第四十批 W-c)。
 *
 * 只发后端已有的筛选(`rebirth_form` 单值、`cycle_count`);「第几世」写「第 n → n+1 世」;
 * 行链到灵魂详情上这一次转生的锚点;没开过号的灵魂不印编号。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RebirthsPage from "@/app/rebirths/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  reincarnationApi: { list: jest.fn(), quota: jest.fn() },
  menusApi: {
    all: jest.fn().mockResolvedValue({ data: [] }),
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));
const mockedApi = (jest.requireMock("@soulledger/core/api") as { reincarnationApi: { list: jest.Mock; quota: jest.Mock } }).reincarnationApi;
const mockedList = mockedApi.list;
const mockedQuota = mockedApi.quota;

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ isAdmin: false, tenantCode: "CN_DIYU", user: { role: "JUDGE", permissions: ["reincarnation.read"] } }),
}));
jest.mock("@/src/contexts/I18nContext", () => {
  const { tZh: t } = jest.requireActual("./support/zhBundle");
  return {
    useI18n: () => ({
      t,
      tf: (key: string, fallback: string) => (t(key) === key ? fallback : t(key)),
      formatDateTime: (v: string) => `dt(${v})`,
      formatDate: (v: string) => v,
      locale: "zh-Hans",
      hydrated: true,
    }),
  };
});

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  soul: "soul-1",
  soul_name: "周阿满",
  soul_code: null,
  disposition: null,
  target_realm: "CN_HUMAN_HUZHOU",
  rebirth_form: "HUMAN",
  cycle_count: 3,
  previous_realm: "",
  new_identity: "",
  notes: "",
  reincarnated_at: "2026-10-16T11:20:00Z",
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<RebirthsPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  mockedList.mockReset();
  mockedList.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [row()] } });
  mockedQuota.mockReset();
  mockedQuota.mockResolvedValue({ data: [] });
});

describe("本月配额 (第五十一批 Q-2)", () => {
  it("七格:满了的加「已满」并换 ink 框,不限的写「已办 · 不限」,0 上限算满", async () => {
    mockedQuota.mockResolvedValue({
      data: [
        { rebirth_form: "DIVINE", limit: 20, used: 20 },
        { rebirth_form: "HUMAN", limit: null, used: 412 },
        { rebirth_form: "HUNGRY_GHOST", limit: 40, used: 31 },
        { rebirth_form: "HELL_BEING", limit: 0, used: 0 },
      ],
    });
    renderPage();
    const strip = await screen.findByTestId("rebirth-quota-strip");
    const cells = [...strip.querySelectorAll("[data-quota-cell]")];
    expect(cells.map((c) => c.getAttribute("data-quota-cell"))).toEqual(["DIVINE", "HUMAN", "ASURA", "ANIMAL", "HUNGRY_GHOST", "HELL_BEING", "OTHER"]);
    const cell = (form: string) => strip.querySelector(`[data-quota-cell="${form}"]`) as HTMLElement;
    expect(cell("DIVINE")).toHaveAttribute("data-full", "true");
    expect(cell("DIVINE")).toHaveTextContent(tZh("rebirths.quota.full_badge"));
    expect(cell("HELL_BEING")).toHaveAttribute("data-full", "true");
    expect(cell("HUMAN")).toHaveTextContent(tZh("rebirths.quota.used_unlimited", { used: "412" }));
    expect(cell("HUMAN")).not.toHaveAttribute("data-full");
    expect(cell("HUNGRY_GHOST")).toHaveTextContent(tZh("rebirths.quota.used_of", { used: "31", limit: "40" }));
    expect(cell("HUNGRY_GHOST")).not.toHaveTextContent(tZh("rebirths.quota.full_badge"));
  });

  it("配额没拿到时不画这一行,表格照常", async () => {
    mockedQuota.mockRejectedValue(new Error("boom"));
    renderPage();
    await screen.findByRole("link", { name: "周阿满" });
    expect(screen.queryByTestId("rebirth-quota-strip")).toBeNull();
  });
});

describe("转生登记簿", () => {
  it("一行:名字链到这一次转生的锚点,第几世写成 3 → 4,形态是译名", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: "周阿满" });
    expect(link).toHaveAttribute("href", "/souls/soul-1#reincarnation-r1");
    expect(screen.getByText(tZh("rebirths.life_value", { from: "3", to: "4" }))).toBeInTheDocument();
    expect(screen.getByText(tZh("reincarnation.forms.HUMAN"), { selector: "td, td *" })).toBeInTheDocument(); // 筛选下拉里也有这个词
    expect(screen.queryByText("HUMAN")).toBeNull();
    expect(screen.getByText(tZh("rebirths.total", { n: "1" }))).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledWith({ page: "1" });
  });

  it("有编号才印编号", async () => {
    mockedList.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [row({ soul_code: "S01703320" })] } });
    renderPage();
    await screen.findByRole("link", { name: "周阿满" });
    expect(screen.getByText(/S0/)).toBeInTheDocument();
  });

  it("筛选只发 rebirth_form 与 cycle_count;不是正整数的第几世不发", async () => {
    renderPage();
    await screen.findByRole("link", { name: "周阿满" });
    fireEvent.change(screen.getByRole("combobox", { name: tZh("rebirths.col_form") }), { target: { value: "ANIMAL" } });
    await waitFor(() => expect(mockedList).toHaveBeenLastCalledWith({ page: "1", rebirth_form: "ANIMAL" }));
    fireEvent.change(screen.getByTestId("rebirths-life"), { target: { value: "0" } });
    await waitFor(() => expect(mockedList).toHaveBeenLastCalledWith({ page: "1", rebirth_form: "ANIMAL" }));
    fireEvent.change(screen.getByTestId("rebirths-life"), { target: { value: "3" } });
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith({ page: "1", rebirth_form: "ANIMAL", cycle_count: "3" }),
    );
  });

  it("没有记录时说还没有", async () => {
    mockedList.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    renderPage();
    expect(await screen.findByText(tZh("rebirths.empty"))).toBeInTheDocument();
  });
});
