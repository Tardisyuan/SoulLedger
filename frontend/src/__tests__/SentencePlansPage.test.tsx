/**
 * app/sentence-plans/page.tsx —「受刑计划」列表(审计 2026-10-17 第 8 条)。
 *
 * 筛选只发服务端认的参数(状态 / awaiting_redispatch / pending_request / search);首页那一格带来的
 * `?awaiting_redispatch=true` 一进来就按下;行上是翻译过的状态词,不是枚举成员。
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SentencePlansPage from "@/app/sentence-plans/page";
import { tZh, zh } from "./support/zhBundle";

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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<SentencePlansPage />, { wrapper: Wrapper });
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
    expect(screen.getByRole("button", { name: new RegExp(zh("sentence_plan.filter.awaiting_redispatch")) })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("sends the server's own filter names, and 清除全部 drops them all", async () => {
    renderPage();
    await screen.findByRole("link", { name: "周阿满" });
    fireEvent.change(screen.getByTestId("sentence-plan-search"), { target: { value: "阿满" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(zh("sentence_plan.filter.pending_request")) }));
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith({ page: 1, search: "阿满", pending_request: true })
    );
    fireEvent.click(screen.getByRole("button", { name: zh("filter.clear_all") }));
    await waitFor(() => expect(mockedList).toHaveBeenLastCalledWith({ page: 1 }));
  });

  it("says so when nothing matches", async () => {
    mockedList.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    renderPage();
    expect(await screen.findByText(zh("sentence_plan.list_empty"))).toBeInTheDocument();
  });
});
