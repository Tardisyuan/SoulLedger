/**
 * 审判申诉(第五十二批 A-1 ~ A-4):卡片底部的申诉行、各轮与撤回确认、整页表单。
 */
import type { MeAppealableJudgment, MeJudgmentAppeal } from "@soulledger/core/api/soul";
import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { AppealLine, JudgmentAppealScreen, roundsOf } from "../screens/appeals";
import { stubApi } from "./stubApi";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, addListener: () => () => {}, dispatch: jest.fn() }),
  useRoute: () => ({
    params: { judgment: "11111111-1111-1111-1111-111111111111", caseNumber: "CN-2026-0007", verdict: "FAILED", deadline: "2026-11-08T12:00:00Z" },
  }),
}));

function wrap(children: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <NavigationContainer>{children}</NavigationContainer>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  installMobilePlatform();
  mockNavigate.mockClear();
  mockGoBack.mockClear();
});

const J = "11111111-1111-1111-1111-111111111111";
const row = (over: Record<string, unknown> = {}): MeAppealableJudgment => ({
  judgment_id: J,
  case_number: "CN-2026-0007",
  verdict: "FAILED",
  concluded_at: "2026-10-09T00:00:00Z",
  deadline: "2026-11-08T12:00:00Z",
  rounds_used: 0,
  can_appeal: true,
  refusal_code: null,
  ...over,
}) as MeAppealableJudgment;
const round = (over: Record<string, unknown> = {}): MeJudgmentAppeal => ({
  id: "a1",
  judgment: J,
  case_number: "CN-2026-0007",
  round: 1,
  reason: "证据有误",
  evidence: "",
  status: "PENDING",
  original_verdict: "FAILED",
  new_verdict: null,
  current_verdict: "FAILED",
  judgment_concluded_at: "2026-10-09T00:00:00Z",
  decision_note: "",
  decided_at: null,
  create_time: "2026-10-10T00:00:00Z",
  compensations: [],
  ...over,
}) as MeJudgmentAppeal;

it("an appealable judgment shows its deadline as a day and an 「申诉 ›」 that opens the form", () => {
  wrap(<AppealLine row={row()} rounds={[]} onChanged={() => {}} />);
  expect(screen.getByTestId(`appeal-deadline-${J}`).props.children).toBe("2026-11-08 前可申诉");
  fireEvent.press(screen.getByTestId(`appeal-file-${J}`));
  expect(mockNavigate).toHaveBeenCalledWith("JudgmentAppeal", expect.objectContaining({ judgment: J, caseNumber: "CN-2026-0007" }));
});

it("a refused one says why in one grey line and offers no button", () => {
  wrap(<AppealLine row={row({ can_appeal: false, refusal_code: "appeal_window_closed" })} rounds={[]} onChanged={() => {}} />);
  expect(screen.getByTestId(`appeal-refusal-${J}`).props.children).toBe("申诉期已于 2026-11-08 截止");
  expect(screen.queryByTestId(`appeal-file-${J}`)).toBeNull();
});

it("a landed decision opens the latest round: 原判 → 新判, the reviewer's note, a row per compensated station", () => {
  const amended = round({
    status: "AMENDED",
    new_verdict: "PASSED",
    decision_note: "原判漏看了证据",
    decided_at: "2026-10-20T00:00:00Z",
    compensations: [{ id: "c1", weight: 3, order: 1, description: "申诉改判补偿:CN-2026-0007 第 1 站(CN),原判 FAILED → PASSED" }],
  });
  wrap(<AppealLine row={row({ rounds_used: 1 })} rounds={[amended]} focused onChanged={() => {}} />);
  expect(screen.getByTestId("appeal-change-a1").props.children).toBe("不过 → 通过");
  expect(screen.getByTestId("appeal-note-a1").props.children).toBe("原判漏看了证据");
  expect(screen.getByText("第 1 站 · 功德 3")).toBeTruthy();
  // No withdraw on a decided round.
  expect(screen.queryByTestId("appeal-withdraw-a1")).toBeNull();
});

it("opened, the latest round is named once (on the toggle), an earlier round keeps its own heading", () => {
  const older = round({ id: "a1", round: 1, status: "UPHELD", decided_at: "2026-10-10T00:00:00Z" });
  const latest = round({ id: "a2", round: 2 });
  wrap(<AppealLine row={row({ rounds_used: 2 })} rounds={[latest, older]} focused onChanged={() => {}} />);
  expect(screen.getAllByText(/第 2 次申诉/)).toHaveLength(1);
  expect(screen.getAllByText(/第 1 次申诉/)).toHaveLength(1);
});

it("withdrawing the first of two says one is left; the second says none is", () => {
  const first = wrap(<AppealLine row={row({ rounds_used: 1 })} rounds={[round()]} focused onChanged={() => {}} />);
  fireEvent.press(screen.getByTestId("appeal-withdraw-a1"));
  expect(screen.getByTestId("appeal-withdraw-body").props.children).toBe("撤回也算一次。撤回后，这件审判还能申诉 1 次。");
  first.unmount();
  wrap(<AppealLine row={row({ rounds_used: 2 })} rounds={[round({ id: "a2", round: 2 })]} focused onChanged={() => {}} />);
  fireEvent.press(screen.getByTestId("appeal-withdraw-a2"));
  expect(screen.getByTestId("appeal-withdraw-body").props.children).toBe("撤回也算一次。这是第二次，撤回后这件审判不能再申诉。");
});

it("the form refuses an empty reason locally, then sends the reason and goes back", async () => {
  const calls = stubApi({ "POST /me/judgment-appeals/": { status: 201, data: round() } });
  wrap(<JudgmentAppealScreen />);
  fireEvent.press(screen.getByTestId("appeal-submit"));
  expect(await screen.findByText("请写理由")).toBeTruthy();
  expect(calls).toEqual([]);
  fireEvent.changeText(screen.getByTestId("appeal-reason"), "证据有误");
  fireEvent.press(screen.getByTestId("appeal-submit"));
  await screen.findByTestId("appeal-submit");
  await new Promise((r) => setTimeout(r, 0));
  expect(calls[0]?.body).toEqual({ judgment: J, reason: "证据有误", evidence: "" });
  expect(mockGoBack).toHaveBeenCalled();
});

it("roundsOf lists one judgment's rounds, newest first", () => {
  const list = { judgments: [], results: [round({ id: "a1", round: 1 }), round({ id: "x", judgment: "other" }), round({ id: "a2", round: 2 })] };
  expect(roundsOf(list as never, J).map((r) => r.id)).toEqual(["a2", "a1"]);
});
