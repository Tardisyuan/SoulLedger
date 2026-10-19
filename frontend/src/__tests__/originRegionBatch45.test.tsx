/**
 * 第四十五批:灵魂「出身地域」与希腊冥界按出身地域分流(Design W-1 ~ W-6)。
 *
 * - W-1 表单:「出身地域」是欧洲 / 亚洲 / 不详三段,默认不详,送 "" / EUROPE / ASIA;说明只在希腊殿出现。
 * - W-2 详情:不详是正文墨色的一个词「不详」,不是缺值的「—」。
 * - W-3 编辑器:通知节点带按出身地域的分支就是「自动分流」—— 首行「▷◇ 自动 · 无审批人」、⇉ 加名称、
 *   三条出口只写 欧洲 / 亚洲 / 不详,不写「默认」;检查器只改去处,没有审批人;缺一条出口在问题页签里点名。
 * - W-4 条件:事实下拉在 余额 / 文明 / 判决 之后有「出身地域」,值是三个地域。
 * - W-5 流程详情:分流那一行写「自动 · 亚洲」;没走到的站写 – 、灰、不划线(划线只留给有人跳过的 ⤼);
 *   历史写「按出身地域分流 → 亚洲 → Rhadamanthus」。
 * - W-6 选站:分流那一步不列;两位分区判官锁成必须走,理由是「分流到这里」,不是「驳回时会转到这里」;
 *   外域全部锁着时写「全部必须走」。
 * - 埃及文:亚洲借词 Asia(第四十七批)。
 *
 * 文案都用真的 zh-Hans 语言包(`tZh`),断言的是读者看到的字。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { ApprovalNode, ApprovalWorkflow, ConditionClause, Soul, WorkflowSegment } from "@soulledger/core/api";
import egy from "@soulledger/core/messages/egy.json";
import { originRegionLabel } from "@soulledger/core/domain/originRegion";
import { tZh } from "./support/zhBundle";
import egyPendingKeys from "./support/egyPendingKeys.json";

jest.mock("@xyflow/react", () => {
  const React = require("react");
  return {
    // Draws the editor's own node and edge components, so the card and the exit labels are the real ones.
    ReactFlow: ({ children, nodes, edges, nodeTypes, edgeTypes }: any) => {
      const NodeCard = nodeTypes.editableNode;
      const Route = edgeTypes.route;
      return (
        <div data-testid="react-flow">
          {(nodes ?? []).map((n: any) => (
            <div key={n.id} data-testid={`card-${n.id}`}>
              <NodeCard data={n.data} selected={false} />
            </div>
          ))}
          {(edges ?? []).map((e: any) => (
            <svg key={e.id} data-testid={`edge-${e.id}`} data-source={e.source}>
              <Route id={e.id} sourceX={0} sourceY={0} targetX={0} targetY={10} sourcePosition="bottom" targetPosition="top" style={e.style} data={e.data} />
            </svg>
          ))}
          {children}
        </div>
      );
    },
    Controls: () => null,
    Background: () => null,
    Handle: () => null,
    BaseEdge: () => null,
    EdgeLabelRenderer: ({ children }: any) => <>{children}</>,
    getSmoothStepPath: () => ["", 0, 0],
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    useNodesState: (initial: any[]) => {
      const [nodes, setNodes] = React.useState(initial);
      return [nodes, setNodes, jest.fn()];
    },
    useEdgesState: (initial: any[]) => {
      const [edges, setEdges] = React.useState(initial);
      return [edges, setEdges, jest.fn()];
    },
    addEdge: (edge: any, edges: any[]) => [...edges, edge],
    BackgroundVariant: { Dots: "dots" },
  };
});
jest.mock("@xyflow/react/dist/style.css", () => {});

const mockTemplateGet = jest.fn();
const mockFlowPreview = jest.fn();
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  workflowApi: {
    get: jest.fn(),
    adjust: jest.fn(),
    pickSegment: jest.fn(),
    flowPreview: (...a: unknown[]) => mockFlowPreview(...a),
    templates: {
      get: (...a: unknown[]) => mockTemplateGet(...a),
      create: jest.fn(),
      update: jest.fn(),
      publish: jest.fn(),
      versions: jest.fn().mockResolvedValue({ data: [] }),
      approverPreview: jest.fn().mockResolvedValue({ data: null }),
    },
  },
  permApi: { roles: { list: jest.fn().mockResolvedValue({ data: [] }) } },
}));

const mockLocale = { current: "zh-Hans" };
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({
    t: tZh,
    tf: (_k: string, f: string) => f,
    locale: mockLocale.current,
    hydrated: true,
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => `@${v}`,
  }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const mockMutate = jest.fn();
jest.mock("@soulledger/core/hooks/useSouls", () => ({
  ...jest.requireActual("@soulledger/core/hooks/useSouls"),
  useUpdateSoul: () => ({ mutate: mockMutate, isPending: false }),
}));

import { SoulEditModal } from "@/src/components/souls/SoulEditModal";
import { SoulInfoCard } from "@/src/components/souls/detail/SoulInfoCard";
import WorkflowEditor from "@/src/components/workflow/WorkflowEditor";
import { ExitConditionsSection } from "@/src/components/workflow/WorkflowInspectorExtras";
import { WorkflowSegmentList } from "@/src/components/workflow/segments/WorkflowSegmentList";
import { WorkflowNodeHistory } from "@/src/components/workflow/detail/WorkflowNodeHistory";
import { FlowStationPicker } from "@/src/components/workflow/segments/FlowStationPicker";

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLocale.current = "zh-Hans";
});

const SOUL = {
  id: "s1",
  name: "Er of Pamphylia",
  civilization: "GREEK",
  current_state: "JUDGING",
  birth_date: null,
  death_date: null,
  origin_location: "Pamphylia",
  origin_region: "",
  description: "",
  merit_score: 0,
  demerit_score: 0,
  date_problems: [],
  is_eval_identity: false,
} as unknown as Soul;

// ── W-1 表单 ───────────────────────────────────────────────────────────

describe("登记 / 编辑灵魂:出身地域三段(W-1)", () => {
  it("三段 欧洲 / 亚洲 / 不详,默认不详;希腊殿下面有说明;选亚洲送 ASIA", async () => {
    render(<SoulEditModal isOpen onClose={jest.fn()} soul={SOUL} onUpdated={jest.fn()} />);
    const group = screen.getByRole("radiogroup", { name: tZh("souls.origin_region.label") });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["欧洲", "亚洲", "不详"]);
    expect(within(group).getByRole("radio", { name: "不详" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "亚洲" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("origin-region-hint")).toHaveTextContent(tZh("souls.form.origin_region_hint_greek"));

    fireEvent.click(within(group).getByRole("radio", { name: "亚洲" }));
    expect(within(group).getByRole("radio", { name: "亚洲" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByText(tZh("common.save")));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0][0].data.origin_region).toBe("ASIA");
  });

  it("不详送空串,不送 UNKNOWN", async () => {
    render(<SoulEditModal isOpen onClose={jest.fn()} soul={{ ...SOUL, origin_region: "EUROPE" }} onUpdated={jest.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "不详" }));
    fireEvent.click(screen.getByText(tZh("common.save")));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0][0].data.origin_region).toBe("");
  });

  it("别的文明没有那句说明,三段照样在", () => {
    render(<SoulEditModal isOpen onClose={jest.fn()} soul={{ ...SOUL, civilization: "CHINESE" }} onUpdated={jest.fn()} />);
    expect(screen.getByRole("radiogroup", { name: tZh("souls.origin_region.label") })).toBeInTheDocument();
    expect(screen.queryByTestId("origin-region-hint")).toBeNull();
    expect(screen.queryByText(tZh("souls.form.origin_region_hint_greek"))).toBeNull();
  });
});

// ── W-2 详情 ───────────────────────────────────────────────────────────

describe("灵魂详情:出身地域(W-2)", () => {
  it("不详是一个词,不是缺值的「—」", () => {
    wrap(<SoulInfoCard soul={SOUL} loading={false} birthDisplay={null} deathDisplay={null} />);
    const cell = screen.getByTestId("soul-origin-region");
    expect(cell).toHaveTextContent(/^不详$/);
    expect(cell.querySelector("[data-missing]")).toBeNull();
    expect(cell).not.toHaveTextContent("—");
  });

  it("欧洲写欧洲,原值进 title", () => {
    wrap(<SoulInfoCard soul={{ ...SOUL, origin_region: "EUROPE" }} loading={false} birthDisplay={null} deathDisplay={null} />);
    const cell = screen.getByTestId("soul-origin-region");
    expect(cell).toHaveTextContent(/^欧洲$/);
    expect(cell.querySelector('[title="EUROPE"]')).not.toBeNull();
  });
});

describe("埃及文:亚洲借词 Asia(第四十七批)", () => {
  it("egy 的 ASIA 读 egy 包里的 Asia;待补清单里没有它", () => {
    const tEgyPack = (key: string) =>
      key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), egy) as string;
    expect(originRegionLabel(tEgyPack, "ASIA", "egy")).toBe("Asia");
    expect(originRegionLabel(tZh, "ASIA", "zh-Hans")).toBe("亚洲");
    expect(egyPendingKeys).not.toContain("souls.origin_region.ASIA");
  });
});

// ── W-3 编辑器 ─────────────────────────────────────────────────────────

const BASE = { court_code: "岔路口草地", approver_type: "ROLE", approver_role: "JUDGE" };
const GREEK_TEMPLATE = {
  id: "t-gr",
  name: "希腊冥界流程",
  description: "",
  civilization: "GREEK",
  case_type: "ROUTINE",
  priority: 0,
  is_active: true,
  published_version: 1,
  draft_version: 1,
  created_at: "",
  updated_at: "",
  node_count: 5,
  nodes: [
    {
      ...BASE, id: "n1", node_name: "按出身地域分流", node_type: "TRIAL", node_order: 1, kind: "NOTIFY", approver_type: "SYSTEM",
      on_pass: "n4",
      branches: [
        { id: "europe", when: [{ fact: "origin_region", op: "in", value: ["EUROPE"] }], target: "n2" },
        { id: "asia", when: [{ fact: "origin_region", op: "in", value: ["ASIA"] }], target: "n3" },
      ],
    },
    { ...BASE, id: "n2", node_name: "Aeacus", node_type: "TRIAL", node_order: 2, on_pass: "n5", on_fail: "n4" },
    { ...BASE, id: "n3", node_name: "Rhadamanthus", node_type: "TRIAL", node_order: 3, on_pass: "n5", on_fail: "n4" },
    { ...BASE, id: "n4", node_name: "Minos", node_type: "FINAL", node_order: 4, on_pass: "n5" },
    { ...BASE, id: "n5", node_name: "结束", node_type: "FINAL", node_order: 5, kind: "END", approver_type: "SYSTEM" },
  ],
};

function renderEditor() {
  mockTemplateGet.mockResolvedValue({ data: GREEK_TEMPLATE });
  return wrap(<WorkflowEditor templateId="t-gr" />);
}

describe("编辑器:自动分流(W-3)", () => {
  it("卡片首行「▷◇ 自动 · 无审批人」,第二行 ⇉ 加名称;别的卡片不是这样", async () => {
    renderEditor();
    const card = await screen.findByTestId("card-n1");
    expect(card.querySelector("[data-auto-route]")).toHaveTextContent(`▷◇ ${tZh("workflow.editor.auto_route.badge")}`);
    expect(card).toHaveTextContent("⇉ 按出身地域分流");
    expect(card).not.toHaveTextContent("✉");
    expect(screen.getByTestId("card-n2").querySelector("[data-auto-route]")).toBeNull();
  });

  it("三条实线出口只写 欧洲 / 亚洲 / 不详,不写「默认」「是 ·」", async () => {
    renderEditor();
    await screen.findByTestId("card-n1");
    const labels = Array.from(document.querySelectorAll('[data-source="n1"]')).map((e) => e.textContent);
    expect([...labels].sort()).toEqual(["不详", "亚洲", "欧洲"].sort());
    for (const text of labels) {
      expect(text).not.toContain(tZh("workflow.editor.condition.default"));
      expect(text).not.toContain(`${tZh("workflow.editor.condition.yes")} ·`);
    }
    // 分区判官的驳回线照旧写「否决」,不受影响。
    const fromN2 = [...document.querySelectorAll('[data-source="n2"]')].map((e) => e.textContent ?? "");
    expect(fromN2.some((text) => text.includes(tZh("workflow.editor.branch.fail")))).toBe(true);
  });

  it("检查器只改三条出口的去处:没有审批人预览、超时与驳回;断一条就在问题里点名", async () => {
    renderEditor();
    const preview = await screen.findByRole("region", { name: tZh("workflow.editor.preview") });
    fireEvent.click(await within(preview).findByRole("button", { name: /按出身地域分流/ }));
    const section = await screen.findByTestId("auto-route-section");
    const selects = ["欧洲", "亚洲", "不详"].map((r) => within(section).getByLabelText(r) as HTMLSelectElement);
    expect(selects.map((s) => s.value)).toEqual(["n2", "n3", "n4"]);
    expect(screen.queryByTestId("node-form")).toBeNull();
    expect(screen.queryByRole("region", { name: tZh("workflow.editor.preview_approver.title") })).toBeNull();
    expect(screen.queryByText(tZh("workflow.editor.timeout.label"))).toBeNull();

    fireEvent.change(selects[1], { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(tZh("workflow.editor.tab.issues")) }));
    expect(
      await screen.findByText(tZh("workflow.editor.issue.auto_route_exit_missing", { node: "N1「按出身地域分流」", region: "亚洲" }))
    ).toBeInTheDocument();
    expect(
      screen.queryByText(tZh("workflow.editor.issue.auto_route_exit_missing", { node: "N1「按出身地域分流」", region: "欧洲" }))
    ).toBeNull();
  });
});

// ── W-4 条件事实 ───────────────────────────────────────────────────────

function Exits() {
  const node: Node = { id: "a", position: { x: 0, y: 0 }, data: { label: "分岔" } };
  const target: Node = { id: "b", position: { x: 0, y: 0 }, data: { label: "去处" } };
  const [edges, setEdges] = useState<Edge[]>([
    { id: "e1", source: "a", target: "b", sourceHandle: "pass", data: { when: [{ fact: "balance", op: "lt", value: 0 }] } },
  ]);
  return (
    <ExitConditionsSection
      t={tZh}
      node={node}
      nodes={[node, target]}
      edges={edges}
      onChange={(id, when?: ConditionClause[]) => setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { when } } : e)))}
    />
  );
}

describe("条件分支的事实(W-4)", () => {
  it("出身地域排在 余额 / 文明 / 判决 之后;选它,运算是 属于 / 不属于,值是三个地域", () => {
    render(<Exits />);
    const fact = screen.getByLabelText(tZh("workflow.editor.condition.fact_label")) as HTMLSelectElement;
    expect(Array.from(fact.options).map((o) => o.textContent)).toEqual(["余额", "文明", "判决", "出身地域"]);
    fireEvent.change(fact, { target: { value: "origin_region" } });
    const op = screen.getByLabelText(tZh("workflow.editor.condition.op_label")) as HTMLSelectElement;
    expect(Array.from(op.options).map((o) => o.value)).toEqual(["in", "not_in"]);
    const values = screen.getByRole("group", { name: tZh("workflow.editor.condition.value_label") });
    expect(within(values).getAllByRole("checkbox").map((c) => c.parentElement?.textContent)).toEqual(["欧洲", "亚洲", "不详"]);
    // 旧的 workflow.editor.condition.region.* 不再有人用。
    expect(tZh("workflow.editor.condition.fact.origin_region")).toBe("出身地域");
  });
});

// ── W-5 流程详情 ───────────────────────────────────────────────────────

const apNode = (id: string, order: number, over: Partial<ApprovalNode> = {}): ApprovalNode =>
  ({
    id,
    workflow: "wf-gr",
    node_name: id,
    node_type: "TRIAL",
    court_code: "",
    node_order: order,
    approver_type: "ROLE",
    status: "PENDING",
    decided_at: null,
    notes: "",
    kind: "APPROVAL",
    segment_order: 1,
    order_in_segment: order,
    skip_kind: null,
    skip_reason: "",
    is_required: false,
    ...over,
  }) as ApprovalNode;

const ROUTED_NODES = [
  apNode("n1", 1, {
    node_name: "按出身地域分流",
    kind: "NOTIFY",
    status: "TRAVERSED",
    decided_at: "2026-10-19T00:00:00Z",
    on_pass: "n4",
    branches_json: [
      { id: "europe", when: [{ fact: "origin_region", op: "in", value: ["EUROPE"] }], target: "n2" },
      { id: "asia", when: [{ fact: "origin_region", op: "in", value: ["ASIA"] }], target: "n3" },
    ],
  }),
  // 引擎按路由越过的:SKIPPED,没有 skip_kind。
  apNode("n2", 2, { node_name: "Aeacus", status: "SKIPPED", is_required: false }),
  apNode("n3", 3, { node_name: "Rhadamanthus", status: "APPROVED", verdict: "PASSED", decided_at: "2026-10-19T01:00:00Z" }),
  apNode("n4", 4, { node_name: "Minos", node_type: "FINAL", status: "SKIPPED", is_required: true }),
  // 有人选站时跳过的(不是希腊流程里会有的,放在这里对照划线)。
  apNode("n6", 6, { node_name: "补录", status: "SKIPPED", skip_kind: "AT_PICK" }),
];

const DONE_SEGMENT = {
  order: 1, is_local: true, tenant_code: "GR_HADES", realm_name: "Greek Underworld", civilization: "GREEK", name: "希腊冥界流程",
  state: "DONE", go: 3, total: 4, default_node_count: 3, version: 1, picked_at: null, picked_by_name: null, at_gate: false,
  gate_days: null, no_picker: false, current_order_in_segment: null, can_pick: false, can_use_default: false, can_remind: false,
} as WorkflowSegment;

const routedWorkflow = { id: "wf-gr", status: "COMPLETED", segments: [DONE_SEGMENT], nodes: ROUTED_NODES, current_node: null } as unknown as ApprovalWorkflow;

describe("流程详情:分流一步与没走到的站(W-5)", () => {
  it("分流那一行写「自动 · 亚洲」;没走到的写 – 、灰、不划线;有人跳过的照旧 ⤼ 划线", () => {
    wrap(<WorkflowSegmentList workflow={routedWorkflow} myTenant="GR_HADES" />);
    const rows = Array.from(screen.getByTestId("workflow-segments").querySelectorAll("li"));
    const row = (name: string) => rows.find((r) => r.textContent?.includes(name))!;

    expect(row("按出身地域分流")).toHaveTextContent(tZh("workflow.node_state.auto_done", { region: "亚洲" }));
    expect(row("按出身地域分流")).not.toHaveTextContent("欧洲");

    for (const name of ["Aeacus", "Minos"]) {
      expect(row(name)).toHaveAttribute("data-node-state", "not-reached");
      expect(row(name)).toHaveTextContent("–");
      expect(row(name)).toHaveTextContent(tZh("workflow.node_state.not_reached"));
      expect(row(name).querySelector(".line-through")).toBeNull();
      expect(row(name).className).toContain("--color-ink-subtle");
    }
    expect(row("Rhadamanthus")).not.toHaveAttribute("data-node-state", "not-reached");
    expect(row("补录")).toHaveAttribute("data-node-state", "skipped");
    expect(row("补录").querySelector(".line-through")).not.toBeNull();
    expect(row("补录")).toHaveTextContent("⤼");

    expect(screen.getByText(tZh("workflow.legend"))).toBeInTheDocument();
    expect(tZh("workflow.legend")).toContain("– 这次没走到");
  });

  it("历史:「按出身地域分流 → 亚洲 → Rhadamanthus」,不画判决徽章", () => {
    wrap(<WorkflowNodeHistory nodes={ROUTED_NODES} verdictColors={{}} verdictGlyphs={{}} currentNode={null} />);
    const line = document.querySelector("[data-auto-routed]")!;
    expect(line).toHaveTextContent(
      tZh("workflow.history.auto_routed", { region: "亚洲", node: "Rhadamanthus" })
    );
    expect(line.querySelector("[data-missing]")).toBeNull();
  });

  it("正在分区判官那一站时(它还是 PENDING),也认得走的是亚洲那条", () => {
    const running = ROUTED_NODES.map((n) => (n.id === "n3" ? { ...n, status: "PENDING", verdict: null } : n));
    wrap(<WorkflowNodeHistory nodes={running} verdictColors={{}} verdictGlyphs={{}} currentNode="n3" />);
    expect(document.querySelector("[data-auto-routed]")).toHaveTextContent("亚洲");
    expect(document.querySelector("[data-auto-routed]")).not.toHaveTextContent("不详");
  });
});

// ── W-6 选站 ───────────────────────────────────────────────────────────

describe("选站:分流一步不列,两位分区判官锁住(W-6)", () => {
  it("分流那一步不在列表里;Aeacus / Rhadamanthus 必须走,理由是分流,不是驳回;Minos 是终审;外域全部锁着写「全部必须走」", async () => {
    mockFlowPreview.mockResolvedValue({
      data: {
        name: "希腊冥界流程",
        nothing_to_pick: true,
        stations: [
          { node_order: 2, node_name: "Aeacus", court_code: "", approver: "Aeacus", approver_role: null, is_required: false,
            jump_target_of: [{ key: "1", node_name: "按出身地域分流", via: "branch" }] },
          { node_order: 3, node_name: "Rhadamanthus", court_code: "", approver: "Rhadamanthus", approver_role: null, is_required: false,
            jump_target_of: [{ key: "1", node_name: "按出身地域分流", via: "branch" }] },
          { node_order: 4, node_name: "Minos", court_code: "", approver: "Minos", approver_role: null, is_required: true,
            jump_target_of: [{ key: "2", node_name: "Aeacus", via: "on_fail" }, { key: "3", node_name: "Rhadamanthus", via: "on_fail" }] },
        ],
        foreign: [
          { order: 2, tenant_code: "GR_HADES", realm_name: "Greek Underworld", default_node_count: 3, nothing_to_pick: true },
          { order: 3, tenant_code: "EG_DUAT", realm_name: "Egyptian Afterlife", default_node_count: 4, nothing_to_pick: false },
        ],
      },
    });
    wrap(<FlowStationPicker params={{ soul: "s1", case_type: "ROUTINE" }} skipped={new Set()} onChange={jest.fn()} />);
    const picker = await screen.findByTestId("station-picker");
    expect(within(picker).queryByText(/按出身地域分流$/)).toBeNull();
    expect(picker.querySelectorAll("[data-station]")).toHaveLength(3);

    for (const name of ["Aeacus", "Rhadamanthus"]) {
      const box = within(picker).getByRole("checkbox", { name: new RegExp(name) });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    const routeReason = tZh("workflow.pick.route_target_reason", { source: "按出身地域分流" });
    expect(within(picker).getAllByText(routeReason)).toHaveLength(2);
    expect(within(picker).queryByText(tZh("workflow.pick.jump_target_reason", { source: "按出身地域分流" }))).toBeNull();

    const foreign = screen.getByTestId("picker-foreign");
    const rows = within(foreign).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(tZh("workflow.pick.foreign_all_required"));
    expect(rows[0]).not.toHaveTextContent(tZh("workflow.pick.foreign_by_realm"));
    expect(rows[0]).toHaveTextContent(tZh("workflow.pick.foreign_default", { n: "3" }));
    expect(rows[1]).toHaveTextContent(tZh("workflow.pick.foreign_by_realm"));
    expect(rows[1]).not.toHaveTextContent(tZh("workflow.pick.foreign_all_required"));
  });
});
