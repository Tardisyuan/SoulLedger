/**
 * 第二十五批 §五:界域拓扑的在押 / 容量条(≥ 78% 放大加光圈,≥ 90% 右端竖线,没记容量不画条)
 * 与地府十三站卡(已过窄条、现在展开、未到虚线框)。
 */
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Realm, Soul } from "@soulledger/core/api";
import type { Station, Topology } from "@/src/lib/routeTopology";
import { tZh } from "./support/zhBundle";

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, tf: (_k: string, f: string) => f, locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

import { RouteMap, occupancyBar, OCC_HOT, OCC_DANGER } from "@/src/components/realms/RouteMap";
import { DiyuStationStrip, diyuCardState } from "@/src/components/souls/detail/DiyuRows";

describe("occupancyBar thresholds", () => {
  it("78% is hot, 90% is danger, just under each is not", () => {
    expect([OCC_HOT, OCC_DANGER]).toEqual([0.78, 0.9]);
    expect(occupancyBar(77, 100)).toEqual({ ratio: 0.77, hot: false, danger: false });
    expect(occupancyBar(78, 100)).toEqual({ ratio: 0.78, hot: true, danger: false });
    expect(occupancyBar(89, 100)?.danger).toBe(false);
    expect(occupancyBar(90, 100)).toEqual({ ratio: 0.9, hot: true, danger: true });
  });

  it("no capacity recorded → no bar; capacity 0 with someone held is full, empty is 0", () => {
    expect(occupancyBar(5, null)).toBeNull();
    expect(occupancyBar(5, undefined)).toBeNull();
    expect(occupancyBar(1, 0)).toEqual({ ratio: 1, hot: true, danger: true });
    expect(occupancyBar(0, 0)).toEqual({ ratio: 0, hot: false, danger: false });
  });
});

const station = (id: string, capacity: number | null): Station => ({
  id,
  code: id,
  realm: { id, realm_code: id, civilization: "CHINESE", capacity } as unknown as Realm,
  state: "pending",
});

describe("RouteMap · 在押 / 容量条", () => {
  const topology: Topology = {
    kind: "line",
    schematic: false,
    stations: [station("LOW", 40), station("HOT", 40), station("FULL", 10), station("NOCAP", null)],
    branches: [],
    offShape: [],
  };
  const held = new Map([["LOW", 4], ["HOT", 32], ["FULL", 9], ["NOCAP", 7]]);
  const at = (id: string) => document.querySelector(`[data-station="${id}"]`)!;

  it("draws a bar per station with capacity, marks hot and danger, and none without capacity", () => {
    render(<RouteMap topology={topology} civilizationName="地府" occupancy={held} />);
    expect(at("LOW").querySelector("[data-occupancy-bar]")).toHaveAttribute("data-occupancy-bar", "ok");
    expect(at("LOW").querySelector('[data-mark="held"]')).not.toHaveAttribute("data-hot");
    expect(at("LOW")).toHaveTextContent("4 / 40");
    expect(at("HOT").querySelector("[data-occupancy-bar]")).toHaveAttribute("data-occupancy-bar", "hot");
    expect(at("HOT").querySelector('[data-mark="held"]')).toHaveAttribute("data-hot", "true");
    expect(at("HOT").querySelector('[data-mark="held"]')).toHaveClass("realm-occ-hot");
    expect(at("FULL").querySelector("[data-occupancy-bar]")).toHaveAttribute("data-occupancy-bar", "danger");
    // 没记容量:只写在押,不画条,不写「/」
    expect(at("NOCAP").querySelector("[data-occupancy-bar]")).toBeNull();
    expect(at("NOCAP")).toHaveTextContent("7");
    expect(at("NOCAP").textContent).not.toContain("/");
    expect(document.querySelector('[data-testid="map-legend-bar"]')).not.toBeNull();
  });

  it("occupancy failed → no bars at all, no capacity written", () => {
    render(<RouteMap topology={topology} civilizationName="地府" />);
    expect(document.querySelector("[data-occupancy-bar]")).toBeNull();
    expect(at("LOW").textContent).not.toContain("/ 40");
  });
});

describe("十三站卡折叠", () => {
  it("diyuCardState: before → passed, at → current, after → ahead", () => {
    expect([0, 1, 2, 3].map((i) => diyuCardState(i, 3))).toEqual(["passed", "passed", "current", "ahead"]);
    expect(diyuCardState(0, 1)).toBe("current");
    expect(diyuCardState(12, 13)).toBe("current");
  });

  it("passed fold to strips with a tick and number, one expanded current card, ahead are dashed frames", () => {
    const soul = { id: "s1", name: "张三", civilization: "CHINESE", current_state: "JUDGING", diyu_station: "FENGDU_CITY" } as unknown as Soul;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DiyuStationStrip soul={soul} canMove={false} />
      </QueryClientProvider>
    );
    const cards = Array.from(document.querySelectorAll("li[data-station]"));
    expect(cards.filter((c) => c.classList.contains("diyu-card--passed"))).toHaveLength(9);
    const current = cards.filter((c) => c.classList.contains("diyu-card--current"));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("aria-current", "step");
    expect(current[0]).toHaveTextContent("现在 · 第 10 站");
    expect(current[0]).toHaveTextContent("酆都城");
    expect(cards.filter((c) => c.classList.contains("diyu-card--ahead"))).toHaveLength(3);
    // 已过:勾 + 站号,状态字给读屏;未到没有勾
    expect(cards[0].textContent).toContain("✓");
    expect(cards[0].querySelector(".sr-only")).toHaveTextContent("已过");
    expect(cards[12].textContent).not.toContain("✓");
    expect(cards[12].querySelector(".sr-only")).toHaveTextContent("未到");
    expect(cards.filter((c) => c.hasAttribute("aria-current"))).toHaveLength(1);
  });
});
