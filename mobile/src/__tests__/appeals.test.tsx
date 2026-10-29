/**
 * 审判申诉(第五十二批 A-1 ~ A-4):卡片底部的申诉行、各轮与撤回确认、整页表单。
 */
import { appealRefusalKey, type MeAppealableJudgment, type MeJudgmentAppeal } from "@soulledger/core/api/soul";
import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastProvider } from "../feedback";
import { I18nProvider, translate } from "../i18n";
import { installMobilePlatform } from "../platform";
import { AppealLine, JudgmentAppealScreen, roundsOf } from "../screens/appeals";
import { stubApi } from "./stubApi";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const BASE_PARAMS = { judgment: "11111111-1111-1111-1111-111111111111", caseNumber: "CN-2026-0007", verdict: "FAILED", deadline: "2026-11-08T12:00:00Z" };
let mockParams: Record<string, unknown> = BASE_PARAMS;
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, addListener: () => () => {}, dispatch: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
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
  mockParams = BASE_PARAMS;
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
  can_escalate: false,
  escalation_stations: [],
  civilization: "EUROPEAN",
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
  workflow: null,
  workflow_number: null,
  workflow_status: null,
  workflow_name: null,
  ladder: null,
  ...over,
}) as MeJudgmentAppeal;

type Station = NonNullable<MeJudgmentAppeal["ladder"]>["stations"][number];
const station = (order: number, name: string, state: Station["state"], note: string | null = null, is_final = false): Station => ({
  order,
  node: `n${order}`,
  name,
  is_final,
  state,
  note,
});
const escalated = (stations: Station[], over: Record<string, unknown> = {}) =>
  round({
    id: "a2",
    round: 2,
    status: "IN_REVIEW",
    workflow: "w1",
    workflow_name: "申诉审判流程",
    workflow_status: "IN_PROGRESS",
    ladder: { current: stations.find((s) => s.state === "CURRENT")?.order ?? null, total: stations.length, stations },
    ...over,
  });

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

it("a Greek judgment offers no appeal and says Minos is final (docs/02 希腊 §5.2)", () => {
  wrap(<AppealLine row={row({ can_appeal: false, refusal_code: "no_appeal_above_minos" })} rounds={[]} onChanged={() => {}} />);
  expect(screen.getByTestId(`appeal-refusal-${J}`).props.children).toBe("米诺斯的判决是终裁，其上无可申诉");
  expect(screen.queryByTestId(`appeal-file-${J}`)).toBeNull();
});

it("after an upheld review, 「上诉 ›」 opens the same form for the appeal flow; without it there is no button", () => {
  const stations = ["魏征 · 察查司", "原殿阎王 · 复核", "上级殿阎王", "酆都大帝 · 终审"];
  const first = wrap(<AppealLine row={row({ rounds_used: 1, can_escalate: true, escalation_stations: stations })} rounds={[]} onChanged={() => {}} />);
  fireEvent.press(screen.getByTestId(`appeal-escalate-${J}`));
  expect(mockNavigate).toHaveBeenCalledWith("JudgmentAppeal", expect.objectContaining({ judgment: J, escalate: true, stations, civilization: "EUROPEAN" }));
  first.unmount();
  wrap(<AppealLine row={row()} rounds={[]} onChanged={() => {}} />);
  expect(screen.queryByTestId(`appeal-escalate-${J}`)).toBeNull();
});

it("U-1: the escalation takes the 「申诉 ›」 line's place — the hint on the left, no second 申诉 beside it", () => {
  wrap(<AppealLine row={row({ rounds_used: 1, can_escalate: true })} rounds={[]} onChanged={() => {}} />);
  expect(screen.getByTestId(`appeal-escalate-hint-${J}`).props.children).toBe("上一次复核维持了原判。还不服，可以上诉。");
  expect(screen.queryByTestId(`appeal-file-${J}`)).toBeNull();
  expect(screen.queryByTestId(`appeal-deadline-${J}`)).toBeNull();
});

it("U-2: the escalation form lists the stations under 申诉流程 · 文明名, the last one as 终审, and sends without a reason", async () => {
  mockParams = { ...BASE_PARAMS, escalate: true, stations: ["主教区", "总主教区", "梵蒂冈"], civilization: "EUROPEAN" };
  const calls = stubApi({ "POST /me/judgment-appeals/": { status: 201, data: round() } });
  wrap(<JudgmentAppealScreen />);
  expect(screen.getByTestId("appeal-stations").props.children).toBe("主教区 → 总主教区 → 终审 · 梵蒂冈");
  expect(screen.getByText("申诉流程 · 欧洲")).toBeTruthy();
  expect(screen.getByText("补充理由 · 选填")).toBeTruthy();
  expect(screen.queryByText("理由")).toBeNull();
  expect(screen.getByTestId("appeal-escalate-last").props.children).toBe("这是这件审判的最后一次申诉，之后不能再申诉。");
  expect(StyleSheet.flatten(screen.getByTestId("appeal-escalate-last").props.style).backgroundColor).toBeTruthy();
  // The submit button says 上诉, not 提交申诉.
  expect(screen.getByTestId("appeal-submit").props.accessibilityLabel).toBe("上诉");
  expect(screen.queryByText("提交申诉")).toBeNull();
  expect(screen.getByTestId("appeal-file-body").props.children).toContain("这一次也算一次申诉");
  fireEvent.press(screen.getByTestId("appeal-submit"));
  await screen.findByTestId("appeal-submit");
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText("请写理由")).toBeNull();
  expect(calls[0]?.body).toEqual({ judgment: J, reason: "", evidence: "", escalate: true });
});

it("U-3: a round in the flow carries the 上诉 tag, its progress, and a station per node with the human conclusion", () => {
  const live = escalated([station(1, "魏征 · 察查司", "PASSED", "理由成立"), station(2, "原殿阎王 · 复核", "CURRENT"), station(3, "酆都大帝 · 终审", "AHEAD", null, true)]);
  wrap(<AppealLine row={row({ rounds_used: 2 })} rounds={[live]} focused onChanged={() => {}} />);
  expect(screen.getByTestId("appeal-escalated-tag")).toBeTruthy();
  // 终审 is not counted among the stations (55b).
  expect(screen.getByTestId("appeal-progress-a2").props.children).toBe("第 2 / 2 站");
  expect(screen.getByText("第 1 站 · 魏征 · 察查司")).toBeTruthy();
  expect(screen.getByTestId("appeal-station-state-a2-1").props.children).toBe("通过，送往下一站");
  expect(screen.getByText("理由成立")).toBeTruthy();
  expect(screen.getByTestId("appeal-station-state-a2-2").props.children).toBe("审理中");
  expect(screen.getByText("终审 · 酆都大帝")).toBeTruthy();
  expect(screen.getByTestId("appeal-station-state-a2-3").props.children).toBe("未到");
  // 终审 sits on its own row under the dashed rule, not in the ladder.
  expect(within(screen.getByTestId("appeal-final-a2")).getByTestId("appeal-station-a2-3")).toBeTruthy();
  expect(within(screen.getByTestId("appeal-final-a2")).queryByTestId("appeal-station-a2-2")).toBeNull();
  expect(screen.queryByTestId("appeal-withdraw-a2")).toBeNull();
});

it("U-6: all stations passed — the round says 站梯走完 · 待终审 and the final row is ◇ on a light ground", () => {
  const waiting = escalated([station(1, "主教区", "PASSED"), station(2, "总主教区", "PASSED"), station(3, "梵蒂冈", "AWAITING_FINAL", null, true)], {
    workflow_status: "COMPLETED",
  });
  wrap(<AppealLine row={row({ rounds_used: 2 })} rounds={[waiting]} focused onChanged={() => {}} />);
  expect(screen.getByTestId("appeal-progress-a2").props.children).toBe("站梯走完 · 待终审");
  expect(screen.getByText("终审 · 梵蒂冈")).toBeTruthy();
  expect(screen.getByTestId("appeal-station-state-a2-3").props.children).toBe("待作出结论");
  expect(within(screen.getByTestId("appeal-station-a2-3")).getByText("◇")).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId("appeal-station-a2-3").props.style).backgroundColor).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId("appeal-station-a2-2").props.style).backgroundColor).toBeUndefined();
  expect(screen.queryByText("▪")).toBeNull();
});

it("U-4: a rejecting station ends the ladder — the stations after it say 不再审, not 'not reached'", () => {
  const cut = escalated([station(1, "主教区", "PASSED"), station(2, "总主教区", "REJECTED", "原判依据充分，维持。"), station(3, "梵蒂冈", "AHEAD", null, true)], {
    status: "UPHELD",
    workflow_status: "REJECTED",
    decision_note: "原判依据充分，维持。",
  });
  wrap(<AppealLine row={row({ rounds_used: 2 })} rounds={[cut]} focused onChanged={() => {}} />);
  expect(screen.getByTestId("appeal-station-state-a2-2").props.children).toBe("驳回 · 维持原判");
  expect(screen.getByTestId("appeal-station-state-a2-3").props.children).toBe("不再审");
  expect(within(screen.getByTestId("appeal-station-a2-3")).getByText("□")).toBeTruthy();
  expect(screen.queryByText("未到")).toBeNull();
  expect(screen.queryByTestId("appeal-progress-a2")).toBeNull();
});

it("U-5: the final judge's amendment: the final station says 已改判, the round 原判 → 新判 and its compensation", () => {
  const done = escalated([station(1, "主教区", "PASSED"), station(2, "梵蒂冈", "PASSED", "改判", true)], {
    status: "AMENDED",
    workflow_status: "COMPLETED",
    new_verdict: "PASSED",
    decision_note: "终审改判",
    compensations: [{ id: "c1", weight: 3, order: 1, description: "x" }],
  });
  wrap(<AppealLine row={row({ rounds_used: 2 })} rounds={[done]} focused onChanged={() => {}} />);
  expect(screen.getByTestId("appeal-station-state-a2-2").props.children).toBe("已改判");
  expect(screen.getByTestId("appeal-change-a2").props.children).toBe("不过 → 通过");
  expect(screen.getByText("第 1 站 · 功德 3")).toBeTruthy();
});

it("a round in the appeal flow names the flow and cannot be withdrawn", () => {
  const ladder = round({ id: "a2", round: 2, status: "IN_REVIEW", workflow: "w1", workflow_name: "申诉审判流程", workflow_status: "IN_PROGRESS" });
  wrap(<AppealLine row={row({ rounds_used: 2 })} rounds={[ladder]} focused onChanged={() => {}} />);
  expect(screen.getByTestId("appeal-ladder-a2").props.children).toBe("申诉流程 · 申诉审判流程");
  expect(screen.queryByTestId("appeal-withdraw-a2")).toBeNull();
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

it("a refused withdrawal (already decided / in the appeal flow) is said in words, not as the generic unknown-code line", async () => {
  stubApi({ "POST /me/judgment-appeals/a1/withdraw/": { status: 409, data: { code: "appeal_closed", detail: "This appeal is DECIDED." } } });
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ToastProvider>
          <NavigationContainer>
            <AppealLine row={row({ rounds_used: 1 })} rounds={[round()]} focused onChanged={() => {}} />
          </NavigationContainer>
        </ToastProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
  fireEvent.press(screen.getByTestId("appeal-withdraw-a1"));
  fireEvent.press(screen.getByTestId("appeal-withdraw-confirm"));
  const toast = await screen.findByTestId("toast");
  expect(toast.props.children).toBe(translate("zh-Hans", "appeals.refusal.appeal_closed"));
  expect(toast.props.children).not.toBe("appeals.refusal.appeal_closed");
  expect(toast.props.children).not.toContain("appeal_closed");
  expect(appealRefusalKey("ladder_running")).toBe("appeals.refusal.ladder_running");
  expect(translate("en", "appeals.refusal.ladder_running")).not.toBe("appeals.refusal.ladder_running");
  // 原审流程没走完(2026-10-29,审查 B):有自己的一句,中英都有。
  expect(appealRefusalKey("origin_flow_open")).toBe("appeals.refusal.origin_flow_open");
  for (const locale of ["zh-Hans", "en"] as const) {
    expect(translate(locale, "appeals.refusal.origin_flow_open")).not.toBe("appeals.refusal.origin_flow_open");
  }
});

it("the form refuses an empty reason locally, then sends the reason and goes back", async () => {
  const calls = stubApi({ "POST /me/judgment-appeals/": { status: 201, data: round() } });
  wrap(<JudgmentAppealScreen />);
  expect(screen.getByTestId("appeal-submit").props.accessibilityLabel).toBe("提交申诉");
  expect(screen.queryByTestId("appeal-escalate-last")).toBeNull();
  fireEvent.press(screen.getByTestId("appeal-submit"));
  expect(await screen.findByText("请写理由")).toBeTruthy();
  expect(calls).toEqual([]);
  fireEvent.changeText(screen.getByTestId("appeal-reason"), "证据有误");
  fireEvent.press(screen.getByTestId("appeal-submit"));
  await screen.findByTestId("appeal-submit");
  await new Promise((r) => setTimeout(r, 0));
  expect(calls[0]?.body).toEqual({ judgment: J, reason: "证据有误", evidence: "", escalate: false });
  expect(mockGoBack).toHaveBeenCalled();
});

it("roundsOf lists one judgment's rounds, newest first", () => {
  const list = { judgments: [], results: [round({ id: "a1", round: 1 }), round({ id: "x", judgment: "other" }), round({ id: "a2", round: 2 })] };
  expect(roundsOf(list as never, J).map((r) => r.id)).toEqual(["a2", "a1"]);
});
