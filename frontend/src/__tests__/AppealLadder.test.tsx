/**
 * 上诉的站梯(Design 第五十五批 E-1 / E-2):字形、终审站、驳回后的截断、队列「当前」一格。
 */
import { render, screen, within } from "@testing-library/react";
import type { AppealLadder } from "@soulledger/core/api";
import { AppealLadderView, ladderCurrentText } from "@/src/components/judgment/AppealLadder";
import { tZh } from "./support/zhBundle";

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, locale: "zh-Hans", hydrated: true }),
}));

const station = (order: number, name: string, state: AppealLadder["stations"][number]["state"], note: string | null = null, is_final = false) => ({
  order,
  node: `n${order}`,
  name,
  is_final,
  state,
  note,
});

const running: AppealLadder = {
  current: 2,
  total: 3,
  stations: [
    station(1, "主教区", "PASSED", "理由成立，证据需更高一级核实。"),
    station(2, "总主教区", "CURRENT"),
    station(3, "梵蒂冈", "AHEAD", null, true),
  ],
};

const cut: AppealLadder = {
  current: null,
  total: 3,
  stations: [
    station(1, "主教区", "PASSED", "理由成立"),
    station(2, "总主教区", "REJECTED", "原判依据充分，维持。"),
    station(3, "梵蒂冈", "AHEAD", null, true),
  ],
};

it("draws each station with its glyph, the final one as 终审, and the human conclusion beside it", () => {
  render(<AppealLadderView appeal={{ ladder: running, workflow_status: "IN_PROGRESS", status: "IN_REVIEW" }} />);
  const first = screen.getByTestId("appeal-station-1");
  expect(first).toHaveTextContent("■");
  expect(first).toHaveTextContent(tZh("appeals.ladder_station", { n: "1", name: "主教区" }));
  expect(first).toHaveTextContent(tZh("appeals.ladder_state.PASSED"));
  expect(within(first).getByText("理由成立，证据需更高一级核实。")).toHaveClass("font-serif");
  expect(screen.getByTestId("appeal-station-2")).toHaveTextContent("▪");
  expect(screen.getByTestId("appeal-station-2")).toHaveTextContent(tZh("appeals.ladder_state.CURRENT"));
  const last = screen.getByTestId("appeal-station-3");
  expect(last).toHaveTextContent(tZh("appeals.ladder_final", { name: "梵蒂冈" }));
  expect(last).toHaveTextContent(tZh("appeals.ladder_state.AHEAD"));
});

it("after a rejection the stations beyond it are not 'not reached': no state is written for them", () => {
  render(<AppealLadderView appeal={{ ladder: cut, workflow_status: "REJECTED", status: "UPHELD" }} />);
  expect(screen.getByTestId("appeal-station-2")).toHaveTextContent("✕");
  expect(screen.getByTestId("appeal-station-2")).toHaveTextContent(tZh("appeals.ladder_state.REJECTED"));
  const after = screen.getByTestId("appeal-station-3");
  expect(after).toHaveAttribute("data-state", "NOT_HEARD");
  expect(after).not.toHaveTextContent(tZh("appeals.ladder_state.AHEAD"));
});

it("a passed final station says the appeal's result, not 'passed on'", () => {
  const done: AppealLadder = { current: null, total: 2, stations: [station(1, "主教区", "PASSED"), station(2, "梵蒂冈", "PASSED", "改判", true)] };
  const { unmount } = render(<AppealLadderView appeal={{ ladder: done, workflow_status: "COMPLETED", status: "AMENDED" }} />);
  expect(screen.getByTestId("appeal-station-2")).toHaveTextContent(tZh("appeals.status.AMENDED"));
  expect(screen.getByTestId("appeal-station-2")).not.toHaveTextContent(tZh("appeals.ladder_state.PASSED"));
  unmount();
  // Before the final judge decides, nothing is written there.
  render(<AppealLadderView appeal={{ ladder: done, workflow_status: "COMPLETED", status: "IN_REVIEW" }} />);
  expect(screen.getByTestId("appeal-station-2")).not.toHaveTextContent(tZh("appeals.ladder_state.PASSED"));
  expect(screen.getByTestId("appeal-station-1")).toHaveTextContent(tZh("appeals.ladder_state.PASSED"));
});

it("a single review has no ladder to draw", () => {
  const { container } = render(<AppealLadderView appeal={{ ladder: null, workflow_status: null, status: "PENDING" }} />);
  expect(container).toBeEmptyDOMElement();
});

it("the queue's 当前 cell reads 第 n / total 站 · 站名 · 审理中, and nothing once the flow has stopped", () => {
  expect(ladderCurrentText(running, tZh)).toBe("第 2 / 3 站 · 总主教区 · 审理中");
  expect(ladderCurrentText(cut, tZh)).toBeNull();
  expect(ladderCurrentText(null, tZh)).toBeNull();
});
