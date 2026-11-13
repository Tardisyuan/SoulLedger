/**
 * 冥界地图的图框(2026-11-08 演示站实看):
 *   - 缩放钮叠在画面上时,全景下最右一站、它的读数,393 宽近处的分组名都藏在钮下面;393 全景时那一列比图还高,压到「支线」一行。
 *     现在钮在画面之外自成一列 —— 画面(`.v4-map-viewport`)不含工具条,两者是图框里的兄弟。
 *   - 窄屏默认近处(最小的字在屏上 < 11px → 1.25 px / 单位):量宽在 layout effect 里,第一帧就是近处。
 *     jsdom 里看不出「第一帧」,这里钉的是这个决定确实落到 viewBox 上。
 *   - 窄屏的小卡贴在视窗底部,和演示导览面板(z-toast)同一处:卡在抽屉那一档(z-drawer),在面板之上。
 */
import { act, render, screen, fireEvent } from "@testing-library/react";
import { UnderworldMap } from "@/src/components/realms/UnderworldMap";
import { CLOSE_SCALE } from "@/src/lib/underworldMapLayers";

const mockI18n = { t: (key: string) => key, locale: "zh-Hans", formatDate: (s: string) => s };
jest.mock("@/src/contexts/I18nContext", () => ({ useI18n: () => mockI18n }));
jest.mock("@/src/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }) }));

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 450">
  <g id="terrain">
    <g class="node" id="TUDI_TEMPLE"><rect x="150" y="250" width="20" height="20"/></g>
    <g class="node" id="HUANGQUAN_ROAD"><rect x="1050" y="250" width="20" height="20"/></g>
  </g>
  <g id="labels">
    <g data-for="TUDI_TEMPLE"><text x="160" y="300" font-size="10">01</text><text x="160" y="320" font-size="12">土地庙</text></g>
    <g data-for="HUANGQUAN_ROAD"><text x="1060" y="300" font-size="10">02</text><text x="1060" y="320" font-size="12">黄泉路</text></g>
    <text id="edge-left" x="20" y="420" font-size="12" text-anchor="middle">Earth God's Temple</text>
    <text id="edge-right" x="1110" y="420" font-size="12" text-anchor="middle">Field of Reeds (Aaru)</text>
  </g>
</svg>`;

const realFetch = global.fetch;
let width = 0;

beforeEach(() => {
  // 只有整张图给得出;主角节点载不到(照原图画)。
  global.fetch = jest.fn((url: string) =>
    Promise.resolve({ ok: url.includes("/maps/soulledger-map-"), text: () => Promise.resolve(SVG) } as Response),
  ) as unknown as typeof fetch;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return (this as unknown as HTMLElement).classList.contains("v4-map-viewport") ? width : 0;
    },
  });
});
afterEach(() => {
  global.fetch = realFetch;
  // jsdom keeps clientWidth on Element.prototype; drop the shadow so it shows through again.
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

const draw = () => render(<UnderworldMap civilization="CHINESE" label="地府" />);

it("puts the zoom buttons beside the drawing, never over it", async () => {
  width = 900;
  const { container } = draw();
  await screen.findByTestId("underworld-map");
  const toolbar = screen.getByRole("toolbar");
  const viewport = container.querySelector(".v4-map-viewport")!;
  expect(viewport.contains(toolbar)).toBe(false);
  expect(toolbar.parentElement).toBe(viewport.parentElement);
  // Absence: not lifted out of the flow onto the picture.
  expect(toolbar.className).not.toMatch(/(^|\s)(absolute|fixed)(\s|$)/);
  // Narrow (2026-11-14): a row above the picture, not a column eating a sixth of a 393 frame beside it.
  expect(toolbar.className).toMatch(/(^|\s)max-md:flex-row(\s|$)/);
  expect(toolbar.className).toMatch(/(^|\s)max-md:order-first(\s|$)/);
  expect(toolbar.parentElement!.className).toMatch(/(^|\s)max-md:flex-col(\s|$)/);
});

it("says the toolbar's orientation as it is laid out: a column from md (768) up, a row below", async () => {
  const realMatchMedia = window.matchMedia;
  const listeners = new Set<() => void>();
  let wide = true;
  window.matchMedia = ((query: string) => ({
    matches: query === "(min-width: 768px)" ? wide : false,
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  })) as unknown as typeof window.matchMedia;
  try {
    width = 900;
    draw();
    await screen.findByTestId("underworld-map");
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveAttribute("aria-orientation", "vertical");
    wide = false;
    act(() => listeners.forEach((fn) => fn()));
    expect(toolbar).toHaveAttribute("aria-orientation", "horizontal");
    // The keys are unchanged: + still zooms from the toolbar whichever way it lies.
    fireEvent.keyDown(toolbar, { key: "+" });
    expect(screen.getByRole("toolbar")).toHaveAttribute("aria-orientation", "horizontal");
  } finally {
    window.matchMedia = realMatchMedia;
  }
});

it("opens close up at a narrow width: 1.25 px per unit, from the drawing's own width", async () => {
  width = 300;
  const { container } = draw();
  const figure = await screen.findByTestId("underworld-map");
  expect(figure).toHaveAttribute("data-camera", "close");
  const [, , w] = container.querySelector(".v4-map-viewport > svg")!.getAttribute("viewBox")!.split(" ").map(Number);
  expect(w).toBe(Math.round(300 / CLOSE_SCALE));
});

it("draws the whole map when it is wide enough for 11px labels", async () => {
  width = 1300;
  const { container } = draw();
  expect(await screen.findByTestId("underworld-map")).toHaveAttribute("data-camera", "whole");
  expect(container.querySelector(".v4-map-viewport > svg")!.getAttribute("viewBox")).toBe("0 0 1120 450");
});

// 2026-11-14: on the desktop panorama the English 「Earth God's Temple」 / 「Field of Reeds (Aaru)」 were cut at the map edge —
// the anchoring ran close up only. The whole map anchors too; a line well inside stays where Design put it.
it("the whole map anchors a line past either edge inside it, and leaves the inner lines alone", async () => {
  width = 1300;
  const { container } = draw();
  expect(await screen.findByTestId("underworld-map")).toHaveAttribute("data-camera", "whole");
  const left = container.querySelector("#edge-left")!;
  const right = container.querySelector("#edge-right")!;
  expect([left.getAttribute("text-anchor"), left.getAttribute("x")]).toEqual(["start", "4"]);
  expect([right.getAttribute("text-anchor"), right.getAttribute("x")]).toEqual(["end", String(1120 - 4)]);
  // Absence: a line inside the map keeps Design's position.
  const inner = container.querySelector('[data-for="TUDI_TEMPLE"] text[y="300"]')!;
  expect([inner.getAttribute("text-anchor"), inner.getAttribute("x")]).toEqual([null, "160"]);
});

it("opens at Fit on a desktop-width container (the Diyu labels alone would ask for a close-up)", async () => {
  width = 870;
  const { container } = draw();
  expect(await screen.findByTestId("underworld-map")).toHaveAttribute("data-camera", "whole");
  expect(container.querySelector(".v4-map-viewport > svg")!.getAttribute("viewBox")).toBe("0 0 1120 450");
});

it("raises the narrow station card above the demo tour panel's layer", async () => {
  width = 300;
  draw();
  await screen.findByTestId("underworld-map");
  fireEvent.click(screen.getAllByRole("button", { name: /土地庙/ })[0]);
  const card = screen.getByTestId("underworld-map-station-card");
  expect(card.className).toMatch(/max-md:z-drawer/);
  expect(card.className).not.toMatch(/max-md:z-(filters|toast)\b/);
  // And sits above the panel rather than over its buttons: the bottom offset adds the panel's published height.
  expect(card.className).toContain("max-md:bottom-[calc(var(--demo-tour-h,0px)+1rem)]");
  expect(card.className).not.toMatch(/max-md:bottom-4\b/);
});

// 小卡上「今日进 · 出 · 平均停留」(Design 第十六批 §1.4;`GET /realms/occupancy/` 2026-11-08 加的三个数)。
it("writes today's in / out and the average stay on the station card; a missing figure is 'unrecorded', not 0", async () => {
  width = 1300;
  const loads = new Map([
    ["TUDI_TEMPLE", { held: 4, capacity: 10, flow: { arrived: 3, left: 1, avgDays: 2.5 } }],
    ["HUANGQUAN_ROAD", { held: 0, capacity: 10, flow: { arrived: null, left: 2, avgDays: null } }],
  ]);
  render(<UnderworldMap civilization="CHINESE" label="地府" loads={loads} />);
  await screen.findByTestId("underworld-map");
  fireEvent.click(screen.getAllByRole("button", { name: /土地庙/ })[0]);
  let flow = screen.getByTestId("underworld-map-station-flow");
  expect(flow.textContent!.replace(/\s+/g, " ")).toBe(
    "map.card.today_in 3 · map.card.today_out 1 · map.card.avg_stay overview.days",
  );
  expect(flow.querySelector("[data-missing]")).toBeNull();

  fireEvent.click(screen.getAllByRole("button", { name: /黄泉路/ })[0]);
  flow = screen.getByTestId("underworld-map-station-flow");
  expect(flow.querySelectorAll("[data-missing]")).toHaveLength(2);
  expect(flow.textContent).toContain("map.card.today_out 2");
  expect(flow.textContent).not.toContain("today_in 0");
});

it("draws no flow line when the loads carry no flow (an older reply)", async () => {
  width = 1300;
  render(<UnderworldMap civilization="CHINESE" label="地府" loads={new Map([["TUDI_TEMPLE", { held: 1, capacity: 2 }]])} />);
  await screen.findByTestId("underworld-map");
  fireEvent.click(screen.getAllByRole("button", { name: /土地庙/ })[0]);
  expect(screen.getByTestId("underworld-map-station-card")).toBeInTheDocument();
  expect(screen.queryByTestId("underworld-map-station-flow")).toBeNull();
});

// 概览的缩略图:只有图 —— 没有钮、清单、小卡;窄也不进近处。
it("compact draws only the picture: no toolbar, no buttons, whole map even when narrow", async () => {
  width = 300;
  const { container } = render(<UnderworldMap compact civilization="CHINESE" label="地府" />);
  const figure = await screen.findByTestId("underworld-map");
  expect(figure).toHaveAttribute("data-compact");
  expect(screen.queryByRole("toolbar")).toBeNull();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.getByRole("img", { name: "地府" })).toBeInTheDocument();
  expect(container.querySelector(".v4-map-viewport > svg")!.getAttribute("viewBox")).toBe("0 0 1120 450");
});
