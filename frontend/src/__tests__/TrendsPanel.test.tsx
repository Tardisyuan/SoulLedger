/**
 * 仪表盘「趋势」面板(A14 §5 小多图):四个状态(加载 / 出错 / 空 / 有线,外加「区间未满」的提示)、
 * 区间与维度两组开关、每格一个 figure 的读屏句、每格自己的纵轴(最高 / 最低值)、变化的写法。
 *
 * 线是内联 SVG,jsdom 画得出来,所以这里直接断 DOM:格子的数、数值、变化字、`aria-label`,
 * 以及折线是否真的从有数据的那天起画(左边留空)。
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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
    formatDateTime: (v: string) => `dt(${v.slice(0, 10)})`,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const mockedTrends = ledgerApi.statsTrends as jest.Mock;

const point = (day: string, by_state: Record<string, number>, by_civilization: Record<string, number> = {}) => ({
  day,
  soul_count: Object.values(by_state).reduce((a, b) => a + b, 0),
  by_state,
  by_civilization,
  by_realm: {},
});

// since 2026-09-09 .. until 2026-10-08: a full 30-day window needs a first snapshot ON the since day.
const FULL = {
  range: "30d",
  since: "2026-09-09",
  until: "2026-10-08",
  points: [
    point("2026-09-09", { ALIVE: 10, JUDGING: 0, DISPOSED: 4 }, { CHINESE: 10, EGYPTIAN: 4 }),
    point("2026-09-23", { ALIVE: 8, JUDGING: 2, DISPOSED: 4 }, { CHINESE: 8, EGYPTIAN: 6 }),
    point("2026-10-08", { ALIVE: 5, JUDGING: 3, DISPOSED: 6 }, { CHINESE: 5, EGYPTIAN: 3, GREEK: 6 }),
  ],
};
// Deployed three days ago: the window is 30 days, the data 3.
const PARTIAL = {
  ...FULL,
  points: [
    point("2026-10-06", { ALIVE: 5, JUDGING: 1 }),
    point("2026-10-07", { ALIVE: 4, JUDGING: 2 }),
    point("2026-10-08", { ALIVE: 3, JUDGING: 2, DISPOSED: 1 }),
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

const cell = (container: HTMLElement, key: string) => container.querySelector(`[data-trend-cell='${key}']`) as HTMLElement;
const text = (el: HTMLElement, attr: string) => el.querySelector(`[${attr}]`)?.textContent;

beforeEach(() => {
  mockedTrends.mockReset();
});

describe("TrendsPanel · frame", () => {
  it("has the title, the 00:00 / vs-range-start line and two groups of 44-high segments, the chosen one ink-solid", async () => {
    mockedTrends.mockResolvedValue({ data: FULL });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    expect(screen.getByRole("heading", { name: zh("dashboard.trends.title") })).toBeInTheDocument();
    expect(screen.getByText(zh("dashboard.trends.subtitle"))).toBeInTheDocument();
    const range = screen.getByRole("group", { name: zh("dashboard.trends.range_label") });
    const dimension = screen.getByRole("group", { name: zh("dashboard.trends.dimension_label") });
    expect(within(range).getAllByRole("button")).toHaveLength(3);
    expect(within(dimension).getAllByRole("button")).toHaveLength(2);
    const on = within(range).getByRole("button", { name: zh("dashboard.trends.range_30d") });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(on.className).toContain("bg-[oklch(var(--color-ink))]");
    expect(on.className).toContain("min-h-(--control-h-sm)");
    expect(within(range).getByRole("button", { name: zh("dashboard.trends.range_90d") }).className).not.toContain("bg-[oklch(var(--color-ink))]");
  });

  it("pads on the spacing scale (24, p-6), not an arbitrary pixel value", async () => {
    mockedTrends.mockResolvedValue({ data: FULL });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    const panel = container.querySelector("[data-trends-panel]") as HTMLElement;
    expect(panel.className).toContain(" p-6");
    expect(panel.className).not.toMatch(/\bp-\[/);
  });

  it("switching the range refetches with that range and marks only it as pressed", async () => {
    mockedTrends.mockResolvedValue({ data: FULL });
    renderPanel();
    await waitFor(() => expect(mockedTrends).toHaveBeenCalledWith("30d"));
    const r90 = screen.getByRole("button", { name: zh("dashboard.trends.range_90d") });
    fireEvent.click(r90);
    await waitFor(() => expect(mockedTrends).toHaveBeenCalledWith("90d"));
    expect(r90).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: zh("dashboard.trends.range_30d") })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: zh("dashboard.trends.range_12m") }));
    await waitFor(() => expect(mockedTrends).toHaveBeenCalledWith("12m"));
  });
});

describe("TrendsPanel · small multiples", () => {
  it("states: six cells (five lifecycle states and 迷失), each with its own current value and axis", async () => {
    mockedTrends.mockResolvedValue({ data: FULL });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    const keys = [...container.querySelectorAll("[data-trend-cell]")].map((c) => c.getAttribute("data-trend-cell"));
    expect(keys).toEqual(["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "SETTLED", "LOST"]);
    expect(text(cell(container, "ALIVE"), "data-trend-latest")).toBe("5");
    // each axis is its own: ALIVE runs 10 → 5, JUDGING 0 → 3, never one shared scale
    expect(text(cell(container, "ALIVE"), "data-trend-max")).toBe("10");
    expect(text(cell(container, "ALIVE"), "data-trend-min")).toBe("5");
    expect(text(cell(container, "JUDGING"), "data-trend-max")).toBe("3");
    expect(text(cell(container, "JUDGING"), "data-trend-min")).toBe("0");
    expect(text(cell(container, "LOST"), "data-trend-latest")).toBe("0");
    // glyph + word, never the raw member in the text
    expect(cell(container, "ALIVE").textContent).toContain(zh("souls.states.ALIVE"));
    expect(cell(container, "ALIVE").textContent).not.toMatch(/ALIVE/);
  });

  it("writes the change against the start of the range with ↑ ↓ → (never ▲ ▼), and reads it out per cell", async () => {
    mockedTrends.mockResolvedValue({ data: FULL });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    expect(text(cell(container, "ALIVE"), "data-trend-change")).toBe("↓ 50%");
    expect(text(cell(container, "DISPOSED"), "data-trend-change")).toBe("↑ 50%");
    expect(text(cell(container, "SETTLED"), "data-trend-change")).toBe("→ 0%");
    // 0 → 3: no percentage can be said, and it says so instead of inventing one
    expect(text(cell(container, "JUDGING"), "data-trend-change")).toBe(`↑ ${zh("dashboard.trends.change_from_zero")}`);
    expect(container.textContent).not.toMatch(/[▲▼]/);

    const aria = (key: string) => cell(container, key).getAttribute("aria-label");
    expect(cell(container, "ALIVE").tagName).toBe("FIGURE");
    expect(aria("ALIVE")).toBe(`${zh("souls.states.ALIVE")}，5，降 50%`);
    expect(aria("DISPOSED")).toBe(`${zh("souls.states.DISPOSED")}，6，升 50%`);
    expect(aria("SETTLED")).toBe(`${zh("souls.states.SETTLED")}，0，持平`);
    expect(aria("JUDGING")).toBe(`${zh("souls.states.JUDGING")}，3，自 0 起`);
  });

  it("civilizations: four cells named by hall, with the civilization glyph, no civilization colour in the line", async () => {
    mockedTrends.mockResolvedValue({ data: FULL });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: zh("dashboard.trends.by_civilization") }));
    await waitFor(() => expect(container.querySelectorAll("[data-trend-cell]")).toHaveLength(4));
    const keys = [...container.querySelectorAll("[data-trend-cell]")].map((c) => c.getAttribute("data-trend-cell"));
    expect(keys).toEqual(["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"]);
    expect(cell(container, "CHINESE").textContent).toContain("■");
    expect(cell(container, "CHINESE").textContent).toContain(zh("tenant.civilizations.CHINESE"));
    expect(text(cell(container, "GREEK"), "data-trend-latest")).toBe("6");
    expect(mockedTrends).toHaveBeenCalledTimes(1); // the dimension is a view of the same payload
    for (const poly of container.querySelectorAll("polyline")) {
      expect(poly.getAttribute("class")).toContain("--color-chart-1");
    }
  });

  it("a long name wraps its value and change to a second line (flex-wrap) and truncates the name last", async () => {
    mockedTrends.mockResolvedValue({ data: FULL });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    const head = cell(container, "ALIVE").firstElementChild as HTMLElement;
    expect(head.className).toContain("flex-wrap");
    const name = head.querySelector("[data-enum-state]") as HTMLElement;
    expect(name.className).toContain("truncate");
    expect(name.parentElement!.className).toContain("min-w-0");
  });

  it("draws the line from the first snapshot day: the left of an unfilled window stays empty, not zero", async () => {
    mockedTrends.mockResolvedValue({ data: PARTIAL });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    const poly = cell(container, "ALIVE").querySelector("polyline")!;
    const xs = poly.getAttribute("points")!.split(" ").map((p) => Number(p.split(",")[0]));
    // 2026-10-06 is day 27 of 29 days since 09-09: x = 27/29 of the 200-wide box
    expect(xs[0]).toBeCloseTo((27 / 29) * 200, 0);
    expect(xs[2]).toBeCloseTo(200, 0);
  });
});

describe("TrendsPanel · the other states", () => {
  it("tells a not-yet-full window with ◐ and the number of days, in a cell-grid that is still drawn", async () => {
    mockedTrends.mockResolvedValue({ data: PARTIAL });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-partial]")).not.toBeNull());
    expect(container.querySelector("[data-trends-partial]")!.textContent).toBe(`◐ ${zh("dashboard.trends.partial").replace("{{n}}", "3")}`);
    expect(container.querySelectorAll("[data-trend-cell]").length).toBe(6);
  });

  it("a full window shows no such note", async () => {
    mockedTrends.mockResolvedValue({ data: FULL });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    expect(container.querySelector("[data-trends-partial]")).toBeNull();
  });

  it("loading: skeleton cells and aria-busy on the panel, switches already usable", async () => {
    mockedTrends.mockReturnValue(new Promise(() => {}));
    const { container } = renderPanel();
    expect(container.querySelector("[data-trends-panel]")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector("[data-trends-state='loading']")).not.toBeNull();
    expect(container.querySelectorAll("[data-trends-state='loading'] > *")).toHaveLength(6);
    expect(screen.getByRole("button", { name: zh("dashboard.trends.range_90d") })).toBeEnabled();
  });

  it("no snapshot at all: ○ 还没有快照, the explanation, a dashed baseline, and the switches still work", async () => {
    mockedTrends.mockResolvedValue({ data: { ...FULL, points: [] } });
    const { container } = renderPanel();
    expect(await screen.findByText(zh("dashboard.trends.empty_title"))).toBeInTheDocument();
    expect(screen.getByText(zh("dashboard.trends.empty_body"))).toBeInTheDocument();
    expect(container.querySelector("[data-trends-state='empty'] .border-dashed")).not.toBeNull();
    expect(container.querySelector("[data-trend-cell]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: zh("dashboard.trends.by_civilization") }));
    expect(screen.getByRole("button", { name: zh("dashboard.trends.by_civilization") })).toHaveAttribute("aria-pressed", "true");
  });

  it("a single day is drawn as a dot, not hidden", async () => {
    mockedTrends.mockResolvedValue({ data: { ...FULL, points: [point("2026-10-08", { ALIVE: 1 })] } });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    expect(cell(container, "ALIVE").querySelector("circle")).not.toBeNull();
    expect(cell(container, "ALIVE").querySelector("polyline")).toBeNull();
  });

  it("on error shows ! 趋势没取到 as an alert (not the empty copy) and 重试 asks again", async () => {
    mockedTrends.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ data: FULL });
    const { container } = renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`! ${zh("dashboard.trends.error")}`);
    expect(zh("dashboard.trends.error")).toBe("趋势没取到");
    expect(screen.queryByText(zh("dashboard.trends.empty_title"))).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: tZh("common.retry") }));
    await waitFor(() => expect(container.querySelector("[data-trends-state='ready']")).not.toBeNull());
    expect(mockedTrends).toHaveBeenCalledTimes(2);
  });
});
