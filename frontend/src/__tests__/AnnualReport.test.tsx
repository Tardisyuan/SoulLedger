/**
 * 冥界年报(v4 第八批 S14):数全部来自 `GET /judgment/annual/`;导语按看的人分「本殿」与「四个冥界」;
 * 退回率比上一年少 / 多;「上一年」按钮换年取数。失败说加载失败,不画一页 0。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { AnnualReport } from "@/src/components/dashboard/AnnualReport";

let mockUser: Record<string, unknown> = { id: 7, tenant: { code: "CN_DIYU" } };

jest.mock("@soulledger/core/api", () => ({ judgmentApi: { annual: jest.fn() } }));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => jest.requireActual("./support/zhBundle").tZh(key, params),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const annual = judgmentApi.annual as jest.Mock;

const REPORT = {
  timezone: "Asia/Shanghai",
  year: 2026,
  received: 1284,
  placed: 1197,
  by_civ: [
    { civilization: "CHINESE", received: 612 },
    { civilization: "EGYPTIAN", received: 231 },
  ],
  concluded: 1200,
  avg_days: 3.1,
  longest: { case_number: "EG-2026-0193", soul_name: "Nebamun", days: 41 },
  most_cited: { code: "EG-NC-27", corpus: "NEGATIVE_CONFESSION", ordinal: 27, corpus_size: 42, display_title: "我未曾使人哭泣", citations: 30 },
  returned: 49,
  returned_pct: 4.1,
  last_year_returned_pct: 5.4,
  monthly: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
  last_year_monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnnualReport />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 7, tenant: { code: "CN_DIYU" } };
  annual.mockResolvedValue({ data: REPORT });
});

it("总数、有了去处、各文明、最久的一件、引用最多的条文、退回率,都来自 annual", async () => {
  const { container } = renderIt();
  const lead = await waitFor(() => {
    const el = container.querySelector("[data-annual-lead]") as HTMLElement;
    expect(el).not.toBeNull();
    return el;
  });
  expect(annual).toHaveBeenCalledWith(undefined);
  // 一殿的官员:「本殿」,不说「四个冥界」。
  expect(lead).toHaveTextContent("这一年，本殿一共收了");
  expect(lead).not.toHaveTextContent("四个冥界");
  expect(container.querySelector("[data-annual-received]")).toHaveTextContent(/^1284$/);
  expect(container.querySelector("[data-annual-received]")).toHaveClass("text-display-xl");
  expect(container.querySelector("[data-annual-placed]")).toHaveTextContent(/^1197$/);
  expect(lead).toHaveTextContent("个灵魂。其中 1197 个已经有了去处。");
  // 只列有数的文明,按后端给的顺序。
  const civs = [...container.querySelectorAll("[data-annual-civ]")].map((el) => el.getAttribute("data-annual-civ"));
  expect(civs).toEqual(["CHINESE", "EGYPTIAN"]);
  expect(container.querySelector('[data-annual-civ="CHINESE"]')).toHaveTextContent("612");

  const fact = (id: string) => container.querySelector(`[data-annual-fact="${id}"]`) as HTMLElement;
  expect(fact("longest")).toHaveTextContent("41 天");
  expect(fact("longest")).toHaveTextContent("EG-2026-0193");
  expect(fact("longest")).toHaveTextContent("Nebamun");
  expect(fact("most-cited")).toHaveTextContent("§ 27 / 42");
  expect(fact("most-cited")).toHaveTextContent("我未曾使人哭泣");
  expect(fact("most-cited")).not.toHaveTextContent("NEGATIVE_CONFESSION");
  expect(fact("returned")).toHaveTextContent("4.1%");
  expect(fact("returned")).toHaveTextContent("比上一年少 1.3 个百分点");
  // 演示站以外不写「演示站录制数据」。
  expect(container.querySelector("[data-annual-year]")).toHaveTextContent(/^2026$/);
});

it("跨殿的管理员用定稿的「四个冥界」;退回率比上一年高说「多」", async () => {
  mockUser = { id: 1, tenant: null };
  annual.mockResolvedValue({ data: { ...REPORT, returned_pct: 6.0, last_year_returned_pct: 4.5 } });
  const { container } = renderIt();
  await waitFor(() => expect(container.querySelector("[data-annual-lead]")).toHaveTextContent("这一年，四个冥界一共收了"));
  expect(container.querySelector('[data-annual-fact="returned"]')).toHaveTextContent("比上一年多 1.5 个百分点");
});

it("每月:本年实线、上一年虚线,各 12 个点", async () => {
  const { container } = renderIt();
  const current = await waitFor(() => {
    const el = container.querySelector('[data-annual-monthly] polyline[data-series="current"]');
    expect(el).not.toBeNull();
    return el!;
  });
  const previous = container.querySelector('[data-annual-monthly] polyline[data-series="previous"]')!;
  expect(current.getAttribute("points")!.split(" ")).toHaveLength(12);
  expect(previous.getAttribute("points")!.split(" ")).toHaveLength(12);
  expect(previous.getAttribute("stroke-dasharray")).toBeTruthy();
  expect(current.getAttribute("stroke-dasharray")).toBeNull();
});

it("「上一年」换年取数;「本年」回到今年", async () => {
  annual.mockImplementation(async (year?: number) => ({ data: { ...REPORT, year: year ?? 2026 } }));
  const { container } = renderIt();
  const year = () => container.querySelector("[data-annual-year]");
  await waitFor(() => expect(year()).toHaveTextContent(/^2026$/));
  expect(screen.queryByRole("button", { name: "本年" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "上一年" }));
  await waitFor(() => expect(year()).toHaveTextContent(/^2025$/));
  expect(annual).toHaveBeenLastCalledWith(2025);
  fireEvent.click(screen.getByRole("button", { name: "本年" }));
  await waitFor(() => expect(year()).toHaveTextContent(/^2026$/));
});

it("取失败:说加载失败,不画一页 0", async () => {
  annual.mockRejectedValue(new Error("boom"));
  const { container } = renderIt();
  expect(await screen.findByRole("alert")).toHaveTextContent("加载");
  expect(container.querySelector("[data-annual-received]")).toBeNull();
});
