/**
 * 第四十三批:审批流程的选站与按域分段(网页 W-1 ~ W-5)。
 *
 * - 选站列表:终审那一行勾灰、点不动;只剩终审时出提示条,勾回任一站就消失;有取消才有「全部恢复」。
 * - 门口那一块:召集这边写第几天,满 3 天后换成「每天提醒一次」;「按默认流程走」只在服务端说能的时候出现;
 *   该域没有能选站的人时只写那一句、不给「再提醒一次」;外域自己看到的是「流程在等本域选站」。
 * - 加减站:当前站与之前折成「不能改」,终审勾灰;行尾只标这次的变化;理由空着不能保存;
 *   别人刚改过(409 `segment_changed`)时拦下、写谁几点改的,不报错误 toast、不覆盖。
 * - 审批页「待我选站」:在门口的一行写「已在门口等 · N 天」并加粗,没到门口的写前面还有几站;空组不画。
 * - 历史句子:加回 / 跳过为空时去掉那一半句,不写「无」。
 * - 域按 `tenant_code` 读:分段与门口写文明名(埃及),「待我选站」的发起殿写冥界名 + 殿(酆都第十殿);不印服务端的
 *   `realm_name` / `hall` —— 那是租户展示名,库里的英文(2026-10-19 模拟器上「埃及 · Egyptian Afterlife发起」)。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { ApprovalNode, ApprovalWorkflow, WorkflowHistoryEntry, WorkflowSegment } from "@soulledger/core/api";
import { StationPicker, type PickRow } from "@/src/components/workflow/segments/StationPicker";
import { WorkflowGateBanner } from "@/src/components/workflow/segments/WorkflowGateBanner";
import { AdjustStationsSheet } from "@/src/components/workflow/segments/AdjustStationsSheet";
import { PickNodesGroup } from "@/src/components/workflow/segments/PickNodesGroup";
import { historyLine } from "@/src/components/workflow/segments/WorkflowSegmentHistory";
import { WorkflowInspector, WorkflowReadOnlyList } from "@/src/components/workflow/WorkflowEditorPanels";
import type { NodeRole } from "@/src/components/workflow/workflowValidation";
import type { Node as FlowNode } from "@xyflow/react";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  workflowApi: {
    get: jest.fn(),
    adjust: jest.fn(),
    pickSegment: jest.fn(),
    remindSegment: jest.fn(),
    useDefault: jest.fn(),
  },
  officerAppApi: { todo: jest.fn() },
}));
const { workflowApi, officerAppApi } = jest.requireMock("@soulledger/core/api") as {
  workflowApi: Record<"get" | "adjust" | "pickSegment" | "remindSegment" | "useDefault", jest.Mock>;
  officerAppApi: { todo: jest.Mock };
};
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: tZh,
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => `@${v}`,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => jest.clearAllMocks());

// ── 选站列表 ────────────────────────────────────────────────────────────

const ROWS: PickRow[] = [
  { key: "1", label: "1 · 分流", hall: "一殿", who: "秦广王", required: false },
  { key: "2", label: "2 · 复核", hall: "三殿", who: "宋帝王", required: false },
  { key: "3", label: "3 · 终审", hall: "十殿", who: "转轮王", required: true },
];

function Picker({ onChange = () => {} }: { onChange?: (_next: Set<string>) => void }) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  return (
    <StationPicker
      flowName="十殿审判流程"
      rows={ROWS}
      skipped={skipped}
      onChange={(next) => {
        onChange(next);
        setSkipped(next);
      }}
      foreign={[{ order: 2, tenant_code: "EG_DUAT", realm_name: "Egyptian Afterlife", default_node_count: 4 }]}
    />
  );
}

describe("选站列表(W-1a / W-1b)", () => {
  it("终审那一行勾着、点不动,理由写在站名下;别的站可以取消", () => {
    const onChange = jest.fn();
    render(<Picker onChange={onChange} />);
    const final = screen.getByRole("checkbox", { name: /3 · 终审/ });
    expect(final).toBeChecked();
    expect(final).toBeDisabled();
    fireEvent.click(final);
    expect(final).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(tZh("workflow.pick.final_reason"))).toBeInTheDocument();

    const first = screen.getByRole("checkbox", { name: /1 · 分流/ });
    expect(first).toBeEnabled();
    fireEvent.click(first);
    expect(first).not.toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith(new Set(["1"]));
    expect(screen.getByTestId("pick-summary")).toHaveTextContent(tZh("workflow.pick.summary", { go: "2", skip: "1" }));
  });

  it("外域只读:只写由该域判官选站与默认站数,不列它的站", () => {
    render(<Picker />);
    const foreign = screen.getByTestId("picker-foreign");
    expect(foreign).toHaveTextContent("埃及");
    expect(foreign).not.toHaveTextContent("Egyptian Afterlife");
    expect(foreign).toHaveTextContent(tZh("workflow.pick.foreign_by_realm"));
    expect(foreign).toHaveTextContent(tZh("workflow.pick.foreign_default", { n: "4" }));
    expect(within(foreign).queryByRole("checkbox")).toBeNull();
  });

  it("全部取消只剩终审时出提示条(不拦);勾回一站就消失;「全部恢复」只在有取消时出现", () => {
    render(<Picker />);
    expect(screen.queryByTestId("only-final")).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("workflow.pick.restore_all") })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /1 · 分流/ }));
    expect(screen.queryByTestId("only-final")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /2 · 复核/ }));
    expect(screen.getByTestId("only-final")).toHaveTextContent(tZh("workflow.pick.only_final_title"));
    expect(screen.getByTestId("only-final")).toHaveTextContent(
      tZh("workflow.pick.only_final_body", { n: "2", hall: "十殿", approver: "转轮王" })
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /2 · 复核/ }));
    expect(screen.queryByTestId("only-final")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: tZh("workflow.pick.restore_all") }));
    expect(screen.getByRole("checkbox", { name: /1 · 分流/ })).toBeChecked();
    expect(screen.queryByRole("button", { name: tZh("workflow.pick.restore_all") })).toBeNull();
  });
});

// ── 门口那一块 ──────────────────────────────────────────────────────────

const segment = (over: Partial<WorkflowSegment> = {}): WorkflowSegment => ({
  order: 2,
  is_local: false,
  tenant_code: "EG_DUAT",
  // 服务端给的是租户展示名(库里的英文);界面应读 `tenant_code` 的冥界名。
  realm_name: "Egyptian Afterlife",
  civilization: "EGYPTIAN",
  name: "称心流程",
  state: "AWAITING_PICK",
  go: 4,
  total: 4,
  default_node_count: 4,
  version: 1,
  picked_at: null,
  picked_by_name: null,
  at_gate: true,
  gate_days: 2,
  no_picker: false,
  current_order_in_segment: null,
  can_pick: false,
  can_use_default: false,
  can_remind: true,
  ...over,
});

const local = segment({ order: 1, is_local: true, tenant_code: "CN_DIYU", realm_name: "Chinese Afterlife", state: "DONE", at_gate: false, gate_days: null });

const workflowWith = (segments: WorkflowSegment[], nodes: ApprovalNode[] = [], over: Partial<ApprovalWorkflow> = {}) =>
  ({ id: "wf-1", soul: "s-1", soul_name: "王守仁", status: "IN_PROGRESS", segments, nodes, current_node: null, ...over }) as unknown as ApprovalWorkflow;

describe("门口那一块(W-5a/b/c)", () => {
  it("召集这边第 2 天:写第几天与「已提醒」那句;不写外域判官的名字;不能用默认流程时不给那个键", () => {
    const seg = segment({ picked_by_name: "某判官" });
    wrap(<WorkflowGateBanner workflow={workflowWith([local, seg])} segment={seg} myTenant="CN_DIYU" />);
    const banner = screen.getByTestId("gate-banner");
    expect(banner).toHaveTextContent(tZh("workflow.gate.waiting_title", { realm: "埃及", n: "2" }));
    expect(banner).toHaveTextContent(tZh("workflow.gate.waiting_body", { realm: "埃及" }));
    expect(banner).not.toHaveTextContent(tZh("workflow.gate.overdue_body", { realm: "埃及" }));
    expect(banner).not.toHaveTextContent("某判官");
    expect(banner).not.toHaveTextContent("Egyptian Afterlife");
    expect(screen.getByRole("button", { name: tZh("workflow.gate.remind_again") })).toBeEnabled();
    expect(screen.queryByRole("button", { name: tZh("workflow.gate.use_default") })).toBeNull();
  });

  it("满 3 天后换成「每天提醒一次」,召集殿管理员能按默认流程走(理由必填)", async () => {
    const seg = segment({ gate_days: 4, can_use_default: true });
    workflowApi.useDefault.mockResolvedValue({ data: workflowWith([local, { ...seg, state: "PICKED", at_gate: false }]) });
    wrap(<WorkflowGateBanner workflow={workflowWith([local, seg])} segment={seg} myTenant="CN_DIYU" />);
    expect(screen.getByTestId("gate-banner")).toHaveTextContent(tZh("workflow.gate.overdue_body", { realm: "埃及" }));
    expect(screen.getByTestId("gate-banner")).not.toHaveTextContent(tZh("workflow.gate.waiting_body", { realm: "埃及" }));
    fireEvent.click(screen.getByRole("button", { name: tZh("workflow.gate.use_default") }));
    const confirm = (await screen.findAllByRole("button", { name: tZh("workflow.gate.use_default") })).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(tZh("workflow.adjust.reason"), { exact: false }), { target: { value: "  逾期  " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(workflowApi.useDefault).toHaveBeenCalledWith("wf-1", 2, { reason: "逾期" }));
  });

  it("太快再提醒(429 remind_too_soon):说一小时内已提醒过,键变成「已提醒」", async () => {
    const seg = segment();
    workflowApi.remindSegment.mockRejectedValue({ response: { status: 429, data: { code: "remind_too_soon", retry_after: 1200 } } });
    wrap(<WorkflowGateBanner workflow={workflowWith([local, seg])} segment={seg} myTenant="CN_DIYU" />);
    fireEvent.click(screen.getByRole("button", { name: tZh("workflow.gate.remind_again") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("workflow.gate.remind_too_soon"), "error"));
    expect(screen.getByRole("button", { name: tZh("workflow.gate.reminded") })).toBeDisabled();
  });

  it("该域没有能选站的人:只写那一句,不给「再提醒一次」", () => {
    const seg = segment({ no_picker: true, can_use_default: true });
    wrap(<WorkflowGateBanner workflow={workflowWith([local, seg])} segment={seg} myTenant="CN_DIYU" />);
    expect(screen.getByTestId("gate-banner")).toHaveTextContent(tZh("workflow.gate.no_picker_title", { realm: "埃及" }));
    expect(screen.queryByRole("button", { name: tZh("workflow.gate.remind_again") })).toBeNull();
    expect(screen.getByRole("button", { name: tZh("workflow.gate.use_default") })).toBeInTheDocument();
  });

  it("外域自己看到的是「流程在等本域选站」与「选站」,不是召集这边的那几句", () => {
    const seg = segment({ can_pick: true, can_remind: false });
    wrap(<WorkflowGateBanner workflow={workflowWith([local, seg])} segment={seg} myTenant="EG_DUAT" />);
    const banner = screen.getByTestId("gate-banner");
    expect(banner).toHaveTextContent(tZh("workflow.gate.foreign_title"));
    expect(banner).toHaveTextContent(tZh("workflow.gate.foreign_body", { soul: "王守仁", realm: "中国" }));
    expect(banner).not.toHaveTextContent("Chinese Afterlife");
    expect(banner).not.toHaveTextContent(tZh("workflow.gate.waiting_body", { realm: "埃及" }));
    expect(screen.getByRole("button", { name: tZh("workflow.pick_group.action") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: tZh("workflow.gate.remind_again") })).toBeNull();
  });
});

// ── 加减站 ──────────────────────────────────────────────────────────────

const node = (n: number, over: Partial<ApprovalNode> = {}): ApprovalNode =>
  ({
    id: `n${n}`,
    workflow: "wf-1",
    node_name: `站${n}`,
    node_type: "TRIAL",
    court_code: `${n}殿`,
    node_order: n,
    approver_type: "ROLE",
    status: "PENDING",
    decided_at: null,
    notes: "",
    kind: "APPROVAL",
    segment_order: 1,
    order_in_segment: n,
    skip_kind: null,
    skip_reason: "",
    is_required: false,
    ...over,
  }) as ApprovalNode;

const ADJUST_NODES = [
  node(1, { status: "APPROVED", verdict: "PASSED" }),
  node(2, { status: "SKIPPED", skip_kind: "AT_PICK" }),
  node(3),
  node(4, { status: "SKIPPED", skip_kind: "AT_PICK" }),
  node(5),
  node(6, { status: "SKIPPED", skip_kind: "CANCELLED" }),
  node(7, { node_type: "FINAL", is_required: true }),
];
const running = segment({ order: 1, is_local: true, tenant_code: "CN_DIYU", realm_name: "Chinese Afterlife", state: "RUNNING", version: 3, at_gate: false });
const adjustWorkflow = () => workflowWith([running], ADJUST_NODES, { current_node: "n3" });

function renderAdjust() {
  const onClose = jest.fn();
  wrap(<AdjustStationsSheet workflow={adjustWorkflow()} segment={running} isOpen onClose={onClose} />);
  return { onClose, save: () => screen.getByRole("button", { name: tZh("common.save") }) };
}

describe("加减站(W-3b)", () => {
  it("当前站与之前的站折成「不能改」;终审勾灰;改不回来的跳过也不能勾", () => {
    renderAdjust();
    const list = screen.getByTestId("adjust-stations");
    expect(list.querySelector('[data-locked="past"]')).toHaveTextContent(tZh("workflow.adjust.locked_past", { range: "1–2" }));
    expect(list.querySelector('[data-locked="current"]')).toHaveTextContent(tZh("workflow.adjust.locked_current", { node: "3 站3" }));
    // 当前站与之前的站不逐条列。
    expect(within(list).queryByRole("checkbox", { name: /站1/ })).toBeNull();
    expect(within(list).queryByRole("checkbox", { name: /站3/ })).toBeNull();
    const final = within(list).getByRole("checkbox", { name: /站7/ });
    expect(final).toBeChecked();
    expect(final).toBeDisabled();
    expect(within(list).getByRole("checkbox", { name: /站6/ })).toBeDisabled();
    expect(within(list).getByRole("checkbox", { name: /站4/ })).toBeEnabled();
  });

  it("加回一站、跳过一站:行尾只标这两站,计数对得上;理由空着不能保存;保存带这一段的版本", async () => {
    workflowApi.adjust.mockResolvedValue({ data: adjustWorkflow() });
    const { onClose, save } = renderAdjust();
    const list = screen.getByTestId("adjust-stations");
    expect(list.querySelectorAll("[data-mark]")).toHaveLength(0);
    expect(save()).toBeDisabled();

    fireEvent.click(within(list).getByRole("checkbox", { name: /站4/ }));
    fireEvent.click(within(list).getByRole("checkbox", { name: /站5/ }));
    const marks = Array.from(list.querySelectorAll("[data-mark]")).map((m) => m.getAttribute("data-mark"));
    expect(marks).toEqual(["add", "skip"]);
    expect(screen.getByTestId("adjust-summary")).toHaveTextContent(tZh("workflow.adjust.summary", { added: "1", skipped: "1" }));
    expect(save()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(tZh("workflow.adjust.reason"), { exact: false }), { target: { value: "议罪并入终审" } });
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await waitFor(() =>
      expect(workflowApi.adjust).toHaveBeenCalledWith("wf-1", {
        restore_node_ids: ["n4"],
        skip_node_ids: ["n5"],
        reason: "议罪并入终审",
        version: 3,
      })
    );
    expect(workflowApi.adjust.mock.calls[0][1].skip_node_ids).not.toContain("n7");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("别人刚改过这一段(409 segment_changed):拦下,写谁几点改的,不弹错误、不关、不再保存", async () => {
    workflowApi.adjust.mockRejectedValue({
      response: {
        status: 409,
        data: { code: "segment_changed", version: 4, changed_by: "杜阿特管理员", changed_at: "2026-10-18T14:05:00Z" },
      },
    });
    const { onClose, save } = renderAdjust();
    fireEvent.click(within(screen.getByTestId("adjust-stations")).getByRole("checkbox", { name: /站5/ }));
    fireEvent.change(screen.getByLabelText(tZh("workflow.adjust.reason"), { exact: false }), { target: { value: "x" } });
    fireEvent.click(save());
    const stale = await screen.findByTestId("segment-stale");
    expect(stale).toHaveTextContent(tZh("workflow.pick.stale_title"));
    expect(stale).toHaveTextContent(
      tZh("workflow.pick.stale_body", { by: "杜阿特管理员", time: "@2026-10-18T14:05:00Z" })
    );
    expect(within(stale).getByRole("button", { name: tZh("workflow.pick.stale_view") })).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── 审批页「待我选站」 ───────────────────────────────────────────────────

const emptyGroup = { count: 0, items: [] };
const pickItem = (over: Record<string, unknown>) => ({
  kind: "pick",
  id: "wf-1",
  title: "王守仁",
  created_at: "2026-10-16T00:00:00Z",
  target: { kind: "pick", id: "wf-1" },
  segment_order: 2,
  go: 4,
  total: 4,
  realm: "CN_DIYU",
  hall: "Chinese Afterlife",
  court: "第十殿",
  gate_days: null,
  stations_ahead: null,
  ...over,
});

describe("审批页「待我选站」(W-2)", () => {
  it("在门口的那一行写等了几天并加粗;没到门口的写前面还有几站", async () => {
    officerAppApi.todo.mockResolvedValue({
      data: {
        pick_nodes: {
          count: 2,
          items: [
            pickItem({ gate_days: 2 }),
            pickItem({ id: "wf-2", title: "李清照", target: { kind: "pick", id: "wf-2" }, segment_order: 3, stations_ahead: 6 }),
          ],
        },
      },
    });
    wrap(<PickNodesGroup />);
    const group = await screen.findByTestId("pick-nodes-group");
    expect(group).toHaveTextContent(tZh("workflow.pick_group.title"));
    const rows = group.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-at-gate");
    expect(rows[0]).toHaveTextContent(tZh("workflow.pick_group.at_gate", { n: "2" }));
    expect(rows[0]).toHaveTextContent(tZh("workflow.pick_group.row_title", { soul: "王守仁", n: "4" }));
    expect(rows[0]).toHaveTextContent(tZh("workflow.pick_group.row_meta", { realm: tZh("souls.civilizations.CHINESE"), hall: "酆都第十殿", order: "2" }));
    expect(rows[0]).not.toHaveTextContent("CN_DIYU");
    expect(rows[0]).not.toHaveTextContent("Chinese Afterlife");
    expect(rows[1]).not.toHaveAttribute("data-at-gate");
    expect(rows[1]).toHaveTextContent(tZh("workflow.pick_group.ahead", { n: "6" }));
    expect(rows[1]).not.toHaveTextContent(tZh("workflow.pick_group.at_gate", { n: "2" }));
    expect(within(group).getAllByRole("button", { name: tZh("workflow.pick_group.action") })).toHaveLength(2);
  });

  it("流程没有审判(没有殿)时只写冥界名;认不出文明时才用服务端的展示名", async () => {
    officerAppApi.todo.mockResolvedValue({
      data: {
        pick_nodes: {
          count: 2,
          items: [
            pickItem({ court: "" }),
            pickItem({ id: "wf-2", target: { kind: "pick", id: "wf-2" }, realm: "XX_NOWHERE", hall: "Nowhere Hall", court: "" }),
          ],
        },
      },
    });
    wrap(<PickNodesGroup />);
    const rows = (await screen.findByTestId("pick-nodes-group")).querySelectorAll("li");
    expect(rows[0]).toHaveTextContent(tZh("workflow.pick_group.row_meta", { realm: tZh("souls.civilizations.CHINESE"), hall: "酆都", order: "2" }));
    expect(rows[0]).not.toHaveTextContent("Chinese Afterlife");
    expect(rows[1]).toHaveTextContent("Nowhere Hall");
  });

  it("没有要选的就不画这一组", async () => {
    officerAppApi.todo.mockResolvedValue({ data: { pick_nodes: emptyGroup } });
    wrap(<PickNodesGroup />);
    await waitFor(() => expect(officerAppApi.todo).toHaveBeenCalled());
    expect(screen.queryByTestId("pick-nodes-group")).toBeNull();
  });

  it("a failed to-do fetch says so and retries, instead of drawing nothing", async () => {
    officerAppApi.todo.mockRejectedValueOnce(new Error("down"));
    wrap(<PickNodesGroup />);
    const alert = await screen.findByRole("alert");
    officerAppApi.todo.mockResolvedValue({ data: { pick_nodes: emptyGroup } });
    fireEvent.click(within(alert).getByRole("button"));
    await waitFor(() => expect(officerAppApi.todo).toHaveBeenCalledTimes(2));
  });
});

// ── 历史句子 ────────────────────────────────────────────────────────────

describe("选站 / 加减站记录的句子", () => {
  const entry = (over: Partial<WorkflowHistoryEntry>): WorkflowHistoryEntry => ({
    kind: "adjusted",
    segment: 1,
    realm: "CN_DIYU",
    actor: "阎罗王",
    at: "2026-10-16T11:20:00Z",
    restored: [],
    skipped: [],
    reason: "并入终审",
    ...over,
  });

  it("加回为空时去掉那一半句,不写「无」", () => {
    const line = historyLine(entry({ skipped: ["审孝"] }), "酆都", tZh);
    expect(line).toBe(tZh("workflow.history.adjusted_skipped", { actor: "阎罗王", skipped: "审孝", reason: "并入终审" }));
    expect(line).not.toContain("加回");
  });

  it("两边都有时用整句;别的域的人名没给时写那个域", () => {
    expect(historyLine(entry({ restored: ["议罪"], skipped: ["定刑"], actor: null }), "杜阿特", tZh)).toBe(
      tZh("workflow.history.adjusted", { actor: "杜阿特", added: "议罪", skipped: "定刑", reason: "并入终审" })
    );
  });

  it("选站没有跳过任何站:写全部要走", () => {
    expect(historyLine(entry({ kind: "picked" }), "杜阿特", tZh)).toBe(
      tZh("workflow.history.picked_all", { actor: "阎罗王", realm: "杜阿特" })
    );
  });
});

// ── 驳回时会转到的站(2026-10-19)──────────────────────────────────────────
// 别的站驳回时会转到的站:来源还要走时像终审一样锁着,理由写来源;来源都取消时当场解锁;勾回来源时它一并勾回。

describe("驳回时会转到的站不能跳过", () => {
  const JUMP_ROWS: PickRow[] = [
    { key: "1", label: "1 · 分区审判", hall: "岔路口草地", who: "Aeacus", required: false },
    { key: "2", label: "2 · 合议", hall: "岔路口草地", who: "Minos", required: false, jumpSources: [{ key: "1", node_name: "分区审判" }] },
    { key: "3", label: "3 · 终审", hall: "十殿", who: "转轮王", required: true },
  ];
  const reason = (source: string) => tZh("workflow.pick.jump_target_reason", { source });

  function JumpPicker({ onChange }: { onChange: (_next: Set<string>) => void }) {
    const [skipped, setSkipped] = useState<Set<string>>(new Set());
    return (
      <StationPicker
        flowName="希腊冥界流程"
        rows={JUMP_ROWS}
        skipped={skipped}
        onChange={(next) => {
          onChange(next);
          setSkipped(next);
        }}
      />
    );
  }

  it("锁着、写来源;取消来源当场解锁;再勾回来源时它一并勾回", () => {
    const onChange = jest.fn();
    render(<JumpPicker onChange={onChange} />);
    const target = () => screen.getByRole("checkbox", { name: /2 · 合议/ });
    expect(target()).toBeChecked();
    expect(target()).toBeDisabled();
    expect(screen.getByText(reason("分区审判"))).toBeInTheDocument();
    fireEvent.click(target());
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: /1 · 分区审判/ }));
    expect(target()).toBeEnabled();
    expect(screen.queryByText(reason("分区审判"))).toBeNull();
    fireEvent.click(target());
    expect(onChange).toHaveBeenLastCalledWith(new Set(["1", "2"]));

    fireEvent.click(screen.getByRole("checkbox", { name: /1 · 分区审判/ }));
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    expect(target()).toBeChecked();
    expect(target()).toBeDisabled();
  });

  const JUMP_NODES = [
    node(1, { status: "APPROVED", verdict: "PASSED" }),
    node(3, { court_code: "Heaven" }),
    node(4, { status: "SKIPPED", skip_kind: "AT_PICK" }),
    node(5, { status: "SKIPPED", skip_kind: "AT_PICK", jump_target_of: [{ key: "n4", node_name: "站4" }] }),
    node(6, { jump_target_of: [{ key: "n3", node_name: "站3" }, { key: "n1", node_name: "站1" }] }),
    node(7, { node_type: "FINAL", is_required: true, court_code: "第十殿" }),
  ];

  it("加减站:当前站驳回时转到的站锁着(已经决定的站不算);加回来源时目标一并加回", async () => {
    const wf = workflowWith([running], JUMP_NODES, { current_node: "n3" });
    workflowApi.adjust.mockResolvedValue({ data: wf });
    wrap(<AdjustStationsSheet workflow={wf} segment={running} isOpen onClose={() => {}} />);
    const list = screen.getByTestId("adjust-stations");
    const six = within(list).getByRole("checkbox", { name: /站6/ });
    expect(six).toBeChecked();
    expect(six).toBeDisabled();
    // 站1 已经决定,不再驳回到哪:理由里只有当前站。
    expect(within(list).getByText(reason("站3"))).toBeInTheDocument();
    expect(within(list).queryByText(reason("站3、站1"))).toBeNull();

    const five = within(list).getByRole("checkbox", { name: /站5/ });
    expect(five).not.toBeChecked();
    expect(five).toBeEnabled();
    fireEvent.click(within(list).getByRole("checkbox", { name: /站4/ }));
    expect(within(list).getByRole("checkbox", { name: /站5/ })).toBeChecked();
    expect(within(list).getByRole("checkbox", { name: /站5/ })).toBeDisabled();
    expect(Array.from(list.querySelectorAll("[data-mark]")).map((m) => m.getAttribute("data-mark"))).toEqual(["add", "add"]);
    expect(screen.getByTestId("adjust-summary")).toHaveTextContent(tZh("workflow.adjust.summary", { added: "2", skipped: "0" }));

    fireEvent.change(screen.getByLabelText(tZh("workflow.adjust.reason"), { exact: false }), { target: { value: "补审" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("common.save") }));
    await waitFor(() =>
      expect(workflowApi.adjust).toHaveBeenCalledWith("wf-1", { restore_node_ids: ["n4", "n5"], skip_node_ids: [], reason: "补审", version: 3 })
    );
  });

  it("服务端拒了(400 jump_target_required):提示写中文、写是哪一站从哪一站转来,不上后端那句英文", async () => {
    const english = "Rejected cases are handed to this station, so it cannot be skipped: 站5 ← 站4";
    workflowApi.adjust.mockRejectedValue({
      response: {
        status: 400,
        data: {
          code: "jump_target_required",
          error: english,
          jump_targets: [{ node_id: "n5", node_order: 5, node_name: "站5", sources: ["站4"] }],
        },
      },
    });
    const { onClose, save } = renderAdjust();
    fireEvent.click(within(screen.getByTestId("adjust-stations")).getByRole("checkbox", { name: /站5/ }));
    fireEvent.change(screen.getByLabelText(tZh("workflow.adjust.reason"), { exact: false }), { target: { value: "x" } });
    fireEvent.click(save());
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const [text, tone] = mockShowToast.mock.calls[0];
    expect(tone).toBe("error");
    expect(text).toBe(tZh("workflow.refusal.jump_target_required", { station: "站5", source: "站4" }));
    expect(text).toContain("站5");
    expect(text).toContain("站4");
    expect(text).not.toContain(english);
    expect(text).not.toMatch(/[A-Za-z]{3,}/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("殿名按界面语言:中文界面写 天堂 / 第十殿,不写库里的 Heaven", () => {
    const wf = workflowWith([running], JUMP_NODES, { current_node: "n1" });
    wrap(<AdjustStationsSheet workflow={wf} segment={running} isOpen onClose={() => {}} />);
    const list = screen.getByTestId("adjust-stations");
    expect(list).toHaveTextContent("天堂");
    expect(list).toHaveTextContent("第十殿");
    expect(list).not.toHaveTextContent("Heaven");
    expect(list).not.toHaveTextContent("Tenth Court");
  });
});

// ── 模板编辑器的只读预览(2026-10-19)────────────────────────────────────────
// 窄屏只读视图的流程列表与右侧属性里的殿名,按界面语言(`courtLabel`):库里存的 Heaven 在中文界面写 天堂。

describe("模板编辑器只读预览的殿名", () => {
  const PREVIEW_NODES: FlowNode[] = [
    { id: "p1", position: { x: 0, y: 0 }, data: { label: "升天审", courtCode: "Heaven", kind: "APPROVAL", nodeType: "TRIAL" } },
    { id: "p2", position: { x: 0, y: 100 }, data: { label: "终审", courtCode: "Tenth Court", kind: "APPROVAL", nodeType: "FINAL" } },
  ];
  const roles = new Map<string, NodeRole>([
    ["p1", "entry"],
    ["p2", "end"],
  ]);

  it("流程列表写 天堂 / 第十殿,不写库里的 Heaven", () => {
    render(
      <WorkflowReadOnlyList
        t={tZh}
        locale="zh-Hans"
        nodes={PREVIEW_NODES}
        edges={[]}
        roles={roles}
        issueNodes={new Set()}
        selectedId={null}
        onSelect={() => {}}
      />
    );
    const list = screen.getByRole("region", { name: tZh("workflow.editor.preview") });
    expect(list).toHaveTextContent("天堂");
    expect(list).toHaveTextContent("第十殿");
    expect(list).not.toHaveTextContent("Heaven");
    expect(list).not.toHaveTextContent("Tenth Court");
  });

  it("右侧属性(只读)里的殿名同样写 天堂", () => {
    render(
      <WorkflowInspector
        t={tZh}
        locale="zh-Hans"
        nodes={PREVIEW_NODES}
        edges={[]}
        roles={roles}
        issues={[]}
        selectedId="p1"
        onSelect={() => {}}
        validationId="v"
        tab="node"
        onTab={() => {}}
      />
    );
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("天堂");
    expect(panel).not.toHaveTextContent("Heaven");
  });
});
