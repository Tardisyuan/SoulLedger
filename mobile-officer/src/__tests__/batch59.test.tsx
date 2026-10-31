/**
 * 第五十九批(官员 App M-1 ~ M-6):审判详情的罪目与审批流程一块、灵魂详情的服刑一行与期满释放、
 * 待办里的「枉死申诉」一组与它的审核页、没有城隍时的 toast。
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import * as rules from "../rules";
import { TODO_GROUPS, deskPath, isTodoKind } from "../rules";
import { JudgmentFlowBlock, flowWaitingText } from "../screens/judgmentFlow";
import { ServingFact, defaultTermOf, servingOf } from "../screens/servingFact";
import { TodoTab } from "../screens/todo";
import { WangsiReview, wangsiMode } from "../screens/wangsi";
import { OnlineContext } from "../../../mobile/src/online";
import { ToastProvider, translate } from "../shared";
import { OFFICER, httpError, renderOfficer } from "./harness";

// Flush the updates a confirm leaves in flight before the test ends (act warnings otherwise). The sheet double in
// jest.setup.js closes synchronously, so there is nothing to wait out in real time.
const settleSheet = () => act(async () => {});

const mockJudgment = jest.fn();
const mockUpdate = jest.fn();
const mockDecide = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: { get: (...a: unknown[]) => mockJudgment(...a), update: (...a: unknown[]) => mockUpdate(...a) },
  wangsiApi: { decideGrievance: (...a: unknown[]) => mockDecide(...a) },
}));
const mockDispositions = jest.fn();
const mockRelease = jest.fn();
jest.mock("@soulledger/core/api/disposition", () => ({
  ...jest.requireActual("@soulledger/core/api/disposition"),
  dispositionApi: { list: (...a: unknown[]) => mockDispositions(...a), release: (...a: unknown[]) => mockRelease(...a) },
}));
const mockTodo = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: (...a: unknown[]) => mockTodo(...a), todoGroup: jest.fn() },
}));

const FUTURE = "2999-11-03";
const PAST = "2001-01-01";
const CASE = {
  id: "j-1",
  case_number: "CN-2026-0061",
  soul: "s-1",
  soul_name: "钱谦益",
  city_god_name: "常熟县城隍",
  city_god_status: "SENT_ON",
  untimely: true,
  held_until: FUTURE,
  wrongful_death_cause: "VICTIM",
  grievance_level: "MAJOR",
  grievance_status: "FILED",
  grievance_plea: "死于他人设局，非寿数当尽，请查。",
  verdict: null,
  is_final: false,
};
const judge = (over: Record<string, unknown> = {}) => mockJudgment.mockResolvedValue({ data: { ...CASE, ...over } });
const disabled = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.disabled;

beforeEach(() => {
  jest.clearAllMocks();
});

// ── M-3:待办分组 ─────────────────────────────────────────────────────────

describe("枉死申诉 in 待我处理", () => {
  it("is its own kind, drawn first (above 城隍初审), and links to the judgment on the desk", () => {
    expect(TODO_GROUPS[0]).toEqual({ field: "wangsi", kind: "wangsi", label: "officer_app.todo.groups.wangsi" });
    expect(TODO_GROUPS[1].kind).toBe("city_god");
    expect(isTodoKind("wangsi")).toBe(true);
    expect(deskPath({ kind: "wangsi", id: "j-1" })).toBe("/judgment/j-1");
  });

  it("a row reads 城隍 · 冤情 等级, then 已申诉 · 待审 · 月-日", async () => {
    const empty = { count: 0, items: [] };
    mockTodo.mockResolvedValue({
      data: {
        approvals: empty, reassignments: empty, cooldowns: empty, rebirths: empty, letters: empty, sentence_changes: empty,
        unassigned_letters: empty, pick_nodes: empty, city_god: empty,
        wangsi: {
          count: 1,
          items: [{ kind: "wangsi", id: "j-1", title: "钱谦益", created_at: "2026-10-27T03:00:00Z", target: { kind: "wangsi", id: "j-1" }, city_god_name: "常熟县城隍", grievance_level: "MAJOR" }],
        },
      },
    });
    const open = jest.fn();
    renderOfficer(<TodoTab onOpen={open} highlight={null} />);
    expect(await screen.findByText("枉死申诉 · 1")).toBeTruthy();
    expect(screen.getByText("常熟县城隍 · 冤情 重")).toBeTruthy();
    expect(screen.getByText("已申诉 · 待审 · 10-27")).toBeTruthy();
    fireEvent.press(screen.getByTestId("todo-row-wangsi-j-1"));
    expect(open).toHaveBeenCalledWith({ kind: "wangsi", id: "j-1" });
  });
});

// ── M-4 / M-4b / M-5:审核页 ─────────────────────────────────────────────

describe("wangsiMode", () => {
  it("held while the fated day is ahead; late after it or once concluded; none without a filed grievance", () => {
    expect(wangsiMode({ grievance_status: "FILED", held_until: FUTURE, verdict: null, is_final: false })).toBe("held");
    expect(wangsiMode({ grievance_status: "FILED", held_until: PAST, verdict: null, is_final: false })).toBe("late");
    expect(wangsiMode({ grievance_status: "FILED", held_until: FUTURE, verdict: null, is_final: true })).toBe("late");
    expect(wangsiMode({ grievance_status: "REJECTED", held_until: FUTURE, verdict: null, is_final: false })).toBe("none");
  });

  it("the server's wangsi_held wins over the phone's date, both ways (客户端审查 #12)", () => {
    expect(wangsiMode({ grievance_status: "FILED", held_until: PAST, wangsi_held: true, verdict: null, is_final: false })).toBe("held");
    expect(wangsiMode({ grievance_status: "FILED", held_until: FUTURE, wangsi_held: false, verdict: null, is_final: false })).toBe("late");
  });
});

describe("枉死申诉 review", () => {
  const review = () => renderOfficer(<WangsiReview id="j-1" onSettled={jest.fn()} onDone={jest.fn()} />);

  it("重: three actions, each needing a note; the release confirms first and sends upheld without deliver", async () => {
    judge();
    mockDecide.mockResolvedValue({ data: {} });
    review();
    expect(await screen.findByText("枉死申诉 · 钱谦益")).toBeTruthy();
    expect(screen.getByTestId("wangsi-plea")).toBeTruthy();
    expect(disabled("wangsi-uphold")).toBe(true); // no note yet
    expect(screen.queryByTestId("wangsi-release-gate")).toBeNull();
    expect(screen.queryByTestId("wangsi-uphold-late")).toBeNull();
    fireEvent.changeText(screen.getByTestId("wangsi-note"), "  查实  ");
    expect(disabled("wangsi-uphold")).toBe(false);
    fireEvent.press(screen.getByTestId("wangsi-uphold"));
    expect(mockDecide).not.toHaveBeenCalled(); // the sheet first
    expect(screen.getByText("提前释放钱谦益？")).toBeTruthy();
    fireEvent.press(screen.getByTestId("wangsi-confirm"));
    await waitFor(() => expect(mockDecide).toHaveBeenCalledWith("j-1", true, "查实", false));
    await settleSheet();
  });

  it("超度 confirms with the 'still at the city god' line and sends deliver", async () => {
    judge({ city_god_status: "PENDING" });
    mockDecide.mockResolvedValue({ data: {} });
    review();
    fireEvent.changeText(await screen.findByTestId("wangsi-note"), "查实");
    fireEvent.press(screen.getByTestId("wangsi-deliver"));
    expect(screen.getByText("超度钱谦益？")).toBeTruthy();
    expect(screen.getByTestId("wangsi-sends-on")).toBeTruthy();
    fireEvent.press(screen.getByTestId("wangsi-confirm"));
    await waitFor(() => expect(mockDecide).toHaveBeenCalledWith("j-1", true, "查实", true));
    await settleSheet();
  });

  it("轻: both 属实 are greyed with the reason between them; 不属实 still goes", async () => {
    judge({ grievance_level: "MINOR" });
    mockDecide.mockResolvedValue({ data: {} });
    review();
    fireEvent.changeText(await screen.findByTestId("wangsi-note"), "不实");
    expect(disabled("wangsi-uphold")).toBe(true);
    expect(disabled("wangsi-deliver")).toBe(true);
    expect(screen.getByTestId("wangsi-release-gate")).toBeTruthy();
    fireEvent.press(screen.getByTestId("wangsi-reject"));
    await waitFor(() => expect(mockDecide).toHaveBeenCalledWith("j-1", false, "不实", false));
  });

  it("the level is changed here through the judgment's PATCH", async () => {
    judge({ grievance_level: "MINOR" });
    mockUpdate.mockResolvedValue({ data: {} });
    review();
    fireEvent.press(await screen.findByTestId("wangsi-level-SEVERE"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("j-1", { grievance_level: "SEVERE" }));
  });

  // 官员 6(2026-10-29):四选一的等级是 radiogroup / radio + checked,不是 tablist / tab + selected。
  it("the four-way level is a radio group, its segments radios checked by value", async () => {
    judge({ grievance_level: "MAJOR" });
    review();
    const group = await screen.findByTestId("wangsi-level");
    expect(group.props.accessibilityRole).toBe("radiogroup");
    const major = screen.getByTestId("wangsi-level-MAJOR");
    expect(major.props.accessibilityRole).toBe("radio");
    expect(major.props.accessibilityState).toMatchObject({ checked: true });
    expect(major.props.accessibilityState.selected).toBeUndefined();
    expect(screen.getByTestId("wangsi-level-MINOR").props.accessibilityState).toMatchObject({ checked: false });
  });

  // 华为真机 10-29 第二轮: the greyed buttons gave no reason, and the level saved on a tap with no word.
  it("an empty note says why the three are grey, and the line goes once a note is written", async () => {
    judge();
    review();
    expect(await screen.findByText("先写审核意见")).toBeTruthy();
    expect(disabled("wangsi-reject")).toBe(true);
    fireEvent.changeText(screen.getByTestId("wangsi-note"), "   ");
    expect(screen.getByTestId("wangsi-note-required")).toBeTruthy(); // blanks are still empty
    fireEvent.changeText(screen.getByTestId("wangsi-note"), "查实");
    expect(screen.queryByTestId("wangsi-note-required")).toBeNull();
    expect(disabled("wangsi-reject")).toBe(false);
  });

  it("the four-way level says a tap saves it; read-only and decided cases do not", async () => {
    judge();
    const first = review();
    expect(await screen.findByText("点选即保存")).toBeTruthy();
    first.unmount();
    judge({ grievance_status: "REJECTED" });
    review();
    expect(await screen.findByTestId("wangsi-status")).toBeTruthy();
    expect(screen.queryByTestId("wangsi-level-saves")).toBeNull();
    expect(screen.queryByTestId("wangsi-note-required")).toBeNull();
  });

  it("the release gate's sentence uses full-width punctuation", async () => {
    judge({ grievance_level: "MINOR" });
    review();
    expect(await screen.findByText("冤情等级为「重」或「极重」时，属实即提前释放。")).toBeTruthy();
  });

  it("阳寿已到: only 不属实 / 属实(只记结论), under the late hint; no release, no 超度", async () => {
    judge({ held_until: PAST, grievance_level: "MINOR" });
    mockDecide.mockResolvedValue({ data: {} });
    review();
    expect(await screen.findByTestId("wangsi-late-hint")).toBeTruthy();
    expect(screen.queryByTestId("wangsi-uphold")).toBeNull();
    expect(screen.queryByTestId("wangsi-deliver")).toBeNull();
    fireEvent.changeText(screen.getByTestId("wangsi-note"), "查实");
    fireEvent.press(screen.getByTestId("wangsi-uphold-late"));
    await waitFor(() => expect(mockDecide).toHaveBeenCalledWith("j-1", true, "查实", false));
  });

  it("a refusal is written out in the desk's words", async () => {
    judge();
    mockDecide.mockRejectedValue(httpError(403, { code: "not_city_god_officer" }));
    review();
    fireEvent.changeText(await screen.findByTestId("wangsi-note"), "不实");
    fireEvent.press(screen.getByTestId("wangsi-reject"));
    expect(await screen.findByText("只有这位城隍名下的官员或殿管理员能审核。")).toBeTruthy();
  });

  it("the held day is written out, not the ISO value", async () => {
    judge({ wangsi_held: true });
    review();
    const held = await screen.findByTestId("wangsi-held");
    expect(held.props.children).toContain("2999年 · 11月3日");
    expect(held.props.children).not.toContain(FUTURE);
  });

  it("offline: no decision and no level change, and the reason is written (客户端审查 #11)", async () => {
    judge({ wangsi_held: true });
    renderOfficer(
      <OnlineContext.Provider value={{ offline: true, back: 0 }}>
        <WangsiReview id="j-1" onSettled={jest.fn()} onDone={jest.fn()} />
      </OnlineContext.Provider>
    );
    fireEvent.changeText(await screen.findByTestId("wangsi-note"), "不实");
    expect(screen.getByTestId("wangsi-offline").props.children).toBe(translate("zh-Hans", "officer_app.offline.no_decide"));
    expect(disabled("wangsi-reject")).toBe(true);
    expect(disabled("wangsi-uphold")).toBe(true);
    expect(disabled("wangsi-level-MINOR")).toBe(true);
    fireEvent.press(screen.getByTestId("wangsi-level-MINOR"));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("online: the same screen has no offline line and the actions are live once a note is written", async () => {
    judge({ wangsi_held: true });
    review();
    fireEvent.changeText(await screen.findByTestId("wangsi-note"), "不实");
    expect(screen.queryByTestId("wangsi-offline")).toBeNull();
    expect(disabled("wangsi-reject")).toBeFalsy();
    expect(disabled("wangsi-level-MINOR")).toBeFalsy();
  });

  it("already decided: the status, no actions", async () => {
    judge({ grievance_status: "REJECTED" });
    review();
    expect(await screen.findByTestId("wangsi-status")).toBeTruthy();
    expect(screen.queryByTestId("wangsi-reject")).toBeNull();
    expect(screen.queryByTestId("wangsi-level")).toBeNull();
  });
});

// ── M-6 ─────────────────────────────────────────────────────────────────

describe("no_city_god is gone from the grievance review (2026-10-29)", () => {
  it("rules no longer carries the branch", () => {
    expect("noCityGod" in rules).toBe(false);
  });

  it("an unexpected no_city_god reads as the generic inline refusal, never the city-god toast", async () => {
    judge();
    mockDecide.mockRejectedValue(httpError(409, { code: "no_city_god" }));
    renderOfficer(
      <ToastProvider>
        <WangsiReview id="j-1" onSettled={jest.fn()} onDone={jest.fn()} />
      </ToastProvider>
    );
    fireEvent.changeText(await screen.findByTestId("wangsi-note"), "不实");
    fireEvent.press(screen.getByTestId("wangsi-reject"));
    expect(await screen.findByTestId("wangsi-failure")).toBeTruthy();
    expect(screen.queryByText("本殿没有可收案的城隍，先在城隍管理里设一位兜底城隍。")).toBeNull();
  });
});

// ── M-1:审判详情 ───────────────────────────────────────────────────────

describe("judgment flow block (M-1)", () => {
  it("罪目 · 杀人 with the court it goes to; the flow's station and why it cannot execute; no execute button", () => {
    const open = jest.fn();
    renderOfficer(
      <JudgmentFlowBlock
        data={{ ...CASE, offence: "MURDER", flow_progress: { workflow: "wf-1", status: "IN_PROGRESS", index: 3, total: 5, waiting: "approval_in_progress" } } as never}
        onOpenFlow={open}
      />
    );
    expect(screen.getByText("罪目 · 杀人")).toBeTruthy();
    expect(screen.getByText("判有罪时送 第九殿 · 平等王")).toBeTruthy();
    expect(screen.getByText("◇ 审批流程 · 第 3 / 5 站")).toBeTruthy();
    expect(screen.getByText("审批流程还没走完：走完之后才能执行。")).toBeTruthy();
    expect(screen.queryByText(/执行$/)).toBeNull();
    fireEvent.press(screen.getByTestId("judgment-flow-open"));
    expect(open).toHaveBeenCalledWith("wf-1");
  });

  it("a rejected flow says so instead; a finished one draws nothing", () => {
    const first = renderOfficer(
      <JudgmentFlowBlock data={{ ...CASE, flow_progress: { workflow: "wf-1", status: "REJECTED", index: 2, total: 5, waiting: "approval_rejected" } } as never} />
    );
    expect(screen.getByText("审批流程被驳回：这件案子要重开或申诉，不能直接执行。")).toBeTruthy();
    expect(screen.queryByText("审批流程还没走完：走完之后才能执行。")).toBeNull();
    first.unmount();
    renderOfficer(<JudgmentFlowBlock data={{ ...CASE, flow_progress: { workflow: "wf-1", status: "COMPLETED", index: 5, total: 5, waiting: null } } as never} />);
    expect(screen.queryByTestId("judgment-flow")).toBeNull();
  });

  it("maps the weighing codes to their own words and unknown ones to nothing", () => {
    const t = (k: string) => k;
    expect(flowWaitingText("weighing_rejected", t)).toBe("judgment.weighing.errors.weighing_rejected");
    expect(flowWaitingText("approval_in_progress", t)).toBe("disposition.flow_waiting.approval_in_progress");
    expect(flowWaitingText("weird", t)).toBeNull();
    expect(flowWaitingText(null, t)).toBeNull();
  });
});

// ── M-2 / M-2b:服刑一行 ─────────────────────────────────────────────────

describe("serving (M-2 / M-2b)", () => {
  const SERVING = {
    id: "d-1",
    is_executed: true,
    expired_at: null,
    is_eternal: false,
    term_end: { year: 2066, month: 10, day: 29 },
    sentence_years: 40,
    default_term_years: 40,
    can_release: false,
  };
  const withPerms = (permissions: string[]) => ({ user: { ...OFFICER, permissions } });

  it("servingOf / defaultTermOf", () => {
    expect(servingOf([{ ...SERVING, is_eternal: true }, SERVING] as never)?.id).toBe("d-1");
    expect(servingOf([{ ...SERVING, expired_at: "x" }] as never)).toBeNull();
    expect(defaultTermOf(SERVING as never)).toBe(40);
    expect(defaultTermOf({ ...SERVING, sentence_years: 30 } as never)).toBeNull();
  });

  it("serving: 服刑中 · 至 date and 默认 N 年, no button", async () => {
    mockDispositions.mockResolvedValue({ data: { results: [SERVING], count: 1, next: null } });
    renderOfficer(<ServingFact soulId="s-1" />, withPerms(["disposition.read", "disposition.execute"]));
    expect(await screen.findByTestId("soul-serving-line")).toBeTruthy();
    expect(mockDispositions).toHaveBeenCalledWith({ soul: "s-1", section: "executing" });
    expect(screen.getByTestId("soul-serving-line").props.children).toContain("服刑中");
    expect(screen.getByText("默认 40 年")).toBeTruthy();
    expect(screen.queryByTestId("soul-release")).toBeNull();
  });

  it("due: 刑期已满 · date, 期满释放 confirms first, then releases", async () => {
    mockDispositions.mockResolvedValue({ data: { results: [{ ...SERVING, can_release: true, sentence_years: 30 }], count: 1, next: null } });
    mockRelease.mockResolvedValue({ data: {} });
    renderOfficer(<ServingFact soulId="s-1" />, withPerms(["disposition.read", "disposition.execute"]));
    expect(await screen.findByTestId("soul-release")).toBeTruthy();
    expect(screen.getByTestId("soul-serving-line").props.children).toContain("刑期已满");
    expect(screen.queryByTestId("soul-serving-default")).toBeNull();
    fireEvent.press(screen.getByTestId("soul-release"));
    expect(mockRelease).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("soul-release-confirm"));
    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith("d-1"));
    await settleSheet();
  });

  it("offline: 期满释放 is greyed with the reason beneath, and pressing it opens nothing (客户端审查 #11)", async () => {
    mockDispositions.mockResolvedValue({ data: { results: [{ ...SERVING, can_release: true }], count: 1, next: null } });
    renderOfficer(
      <OnlineContext.Provider value={{ offline: true, back: 0 }}>
        <ServingFact soulId="s-1" />
      </OnlineContext.Provider>,
      withPerms(["disposition.read", "disposition.execute"])
    );
    expect(await screen.findByTestId("soul-release")).toBeTruthy();
    expect(disabled("soul-release")).toBe(true);
    expect(screen.getByTestId("soul-release-offline")).toBeTruthy();
    fireEvent.press(screen.getByTestId("soul-release"));
    expect(screen.queryByTestId("soul-release-confirm")).toBeNull();
  });

  it("a release that fails for another reason says 释放失败, not the execute sentence (客户端审查 #30)", async () => {
    mockDispositions.mockResolvedValue({ data: { results: [{ ...SERVING, can_release: true }], count: 1, next: null } });
    mockRelease.mockRejectedValue(httpError(500, {}));
    renderOfficer(
      <ToastProvider>
        <ServingFact soulId="s-1" />
      </ToastProvider>,
      withPerms(["disposition.read", "disposition.execute"])
    );
    fireEvent.press(await screen.findByTestId("soul-release"));
    fireEvent.press(screen.getByTestId("soul-release-confirm"));
    expect(await screen.findByText(translate("zh-Hans", "disposition.release_error.generic"))).toBeTruthy();
    expect(screen.queryByText(translate("zh-Hans", "disposition.execute_error"))).toBeNull();
    await settleSheet();
  });

  it("due but without disposition.execute: the line, no button; without disposition.read: nothing is asked", async () => {
    mockDispositions.mockResolvedValue({ data: { results: [{ ...SERVING, can_release: true }], count: 1, next: null } });
    const first = renderOfficer(<ServingFact soulId="s-1" />, withPerms(["disposition.read"]));
    expect(await screen.findByTestId("soul-serving-line")).toBeTruthy();
    expect(screen.queryByTestId("soul-release")).toBeNull();
    first.unmount();
    mockDispositions.mockClear();
    renderOfficer(<ServingFact soulId="s-1" />, withPerms([]));
    expect(screen.queryByTestId("soul-serving")).toBeNull();
    expect(mockDispositions).not.toHaveBeenCalled();
  });
});
