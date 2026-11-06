/**
 * v4 概览的三张卡(第七批 S04):主卡的读数来自 hall-stats、趋势卡的十字线与提示、待经手的三类行、认领下一件。
 * 失败不说「已清空」(errorIsNotAnEmptyState 同一条约定)。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { crossTenantJudgmentsApi, judgmentApi, judgmentAppealsApi } from "@soulledger/core/api";
import { HallOverview } from "@/src/components/dashboard/HallOverview";

const mockPush = jest.fn();
const mockShowToast = jest.fn();
let mockPerms: string[] = ["judgment.read", "cross_judgment.read"];

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { hallStats: jest.fn(), list: jest.fn(), next: jest.fn(), claim: jest.fn() },
  judgmentAppealsApi: { list: jest.fn() },
  crossTenantJudgmentsApi: { list: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => jest.requireActual("./support/zhBundle").tZh(key, params),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 7, username: "cui", display_name: "崔判官" } }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: (p: string) => mockPerms.includes(p) }),
}));

const hallStats = judgmentApi.hallStats as jest.Mock;
const list = judgmentApi.list as jest.Mock;
const next = judgmentApi.next as jest.Mock;
const claim = judgmentApi.claim as jest.Mock;
const appeals = judgmentAppealsApi.list as jest.Mock;
const joint = crossTenantJudgmentsApi.list as jest.Mock;

const weeks = Array.from({ length: 12 }, (_, i) => ({
  week_start: `2026-${String(8 + Math.floor(i / 4)).padStart(2, "0")}-${String(1 + (i % 4) * 7).padStart(2, "0")}`,
  concluded: 20 + i,
  previous_quarter: 10 + i,
}));
const STATS = {
  timezone: "Asia/Shanghai",
  pending: 24,
  overdue: 3,
  concluded_this_month: 138,
  month_done_pct: 62,
  avg_days: 2.4,
  returned_this_month: 4,
  weeks,
};
const page = <T,>(results: T[]) => ({ data: { count: results.length, results } });

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HallOverview />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPerms = ["judgment.read", "cross_judgment.read"];
  hallStats.mockResolvedValue({ data: STATS });
  list.mockResolvedValue(
    page([
      { id: "j1", case_number: "DY-2026-0391", deadline_remaining_seconds: 3600 },
      { id: "j2", case_number: "DY-2026-0392", deadline_remaining_seconds: 2 * 86_400 + 60 },
      { id: "j3", case_number: "DY-2026-0393", deadline_remaining_seconds: -86_400 - 60 },
    ]),
  );
  appeals.mockResolvedValue(page([{ id: "a1", soul_name: "赵小满", deadline: "2026-12-01T00:00:00Z" }]));
  joint.mockResolvedValue(page([{ id: "c1", initiating_tenant_display_name: "欧洲米诺斯庭" }]));
});

describe("主卡", () => {
  it("今日待审、过期限、本月已结、三个读数,都来自 hall-stats", async () => {
    renderIt();
    const hero = await waitFor(() => {
      const el = document.querySelector("[data-overview-hero]") as HTMLElement;
      expect(within(el).getByText("24")).toBeInTheDocument();
      return el;
    });
    expect(hero).toHaveTextContent("崔判官 · 今日待审");
    expect(hero).toHaveTextContent("件 · 其中 3 件已过期限");
    expect(hero).toHaveTextContent("本月已结 62%");
    expect(hero).toHaveTextContent("138");
    expect(hero).toHaveTextContent("2.4 日");
    expect(hero).toHaveTextContent("退回重审");
    expect(hero.querySelector("[data-done-ring]")).not.toBeNull();
  });

  it("本月既没结也没待审:不写百分比,不画进度环", async () => {
    hallStats.mockResolvedValue({ data: { ...STATS, pending: 0, concluded_this_month: 0, month_done_pct: null, avg_days: null } });
    renderIt();
    const hero = await waitFor(() => {
      const el = document.querySelector("[data-overview-hero]") as HTMLElement;
      expect(el).toHaveTextContent("件 · 其中 3 件已过期限");
      return el;
    });
    expect(hero).not.toHaveTextContent("本月已结 %");
    expect(hero.querySelector("[data-done-ring]")).toBeNull();
  });

  it("认领下一件:别人的不认领就进不去 —— 先认领再进审判台", async () => {
    next.mockResolvedValue({ data: { judgment: { id: "j9", claimed_by: 3 } } });
    claim.mockResolvedValue({ data: {} });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "认领下一件" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/judgment/j9"));
    expect(claim).toHaveBeenCalledWith("j9");
  });

  it("认领下一件:已是自己的不再认领;队列空了只说一句,不跳转", async () => {
    next.mockResolvedValueOnce({ data: { judgment: { id: "j8", claimed_by: 7 } } });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "认领下一件" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/judgment/j8"));
    expect(claim).not.toHaveBeenCalled();

    next.mockResolvedValueOnce({ data: { judgment: null } });
    mockPush.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "认领下一件" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("队列已清空。新的案子到了会出现在这里。", "info"));
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("近 12 周结案", () => {
  it("本周与上季同期取最后一周;十字线默认停在本周,左右键移一周", async () => {
    renderIt();
    const card = await waitFor(() => {
      const el = document.querySelector("[data-overview-trend]") as HTMLElement;
      expect(el.querySelector("[data-trend-tip]")).not.toBeNull();
      return el;
    });
    expect(card).toHaveTextContent("本周31");
    expect(card).toHaveTextContent("上季同期21");
    const tip = card.querySelector("[data-trend-tip]") as HTMLElement;
    expect(tip).toHaveTextContent(`第 12 周 · ${weeks[11].week_start.slice(5)}`);
    expect(tip).toHaveTextContent("本季 31");
    expect(tip).toHaveTextContent("上季 21");
    fireEvent.keyDown(within(card).getByRole("slider"), { key: "ArrowLeft" });
    expect(tip).toHaveTextContent(`第 11 周 · ${weeks[10].week_start.slice(5)}`);
    expect(tip).toHaveTextContent("本季 30");
  });

  it("本季实线、上季虚线,线宽一样", async () => {
    renderIt();
    const current = await waitFor(() => {
      const el = document.querySelector('[data-series="current"]');
      expect(el).not.toBeNull();
      return el as SVGElement;
    });
    const previous = document.querySelector('[data-series="previous"]') as SVGElement;
    expect(current.getAttribute("stroke-dasharray")).toBeNull();
    expect(previous.getAttribute("stroke-dasharray")).toBe("4 4");
    expect(current.getAttribute("stroke-width")).toBe(previous.getAttribute("stroke-width"));
  });
});

describe("待经手", () => {
  it("退回重审带期限;申诉右栏空着(它的 deadline 是申诉期);会审邀请写待回复", async () => {
    renderIt();
    const card = await waitFor(() => {
      const el = document.querySelector("[data-overview-todo]") as HTMLElement;
      expect(el).toHaveTextContent("退回重审 · DY-2026-0391");
      return el;
    });
    const rows = within(card).getAllByRole("link");
    expect(rows.map((r) => r.textContent)).toEqual([
      "◆退回重审 · DY-2026-0391今天到期",
      "◆退回重审 · DY-2026-03922 日后到期",
      "◆退回重审 · DY-2026-0393超 2 日",
      "◆申诉 · 赵小满",
      "◆会审邀请 · 欧洲米诺斯庭待回复",
    ]);
    expect(rows[3]).toHaveAttribute("href", "/judgment/appeals/a1");
    expect(rows[4]).toHaveAttribute("href", "/cross-judgments/c1");
  });

  it("没有会审权限不取、不画会审邀请", async () => {
    mockPerms = ["judgment.read"];
    renderIt();
    const card = await waitFor(() => {
      const el = document.querySelector("[data-overview-todo]") as HTMLElement;
      expect(el).toHaveTextContent("申诉 · 赵小满");
      return el;
    });
    expect(joint).not.toHaveBeenCalled();
    expect(card).not.toHaveTextContent("会审邀请");
  });

  it("一样都没有:已清空;取失败:说加载失败,不说已清空", async () => {
    list.mockResolvedValue(page([]));
    appeals.mockResolvedValue(page([]));
    joint.mockResolvedValue(page([]));
    const { unmount } = renderIt();
    expect(await screen.findByText("已清空")).toBeInTheDocument();
    unmount();

    appeals.mockRejectedValue(new Error("boom"));
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent("加载失败");
    expect(screen.queryByText("已清空")).toBeNull();
  });
});
