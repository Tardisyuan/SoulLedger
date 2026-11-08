/**
 * 冥界地图的图框(2026-11-08 演示站实看):
 *   - 缩放钮叠在画面上时,全景下最右一站、它的读数,393 宽近处的分组名都藏在钮下面;393 全景时那一列比图还高,压到「支线」一行。
 *     现在钮在画面之外自成一列 —— 画面(`.v4-map-viewport`)不含工具条,两者是图框里的兄弟。
 *   - 窄屏默认近处(最小的字在屏上 < 11px → 1.25 px / 单位):量宽在 layout effect 里,第一帧就是近处。
 *     jsdom 里看不出「第一帧」,这里钉的是这个决定确实落到 viewBox 上。
 *   - 窄屏的小卡贴在视窗底部,和演示导览面板(z-toast)同一处:卡在抽屉那一档(z-drawer),在面板之上。
 */
import { render, screen, fireEvent } from "@testing-library/react";
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

it("raises the narrow station card above the demo tour panel's layer", async () => {
  width = 300;
  draw();
  await screen.findByTestId("underworld-map");
  fireEvent.click(screen.getAllByRole("button", { name: /土地庙/ })[0]);
  const card = screen.getByTestId("underworld-map-station-card");
  expect(card.className).toMatch(/max-md:z-drawer/);
  expect(card.className).not.toMatch(/max-md:z-(filters|toast)\b/);
});
