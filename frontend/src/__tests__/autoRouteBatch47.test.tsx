/**
 * 第四十七批 W-1 ~ W-3:编辑器从节点库新建「自动分流」。
 *
 * 节点库第五项(通知之后、结束之前);新建的是 NOTIFY + `data.autoRoute`,三条出口全部未连、卡片下画短桩、
 * 检查器类型只读并写「N 条出口未连」;存草稿时没连的出口照样存成分支(去处留空),读回时仍认得它;
 * 从通过端口拖出的线依次接 欧洲 → 亚洲 → 不详;「问题」里点一行,焦点落到那条出口的下拉。
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { tZh } from "./support/zhBundle";

let mockOnConnect: ((_c: unknown) => void) | undefined;
jest.mock("@xyflow/react", () => {
  const React = require("react");
  return {
    // Draws the editor's own node and edge components, so the card and the exit labels are the real ones.
    ReactFlow: ({ children, nodes, edges, nodeTypes, edgeTypes, onConnect }: any) => {
      mockOnConnect = onConnect;
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

import WorkflowEditor from "@/src/components/workflow/WorkflowEditor";
import { workflowApi } from "@soulledger/core/api";

const update = workflowApi.templates.update as jest.Mock;

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const BASE = { court_code: "岔路口草地", approver_type: "ROLE", approver_role: "JUDGE" };
function template(nodes: object[]) {
  return {
    id: "t-gr", name: "三判官庭审判", description: "", civilization: "GREEK", case_type: "ROUTINE", priority: 0,
    is_active: true, published_version: 1, draft_version: 1, created_at: "", updated_at: "", node_count: nodes.length, nodes,
  };
}
const START = template([
  { ...BASE, id: "n1", node_name: "收案登记", node_type: "TRIAL", node_order: 1 },
  { ...BASE, id: "n2", node_name: "Minos", node_type: "FINAL", node_order: 2 },
]);

async function openEditor(t = START) {
  mockTemplateGet.mockResolvedValue({ data: t });
  update.mockResolvedValue({ data: t });
  wrap(<WorkflowEditor templateId="t-gr" />);
  await screen.findByTestId("card-n1");
}
const palette = () => screen.getByRole("navigation", { name: tZh("workflow.editor.palette") });
const addAutoRoute = () => fireEvent.click(within(palette()).getByRole("button", { name: /自动分流/ }));
const newCard = () => screen.getAllByTestId(/^card-node-/).at(-1) as HTMLElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockLocale.current = "zh-Hans";
});

describe("节点库(W-1 / W-2)", () => {
  it("第五项 ⇉ 自动分流,在通知之后、结束之前;说明挂在 aria-describedby 上", async () => {
    await openEditor();
    const items = within(palette()).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual(["□审批", "⧉会签", "✉\uFE0E通知", "⇉自动分流", "■结束"]);
    const hint = document.getElementById(items[3].getAttribute("aria-describedby") ?? "");
    expect(hint).toHaveTextContent(tZh("workflow.editor.palette_hint.AUTO_ROUTE"));
    expect(items[0]).not.toHaveAttribute("aria-describedby");
  });
});

describe("新建自动分流(W-1)", () => {
  it("默认名、选中且名称框聚焦;三条出口未连:卡片下三个短桩,检查器类型只读、写 3 条未连", async () => {
    await openEditor();
    addAutoRoute();
    const card = newCard();
    expect(card).toHaveTextContent(`⇉ ${tZh("workflow.editor.auto_route.default_name")}`);
    expect(card.querySelector("[data-auto-route]")).not.toBeNull();
    const stubs = card.querySelector("[data-unconnected-exits]") as HTMLElement;
    expect(stubs.textContent).toBe(["欧洲", "亚洲", "不详"].map((r) => `${r} · ${tZh("workflow.editor.auto_route.no_target")}`).join(""));

    const section = await screen.findByTestId("auto-route-section");
    expect(document.activeElement).toBe(within(section).getByLabelText(tZh("workflow.editor.field.name")));
    expect(within(section).getByTestId("auto-route-kind")).toHaveTextContent(tZh("workflow.editor.kind_locked"));
    expect(within(section).getByTestId("auto-route-unconnected")).toHaveTextContent(
      tZh("workflow.editor.auto_route.unconnected_count", { n: "3" }),
    );
    expect(screen.queryByTestId("node-form")).toBeNull();
  });

  it("从通过端口拖出的线依次接 欧洲 → 亚洲 → 不详;接一条少一个短桩", async () => {
    await openEditor();
    addAutoRoute();
    const id = newCard().getAttribute("data-testid")!.replace("card-", "");
    act(() => mockOnConnect!({ source: id, sourceHandle: "pass", target: "n2", targetHandle: null }));
    const section = await screen.findByTestId("auto-route-section");
    expect((within(section).getByLabelText("欧洲") as HTMLSelectElement).value).toBe("n2");
    expect((within(section).getByLabelText("亚洲") as HTMLSelectElement).value).toBe("");
    act(() => mockOnConnect!({ source: id, sourceHandle: "pass", target: "n1", targetHandle: null }));
    expect((within(section).getByLabelText("亚洲") as HTMLSelectElement).value).toBe("n1");
    expect(newCard().querySelector("[data-unconnected-exits]")!.textContent).toBe(`不详 · ${tZh("workflow.editor.auto_route.no_target")}`);
  });

  it("从某个短桩的端点拖出,接上的就是那一条;有没连的出口时节点库下面写出端点图例,全连上就不写", async () => {
    await openEditor();
    expect(screen.queryByTestId("legend-unconnected-exit")).toBeNull();
    addAutoRoute();
    expect(screen.getByTestId("legend-unconnected-exit")).toHaveTextContent(tZh("workflow.editor.legend.unconnected_exit"));
    const id = newCard().getAttribute("data-testid")!.replace("card-", "");
    act(() => mockOnConnect!({ source: id, sourceHandle: "exit-ASIA", target: "n2", targetHandle: null }));
    const section = await screen.findByTestId("auto-route-section");
    expect((within(section).getByLabelText("亚洲") as HTMLSelectElement).value).toBe("n2");
    expect((within(section).getByLabelText("欧洲") as HTMLSelectElement).value).toBe("");
    act(() => mockOnConnect!({ source: id, sourceHandle: "exit-UNKNOWN", target: "n1", targetHandle: null }));
    act(() => mockOnConnect!({ source: id, sourceHandle: "exit-EUROPE", target: "n1", targetHandle: null }));
    expect((within(section).getByLabelText("不详") as HTMLSelectElement).value).toBe("n1");
    expect(newCard().querySelector("[data-unconnected-exits]")).toBeNull();
    expect(screen.queryByTestId("legend-unconnected-exit")).toBeNull();
  });

  it("存草稿:没连的出口照样存成按地域的分支,去处留空;读回仍是自动分流,三个短桩都在", async () => {
    await openEditor();
    addAutoRoute();
    fireEvent.click(screen.getByRole("button", { name: tZh("workflow.editor.save_template") }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const saved = update.mock.calls.at(-1)[1].nodes;
    const node = saved.at(-1);
    expect(node).toMatchObject({ kind: "NOTIFY", on_pass: null, node_name: tZh("workflow.editor.auto_route.default_name") });
    expect(node.branches).toEqual([
      { id: "europe", when: [{ fact: "origin_region", op: "in", value: ["EUROPE"] }], target: "" },
      { id: "asia", when: [{ fact: "origin_region", op: "in", value: ["ASIA"] }], target: "" },
    ]);

    document.body.innerHTML = "";
    await openEditor(template([...START.nodes, { ...node, id: "n3", node_order: 3 }]));
    const reloaded = screen.getByTestId("card-n3");
    expect(reloaded.querySelector("[data-auto-route]")).not.toBeNull();
    expect(reloaded.querySelectorAll("[data-unconnected-exits] li")).toHaveLength(3);
  });

  it("流程以「结束」收尾时,入线来自最后一个非结束节点:它原来去结束的通过线改指向新节点,结束不长出口", async () => {
    await openEditor(template([
      { ...BASE, id: "n1", node_name: "收案登记", node_type: "TRIAL", node_order: 1, on_pass: "n2" },
      { ...BASE, id: "n2", node_name: "Minos", node_type: "FINAL", node_order: 2, on_pass: "n3" },
      { ...BASE, id: "n3", node_name: "结束", node_type: "FINAL", node_order: 3, kind: "END", approver_type: "SYSTEM" },
    ]));
    addAutoRoute();
    const id = newCard().getAttribute("data-testid")!.replace("card-", "");
    const from = (src: string) => Array.from(document.querySelectorAll(`[data-source="${src}"]`)).map((e) => e.getAttribute("data-testid"));
    expect(from("n3")).toEqual([]);
    expect(from("n2")).toEqual([`edge-en2-${id}`]);
  });

  it("「问题」里点「亚洲」那一行,焦点落到那条出口的下拉;三条缺口各一行,不撞 key", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    await openEditor();
    addAutoRoute();
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(tZh("workflow.editor.tab.issues")) }));
    const id = newCard().getAttribute("data-testid")!.replace("card-", "");
    const row = await screen.findByText(
      tZh("workflow.editor.issue.auto_route_exit_missing", { node: "N3「按出身地域分流」", region: "亚洲" }),
    );
    fireEvent.click(row);
    await waitFor(() => expect(document.activeElement?.id).toBe(`${id}-exit-ASIA`));
    expect(error.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    error.mockRestore();
  });
});
