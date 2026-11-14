/**
 * The demo tour, skipped, folds to a chip at once (walked to its end: after its end card is closed) (review r2, 2026-11-14): the 「导览已跳过」 card
 * used to stay open at the bottom right for the rest of the visit, over the lower half of the dossier. The chip opens the
 * end card again; 留在这里 folds it back; 重看导览 starts the tour over from its first step.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import zh from "@soulledger/core/messages/zh-Hans.json";

import { I18nProvider } from "@/src/contexts/I18nContext";
import DemoTour from "@/demo/DemoTour";
import { TOUR_KEY } from "@/demo/DemoEntrances";
import type { Tour } from "@/demo/tour";

const mockTour: Tour = {
  skin: "cn",
  steps: [
    { n: 1, target: "soul", route: "/souls" },
    { n: 2, target: "soul", route: "/judgment" },
  ],
};

let mockPath = "/souls";
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ usePathname: () => mockPath, useRouter: () => ({ push: mockPush }) }));
jest.mock("@soulledger/core/api/client", () => ({ api: { get: () => Promise.resolve({ data: mockTour }) } }));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: { username: "demo_judge" }, setUser: jest.fn() }) }));
jest.mock("@/src/hooks/useWideViewport", () => ({ useWideViewport: () => true }));
jest.mock("@/demo/DemoEntrances", () => ({
  ...jest.requireActual("@/demo/DemoEntrances"),
  useEnter: () => ({ enter: jest.fn(), warm: jest.fn() }),
}));

const tours = zh.demo.tour;

async function show(state: object) {
  sessionStorage.setItem(TOUR_KEY, JSON.stringify(state));
  render(<I18nProvider><DemoTour /></I18nProvider>);
  await act(async () => {});
}

const click = (id: string) => act(async () => void fireEvent.click(screen.getByTestId(id)));
const saved = () => JSON.parse(sessionStorage.getItem(TOUR_KEY) ?? "{}");

beforeEach(() => {
  sessionStorage.clear();
  mockPath = "/souls";
  mockPush.mockClear();
});

it("skipping leaves a chip, not the card over the page; the chip opens the card and 留在这里 folds it again", async () => {
  await show({ step: 0 });
  await click("demo-tour-skip");
  expect(screen.queryByTestId("demo-tour")).toBeNull();
  const chip = screen.getByTestId("demo-tour-badge");
  expect(chip).toHaveAttribute("data-finished");
  expect(chip).toHaveTextContent(tours.skipped_title);
  expect(saved()).toMatchObject({ finished: true, skipped: true, collapsed: true });

  await click("demo-tour-badge");
  expect(screen.getByTestId("demo-tour")).toHaveAttribute("data-finished");
  expect(screen.getByTestId("demo-tour")).toHaveTextContent(tours.skipped_title);
  expect(screen.queryByTestId("demo-tour-badge")).toBeNull();

  await click("demo-tour-stay");
  expect(screen.queryByTestId("demo-tour")).toBeNull();
  expect(screen.getByTestId("demo-tour-badge")).toBeInTheDocument();
});

it("the last 下一步 shows the end card once; closed, it folds to a chip that says the tour is done", async () => {
  mockPath = "/judgment";
  await show({ step: 1 });
  await click("demo-tour-next");
  expect(screen.getByTestId("demo-tour")).toHaveAttribute("data-finished");
  expect(screen.getByTestId("demo-tour")).toHaveTextContent(tours.done_title);
  expect(screen.queryByTestId("demo-tour-badge")).toBeNull();
  await click("demo-tour-stay");
  expect(screen.queryByTestId("demo-tour")).toBeNull();
  expect(screen.getByTestId("demo-tour-badge")).toHaveTextContent(tours.done_title);
  expect(screen.getByTestId("demo-tour-badge")).not.toHaveTextContent(tours.skipped_title);
});

it("重看导览 starts over at the first step, on its page", async () => {
  mockPath = "/judgment";
  await show({ step: 1, finished: true, skipped: true, collapsed: false });
  await click("demo-tour-replay");
  expect(mockPush).toHaveBeenCalledWith("/souls");
  expect(saved()).toMatchObject({ step: 0, finished: false, skipped: false, collapsed: false, closed: false });
  expect(screen.getByTestId("demo-tour-progress")).toHaveTextContent("1 / 2");
  expect(screen.queryByTestId("demo-tour-badge")).toBeNull();
});

it("Design 第四十八批:卡不够宽时「留在这里」退成右上角的 ×,无障碍名用同一个文案键,按下同样收成小签", async () => {
  mockPath = "/judgment";
  await show({ step: 1, finished: true, skipped: false, collapsed: false });
  const card = screen.getByTestId("demo-tour");
  const x = screen.getByTestId("demo-tour-close");
  const stay = screen.getByTestId("demo-tour-stay");
  // 按卡的宽度(容器查询)切换:窄时 × 出现、文字按钮藏起;两者同一阈值,宽时反过来。
  expect(card.className).toContain("@container");
  expect(x.className).toMatch(/(^| )hidden( |$)/);
  expect(x.className).toContain("@max-[42rem]:flex");
  expect(stay.className).toContain("@max-[42rem]:hidden");
  expect(x).toHaveAccessibleName(tours.stay);
  expect(x).toHaveTextContent("×");
  // × 在卡里、不在按钮行里(它不占按钮行的位置)。
  expect(card.contains(x)).toBe(true);
  expect(screen.getByTestId("demo-tour-actions").contains(x)).toBe(false);

  await click("demo-tour-close");
  expect(screen.queryByTestId("demo-tour")).toBeNull();
  expect(screen.getByTestId("demo-tour-badge")).toHaveTextContent(tours.done_title);
  expect(saved()).toMatchObject({ finished: true, collapsed: true });
});
