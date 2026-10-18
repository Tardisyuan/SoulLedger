/**
 * 第四十三批 O-1 ~ O-4:待办里的「待我选站」一组、选站页(终审锁定、确认送什么、别人刚改过)、流程详情的分段与门口。
 * 服务端的 `hall` / `realm_name` 是租户展示名(库里的英文),夹具照实给英文:界面按租户代码读文明名与冥界名,
 * 一处都不能露出来(2026-10-19 模拟器上「埃及 · Egyptian Afterlife发起」「前面:Egyptian Afterlife 3 站」)。
 */
import type { LoginUser } from "@soulledger/core/api/auth";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { Detail } from "../screens/detail";
import { TodoTab } from "../screens/todo";
import { ToastProvider } from "../shared";
import { OFFICER, httpError, renderOfficer } from "./harness";

const mockTodo = jest.fn();
const mockItem = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: (...a: unknown[]) => mockTodo(...a), item: (...a: unknown[]) => mockItem(...a) },
}));
const mockGet = jest.fn();
const mockPick = jest.fn();
jest.mock("@soulledger/core/api/workflow", () => ({
  workflowApi: { get: (...a: unknown[]) => mockGet(...a), pickSegment: (...a: unknown[]) => mockPick(...a) },
}));

/** 埃及杜阿特的判官:外域那一段(第 2 段)是他的。 */
const EGYPT: LoginUser = { ...OFFICER, id: 9, tenant: { code: "EG_DUAT", display_name: "Egyptian Duat", civilization: "EGYPTIAN" } };

const group = (items: object[]) => ({ count: items.length, items });
const pickRow = (id: string, extra: object) => ({
  kind: "pick",
  id,
  title: id === "wf-1" ? "王守仁" : "李清照",
  created_at: "2026-10-09T01:00:00Z",
  target: { kind: "pick", id },
  segment_order: 2,
  go: 4,
  total: 4,
  realm: "CN_DIYU",
  hall: "Chinese Afterlife",
  court: "第十殿",
  ...extra,
});

const segment = (over: object) => ({
  is_local: false,
  civilization: "EGYPTIAN",
  name: "默认流程",
  picked_at: null,
  picked_by_name: null,
  at_gate: false,
  gate_days: null,
  no_picker: false,
  current_order_in_segment: null,
  can_pick: false,
  can_use_default: false,
  can_remind: false,
  ...over,
});
const node = (id: string, order: number, name: string, over: object = {}) => ({
  id,
  node_order: 10 + order,
  order_in_segment: order,
  segment_order: 2,
  node_name: name,
  status: "PENDING",
  skip_kind: null,
  is_required: false,
  court_code: "真理殿",
  approver_role: "JUDGE",
  decided_at: null,
  notes: "",
  ...over,
});
const WORKFLOW = {
  id: "wf-1",
  soul_name: "王守仁",
  status: "IN_PROGRESS",
  current_node: null,
  awaiting_segment: 2,
  can_adjust: false,
  segments: [
    segment({ order: 1, is_local: true, tenant_code: "CN_DIYU", realm_name: "Chinese Afterlife", civilization: "CHINESE", state: "DONE", go: 8, total: 10, default_node_count: 10, version: 1 }),
    segment({ order: 2, tenant_code: "EG_DUAT", realm_name: "Egyptian Afterlife", state: "AWAITING_PICK", go: 4, total: 4, default_node_count: 4, version: 5, at_gate: true, gate_days: 2, can_pick: true }),
  ],
  nodes: [
    node("c1", -9, "初审", { segment_order: 1, status: "APPROVED", order_in_segment: 1, node_order: 1 }),
    node("n1", 1, "入审"),
    node("n2", 2, "陪审"),
    node("n3", 3, "称心"),
    node("n4", 4, "终审", { is_required: true }),
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: WORKFLOW });
});

describe("O-1 · 待我选站 in the to-do list", () => {
  const DATA = {
    approvals: group([{ kind: "approval", id: "a1", title: "审批 · 甲", created_at: "2026-10-09T01:00:00Z", target: { kind: "approval", id: "a1" } }]),
    reassignments: group([]),
    cooldowns: group([]),
    rebirths: group([]),
    letters: group([]),
    pick_nodes: group([pickRow("wf-1", { gate_days: 2, stations_ahead: null }), pickRow("wf-2", { gate_days: null, stations_ahead: 6, court: "第三殿", segment_order: 3 })]),
  };

  it("is its own group above 审批节点, each row the soul and this realm's stations, who convened it, and the wait", async () => {
    mockTodo.mockResolvedValue({ data: DATA });
    const onOpen = jest.fn();
    renderOfficer(<TodoTab highlight={null} onOpen={onOpen} />);
    const pick = await screen.findByTestId("todo-group-pick");
    const ids = screen.getAllByTestId(/^todo-group-/).map((g) => g.props.testID);
    expect(ids.indexOf("todo-group-pick")).toBeLessThan(ids.indexOf("todo-group-approval"));
    expect(within(pick).getByText("待我选站 · 2")).toBeTruthy();
    expect(screen.getByTestId("todo-filter-pick").props.accessibilityLabel).toBe("待我选站 · 2");

    const gated = screen.getByTestId("todo-row-pick-wf-1");
    expect(within(gated).getByText("王守仁 · 本域 4 站")).toBeTruthy();
    expect(within(gated).getByText("中国 · 酆都第十殿发起 · 本域排第 2")).toBeTruthy();
    expect(within(gated).getByText("流程已在门口等 · 2 天")).toBeTruthy();
    expect(within(gated).queryByText(/前面还有/)).toBeNull();
    // A pick row has no time line and never prints the tenant code.
    expect(within(gated).queryByText(/CN_DIYU/)).toBeNull();
    expect(within(gated).queryByText(/Afterlife/)).toBeNull();

    const ahead = screen.getByTestId("todo-row-pick-wf-2");
    expect(within(ahead).getByText("前面还有 6 站")).toBeTruthy();
    expect(within(ahead).getByText("中国 · 酆都第三殿发起 · 本域排第 3")).toBeTruthy();
    expect(within(ahead).queryByText(/门口/)).toBeNull();

    fireEvent.press(gated);
    expect(onOpen).toHaveBeenCalledWith({ kind: "pick", id: "wf-1" });
  });

  it("an older server without the group draws nothing for it", async () => {
    const { pick_nodes: _drop, ...older } = DATA;
    mockTodo.mockResolvedValue({ data: older });
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    await screen.findByTestId("todo-group-approval");
    expect(screen.queryByTestId("todo-group-pick")).toBeNull();
  });
});

async function openPick(user: LoginUser = EGYPT) {
  const onBack = jest.fn();
  const onSettled = jest.fn();
  renderOfficer(
    <ToastProvider>
      <Detail target={{ type: "todo", kind: "pick", id: "wf-1" }} onBack={onBack} onSettled={onSettled} />
    </ToastProvider>,
    { user },
  );
  await screen.findByTestId("pick-stations");
  return { onBack, onSettled };
}

describe("O-2 · the pick page", () => {
  it("lists only this realm's stations, all ticked; the final is ticked, locked and says why", async () => {
    await openPick();
    expect(mockGet).toHaveBeenCalledWith("wf-1");
    expect(screen.getByTestId("pick-position").props.children).toBe("本域排第 2 · 前面:中国 8 站");
    expect(screen.queryByText(/Afterlife/)).toBeNull();
    expect(screen.getByTestId("pick-at-gate").props.children).toBe("流程已在门口等 · 2 天");
    for (const id of ["n1", "n2", "n3", "n4"]) expect(screen.getByTestId(`pick-station-${id}`).props.accessibilityState.checked).toBe(true);
    // The other realm's station is not on this page.
    expect(screen.queryByTestId("pick-station-c1")).toBeNull();

    const final = screen.getByTestId("pick-station-n4");
    expect(final.props.accessibilityState).toEqual({ checked: true, disabled: true });
    expect(final.props.accessibilityLabel).toBe("4 · 终审 · 必须走");
    expect(screen.getByTestId("pick-final-reason-n4").props.children).toBe("审判结果要由终审定下，这一站不能跳过。");
    // Only the final carries the reason; the others say hall · approver.
    expect(screen.queryByTestId("pick-final-reason-n2")).toBeNull();
    expect(screen.getAllByText("审判结果要由终审定下，这一站不能跳过。")).toHaveLength(1);

    fireEvent.press(final);
    expect(screen.getByTestId("pick-station-n4").props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("pick-summary").props.children).toBe("本域走 4 站 · 跳过 0 站");
    expect(screen.queryByTestId("pick-restore-all")).toBeNull();
  });

  it("unticking a station skips it; 全部恢复 ticks everything again; only the final left shows a note, not a block", async () => {
    await openPick();
    fireEvent.press(screen.getByTestId("pick-station-n2"));
    expect(screen.getByTestId("pick-station-n2").props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId("pick-summary").props.children).toBe("本域走 3 站 · 跳过 1 站");
    expect(screen.queryByTestId("pick-only-final")).toBeNull();
    fireEvent.press(screen.getByTestId("pick-station-n1"));
    fireEvent.press(screen.getByTestId("pick-station-n3"));
    expect(screen.getByTestId("pick-only-final")).toBeTruthy();
    expect(screen.getByTestId("pick-confirm").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByTestId("pick-restore-all"));
    expect(screen.getByTestId("pick-summary").props.children).toBe("本域走 4 站 · 跳过 0 站");
    expect(screen.queryByTestId("pick-only-final")).toBeNull();
  });

  it("确认 sends the unticked stations (never the final) with the version it loaded, then goes back and says so", async () => {
    mockPick.mockResolvedValue({ data: WORKFLOW });
    const { onBack, onSettled } = await openPick();
    fireEvent.press(screen.getByTestId("pick-station-n2"));
    await act(async () => fireEvent.press(screen.getByTestId("pick-confirm")));
    expect(mockPick).toHaveBeenCalledTimes(1);
    expect(mockPick).toHaveBeenCalledWith("wf-1", 2, { skip_node_ids: ["n2"], version: 5 });
    const body = mockPick.mock.calls[0][2] as { skip_node_ids: string[] };
    expect(body.skip_node_ids).not.toContain("n4");
    expect(body).not.toHaveProperty("reason");
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(onSettled).toHaveBeenCalled();
    expect(await screen.findByText("已选站 · 轮到本域时通知你")).toBeTruthy();
  });

  it("segment_changed: stops, says who changed it, and does not resend until the current selection is looked at", async () => {
    mockPick.mockRejectedValue(httpError(409, { code: "segment_changed", error: "x", changed_by: "孟婆", changed_at: "2026-10-18T02:00:00Z" }));
    const { onBack } = await openPick();
    await act(async () => fireEvent.press(screen.getByTestId("pick-confirm")));
    expect(await screen.findByTestId("pick-stale")).toBeTruthy();
    expect(screen.getByText("这一段刚被改过")).toBeTruthy();
    expect(String(screen.getByTestId("pick-stale-body").props.children)).toContain("孟婆");
    expect(screen.getByTestId("pick-confirm").props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByTestId("pick-failed")).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByText("已选站 · 轮到本域时通知你")).toBeNull();

    // 「看现在的选择」: the server's selection now (someone skipped 称心), ticked as stored.
    mockGet.mockResolvedValue({
      data: {
        ...WORKFLOW,
        segments: [WORKFLOW.segments[0], { ...WORKFLOW.segments[1], state: "PICKED", version: 6 }],
        nodes: WORKFLOW.nodes.map((n) => (n.id === "n3" ? { ...n, status: "SKIPPED", skip_kind: "AT_PICK" } : n)),
      },
    });
    await act(async () => fireEvent.press(screen.getByTestId("pick-stale-view")));
    await waitFor(() => expect(screen.getByTestId("pick-station-n3").props.accessibilityState.checked).toBe(false));
    expect(screen.queryByTestId("pick-stale")).toBeNull();
    expect(screen.getByTestId("pick-confirm").props.accessibilityState.disabled).toBe(false);
  });

  it("any other refusal is a plain failure, not the 刚被改过 notice", async () => {
    mockPick.mockRejectedValue(httpError(400, { code: "final_required", error: "x" }));
    const { onBack } = await openPick();
    await act(async () => fireEvent.press(screen.getByTestId("pick-confirm")));
    expect(await screen.findByTestId("pick-failed")).toBeTruthy();
    expect(screen.queryByTestId("pick-stale")).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("O-3 / O-4 · the workflow's segments in an approval detail", () => {
  const ITEM = {
    kind: "approval",
    id: "wf-1",
    title: "审批",
    created_at: "2026-10-09T01:00:00Z",
    actionable: false,
    state: "actionable",
    handled_by: null,
    handled_at: null,
    workflow_id: "wf-1",
    node_id: null,
  };
  const openApproval = async (user: LoginUser = OFFICER) => {
    mockItem.mockResolvedValue({ data: ITEM });
    renderOfficer(<Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={() => {}} />, { user });
    return screen.findByTestId("workflow-segments");
  };

  it("the convening realm sees 等待外域选站 with the realm and the day, never a name, and no pick button", async () => {
    await openApproval();
    expect(screen.getByTestId("segment-gate-title").props.children).toBe("◌ 等待外域选站 · 埃及 · 第 2 天");
    expect(screen.queryByText(/Afterlife/)).toBeNull();
    expect(screen.getByTestId("segment-gate-body").props.children).toBe("本域已走完。已提醒埃及判官，选好后自动继续。");
    expect(screen.queryByTestId("segment-gate-pick")).toBeNull();
    // A done realm keeps only its head until it is opened.
    expect(screen.getByTestId("segment-meta-1").props.children).toBe("8 / 10 站要走 · 已走完");
    expect(screen.queryByTestId("segment-node-c1")).toBeNull();
    fireEvent.press(screen.getByTestId("segment-head-1"));
    expect(screen.getByTestId("segment-node-c1")).toBeTruthy();
    // No 加减站 card for someone who may not change stations.
    expect(screen.queryByTestId("segment-adjust-desk")).toBeNull();
  });

  it("past three days it says 每天提醒一次", async () => {
    mockGet.mockResolvedValue({ data: { ...WORKFLOW, segments: [WORKFLOW.segments[0], { ...WORKFLOW.segments[1], gate_days: 4 }] } });
    await openApproval();
    expect(screen.getByTestId("segment-gate-body").props.children).toBe("每天提醒一次,埃及还没选。");
    expect(screen.queryByText(/已提醒埃及判官/)).toBeNull();
  });

  it("a realm with no one who can pick says so instead of counting days", async () => {
    mockGet.mockResolvedValue({ data: { ...WORKFLOW, segments: [WORKFLOW.segments[0], { ...WORKFLOW.segments[1], no_picker: true }] } });
    await openApproval();
    expect(screen.getByTestId("segment-gate-title").props.children).toBe("⚠︎ 埃及没有能选站的判官");
    expect(screen.queryByText(/第 2 天/)).toBeNull();
  });

  it("the waiting realm sees 流程在等本域选站 and 选站, which opens the pick page over the detail", async () => {
    await openApproval(EGYPT);
    expect(screen.getByTestId("segment-gate-title").props.children).toBe("◌ 流程在等本域选站");
    expect(screen.getByTestId("segment-gate-body").props.children).toBe("王守仁 · 中国的站已走完，选好本域这一段才能继续。");
    expect(screen.queryByText(/等待外域选站 · 埃及/)).toBeNull();
    fireEvent.press(screen.getByTestId("segment-gate-pick"));
    expect(await screen.findByTestId("pick-stations")).toBeTruthy();
  });

  it("加减站 is never done here: the card sends the officer to the computer", async () => {
    mockGet.mockResolvedValue({ data: { ...WORKFLOW, can_adjust: true } });
    await openApproval();
    const card = screen.getByTestId("segment-adjust-desk");
    expect(within(card).getByText("要写理由、逐站核对，请在电脑上做。")).toBeTruthy();
    expect(within(card).getByText("在电脑上继续")).toBeTruthy();
  });

  it("a workflow without segments draws none of this", async () => {
    mockGet.mockResolvedValue({ data: { ...WORKFLOW, segments: [], awaiting_segment: null } });
    mockItem.mockResolvedValue({ data: ITEM });
    renderOfficer(<Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={() => {}} />);
    await screen.findByTestId("todo-detail");
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByTestId("workflow-segments")).toBeNull();
    expect(screen.queryByTestId("segment-gate")).toBeNull();
  });
});
