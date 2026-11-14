/**
 * app/sentence-plans/page.tsx —「受刑计划」列表(审计 2026-10-17 第 8 条)。
 *
 * 筛选只发服务端认的参数(状态 / awaiting_redispatch / pending_request / search);首页那一格带来的
 * `?awaiting_redispatch=true` 一进来就按下;行上是翻译过的状态词,不是枚举成员。
 */
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import SentencePlansPage from "@/app/sentence-plans/page";
import { tZh, zh } from "./support/zhBundle";
import { renderWithProviders } from "./support/render";

let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({ useSearchParams: () => mockSearch }));

jest.mock("@soulledger/core/api/sentence-plans", () => ({ sentencePlansApi: { list: jest.fn() } }));
const mockedList = (jest.requireMock("@soulledger/core/api/sentence-plans") as { sentencePlansApi: { list: jest.Mock } })
  .sentencePlansApi.list;

jest.mock("@soulledger/core/api", () => ({
  menusApi: {
    all: jest.fn().mockResolvedValue({ data: [] }),
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ isAdmin: false, tenantCode: "CN_DIYU", user: { role: "JUDGE", permissions: ["judgment.read"] } }),
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

const plan = {
  id: "p1",
  soul: "soul-1",
  soul_name: "周阿满",
  tenant: 1,
  tenant_code: "CN_DIYU",
  cycle: 2,
  status: "ACTIVE",
  nodes: [
    { id: "n1", order: 1, tenant_code: "CN_DIYU", is_home: true, status: "COMPLETED" },
    { id: "n2", order: 2, tenant_code: "EU_HELL", is_home: false, status: "ACTIVE" },
  ],
  requests: [],
  create_time: "2026-10-17T06:10:00Z",
};

// jsdom 不跑媒体查询:FilterBar 的桌面一行与窄屏一行都在 DOM 里,开关各画一份。按容器查。
const wide = () => document.querySelector("[data-filter-bar-wide]") as HTMLElement;
const narrow = () => document.querySelector("[data-filter-bar-narrow]") as HTMLElement;

function renderPage() {
  return renderWithProviders(<SentencePlansPage />, { i18n: false });
}

beforeEach(() => {
  mockSearch = new URLSearchParams();
  mockedList.mockReset().mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [plan] } });
});

describe("SentencePlansPage", () => {
  it("lists plans with the soul link, translated states and the current stop", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: "周阿满" });
    expect(link).toHaveAttribute("href", "/souls/soul-1");
    expect(screen.getAllByText(zh("sentence_plan.plan_states.ACTIVE")).length).toBeGreaterThan(0);
    expect(screen.getByText(tZh("sentence_plan.stop", { order: "2" }))).toBeInTheDocument();
    expect(screen.getByText(zh("sentence_plan.node_states.ACTIVE"))).toBeInTheDocument();
    // 原样的枚举成员不出现在行上;只问第一页,不带任何筛选。
    expect(screen.queryByText("ACTIVE")).not.toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledWith({ page: 1 });
  });

  it("arrives with 待重发的调拨 pressed when the dashboard cell sent it", async () => {
    mockSearch = new URLSearchParams("awaiting_redispatch=true");
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalledWith({ page: 1, awaiting_redispatch: true }));
    expect(within(wide()).getByRole("button", { name: new RegExp(zh("sentence_plan.filter.awaiting_redispatch")) })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("sends the server's own filter names, and 清除全部 drops them all", async () => {
    renderPage();
    await screen.findByRole("link", { name: "周阿满" });
    fireEvent.change(screen.getByTestId("sentence-plan-search"), { target: { value: "阿满" } });
    fireEvent.click(within(wide()).getByRole("button", { name: new RegExp(zh("sentence_plan.filter.pending_request")) }));
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith({ page: 1, search: "阿满", pending_request: true })
    );
    fireEvent.click(screen.getByRole("button", { name: zh("filter.clear_all") }));
    await waitFor(() => expect(mockedList).toHaveBeenLastCalledWith({ page: 1 }));
  });

  // 用户 2026-11-14:筛选走共享的 FilterBar。桌面一行不折行;393 是「筛选 · N」+ 两个开关的快捷 chip,状态在抽屉里。
  it("draws the filters as one unwrapped row on desktop, and on a phone a 筛选 · N trigger with the two toggles as chips", async () => {
    mockSearch = new URLSearchParams("awaiting_redispatch=true");
    renderPage();
    await screen.findByRole("link", { name: "周阿满" });
    expect(wide().className).not.toMatch(/\bflex-wrap\b/);
    expect(wide().className).toMatch(/\bflex-nowrap\b/);
    expect(within(wide()).getByRole("combobox", { name: zh("sentence_plan.filter.status") })).toBeInTheDocument();
    expect(within(wide()).getByTestId("sentence-plan-search")).toBeInTheDocument();
    // 窄屏:状态下拉不在第一行;两个开关是快捷 chip;已按下的那个算进 N。
    expect(within(narrow()).queryByRole("combobox")).toBeNull();
    expect(within(narrow()).getByTestId("sentence-plan-search-narrow")).toBeInTheDocument();
    expect(within(narrow()).getByRole("button", { name: tZh("filter.bar.open_n", { n: "1" }) })).toBeInTheDocument();
    expect(within(narrow()).getByRole("button", { name: zh("sentence_plan.filter.awaiting_redispatch"), pressed: true })).toBeInTheDocument();
    expect(within(narrow()).getByRole("button", { name: zh("sentence_plan.filter.pending_request"), pressed: false })).toBeInTheDocument();
  });

  it("shows 已隐藏 when the Soul field rules withhold the soul's name (the key is absent, P-11)", async () => {
    const { soul_name: _withheld, ...ruled } = plan;
    mockedList.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [ruled] } });
    renderPage();
    const link = await screen.findByRole("link", { name: `${zh("common.value.unrecorded")} — ${zh("souls.field_withheld")}` });
    expect(link).toHaveAttribute("href", "/souls/soul-1");
    expect(screen.queryByText("周阿满")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    mockedList.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    renderPage();
    expect(await screen.findByText(zh("sentence_plan.list_empty"))).toBeInTheDocument();
  });
});
