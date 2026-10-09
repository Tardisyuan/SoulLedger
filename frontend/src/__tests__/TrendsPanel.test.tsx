/**
 * 仪表盘「趋势」面板:四个状态(加载 / 出错 / 快照不足 / 有线)、范围开关、维度开关。
 *
 * 图本身(recharts)在 jsdom 里量不出宽度,什么也画不出来,所以 `next/dynamic` 换成一个只记录
 * 收到什么的桩:这里断的是**喂给图的数据**(行与系列)和面板自己的字 —— 不是折线的像素。
 * 桩不模仿任何行为,只回显 props,所以不会把一个错的面板读成对的。
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ledgerApi } from "@soulledger/core/api";
import { TrendsPanel } from "@/src/components/dashboard/TrendsPanel";
import { tZh, zh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  ledgerApi: { statsTrends: jest.fn() },
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => jest.requireActual("./support/zhBundle").tZh(key, params),
    formatDateTime: (v: string) => `dt(${v})`,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () =>
    function ChartStub(props: { rows: unknown[]; series: { key: string }[] }) {
      const React = require("react");
      return React.createElement("div", {
        "data-testid": "trends-chart",
        "data-rows": JSON.stringify(props.rows),
        "data-series": JSON.stringify(props.series.map((s) => s.key)),
      });
    },
}));

const mockedTrends = ledgerApi.statsTrends as jest.Mock;

const point = (day: string, by_state: Record<string, number>, by_civilization: Record<string, number> = {}) => ({
  day,
  soul_count: Object.values(by_state).reduce((a, b) => a + b, 0),
  by_state,
  by_civilization,
  by_realm: {},
});

const THREE_DAYS = {
  range: "30d",
  since: "2026-09-09",
  until: "2026-10-08",
  points: [
    point("2026-10-06", { ALIVE: 5, JUDGING: 1 }, { CHINESE: 6 }),
    point("2026-10-07", { ALIVE: 4, JUDGING: 2 }, { CHINESE: 4, EGYPTIAN: 2 }),
    point("2026-10-08", { ALIVE: 3, JUDGING: 2, DISPOSED: 1 }, { CHINESE: 3, EGYPTIAN: 3 }),
  ],
};

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TrendsPanel />
    </QueryClientProvider>,
  );
}

const chartProps = () => {
  const el = screen.getByTestId("trends-chart");
  return {
    rows: JSON.parse(el.getAttribute("data-rows") ?? "[]") as Record<string, number | string>[],
    series: JSON.parse(el.getAttribute("data-series") ?? "[]") as string[],
  };
};

beforeEach(() => {
  mockedTrends.mockReset();
});

describe("TrendsPanel", () => {
  it("asks for 30 days first and draws one row per snapshot day, one series per lifecycle state", async () => {
    mockedTrends.mockResolvedValue({ data: THREE_DAYS });
    const { container } = renderPanel();
    expect(container.querySelector("[data-trends-state='loading']")).not.toBeNull();

    await screen.findByTestId("trends-chart");
    expect(mockedTrends).toHaveBeenCalledWith("30d");
    const { rows, series } = chartProps();
    expect(rows.map((r) => r.day)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(series).toEqual(["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "SETTLED"]);
    // 一个状态当天不在快照里 = 那天没有灵魂在里面,是 0,不是缺口。
    expect(rows[0].DISPOSED).toBe(0);
    expect(rows[2].DISPOSED).toBe(1);
  });

  it("lists every series in the legend with its latest count, and never prints a raw enum member", async () => {
    mockedTrends.mockResolvedValue({ data: THREE_DAYS });
    const { container } = renderPanel();
    await screen.findByTestId("trends-chart");

    const latest = (key: string) => container.querySelector(`[data-trend-series='${key}'] [data-trend-latest]`)?.textContent;
    expect(latest("ALIVE")).toBe("3");
    expect(latest("DISPOSED")).toBe("1");
    expect(latest("SETTLED")).toBe("0");
    expect(screen.getByText(zh("souls.states.ALIVE"))).toBeInTheDocument();
    const legend = container.querySelector("ul")?.textContent ?? "";
    expect(legend).not.toMatch(/ALIVE|JUDGING|DISPOSED|REINCARNATING|SETTLED/);
  });

  it("switching the range refetches with that range and marks only it as pressed", async () => {
    mockedTrends.mockResolvedValue({ data: THREE_DAYS });
    renderPanel();
    await screen.findByTestId("trends-chart");

    const r90 = screen.getByRole("button", { name: zh("dashboard.trends.range_90d") });
    fireEvent.click(r90);
    await waitFor(() => expect(mockedTrends).toHaveBeenCalledWith("90d"));
    expect(r90).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: zh("dashboard.trends.range_30d") })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: zh("dashboard.trends.range_12m") }));
    await waitFor(() => expect(mockedTrends).toHaveBeenCalledWith("12m"));
  });

  it("switching to civilizations charts all four, zero where a snapshot has none, from the same data", async () => {
    mockedTrends.mockResolvedValue({ data: THREE_DAYS });
    renderPanel();
    await screen.findByTestId("trends-chart");

    fireEvent.click(screen.getByRole("button", { name: zh("dashboard.trends.by_civilization") }));
    await waitFor(() => expect(chartProps().series).toEqual(["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"]));
    const { rows } = chartProps();
    expect(rows[2]).toMatchObject({ CHINESE: 3, EUROPEAN: 0, EGYPTIAN: 3, GREEK: 0 });
    expect(mockedTrends).toHaveBeenCalledTimes(1); // the dimension is a view of the same payload, not a new request
  });

  it.each([
    ["no snapshot at all", []],
    ["a single day", [point("2026-10-08", { ALIVE: 1 })]],
  ])("with %s it says why there is no line instead of drawing one", async (_name, points) => {
    mockedTrends.mockResolvedValue({ data: { ...THREE_DAYS, points } });
    const { container } = renderPanel();
    expect(await screen.findByText(zh("dashboard.trends.not_enough"))).toBeInTheDocument();
    expect(screen.queryByTestId("trends-chart")).toBeNull();
    expect(container.querySelector("[data-trends-state='empty']")).not.toBeNull();
  });

  it("on error shows an alert (not the empty copy) and retry asks again", async () => {
    mockedTrends.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ data: THREE_DAYS });
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(zh("dashboard.trends.error"));
    expect(screen.queryByText(zh("dashboard.trends.not_enough"))).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: tZh("common.retry") }));
    await screen.findByTestId("trends-chart");
    expect(mockedTrends).toHaveBeenCalledTimes(2);
  });
});
