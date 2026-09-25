/**
 * The editor half of the workflow engine work (template versions, 会签 / 通知 /
 * 结束, 驳回到, 超时, condition branches): the client validator that mirrors
 * `backend/apps/workflow/validation.py`, the round trip of every new field
 * through the canvas, and the two buttons (存草稿 / 发布) with the version
 * badge.
 *
 * The validator's condition analysis is the same box arithmetic as the Python
 * original; `test_regions_are_exact_over_integers_and_sets` on the backend and
 * the "exact over integers" case here assert the same four facts.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Edge, Node } from "@xyflow/react";

jest.mock("@xyflow/react", () => {
  const React = require("react");
  return {
    ReactFlow: ({ children, nodes }: any) => (
      <div data-testid="react-flow">
        {(nodes ?? []).map((n: any) => (
          <div key={n.id} className="react-flow__node" data-id={n.id} tabIndex={0} aria-label={n.ariaLabel} />
        ))}
        {children}
      </div>
    ),
    Controls: () => null,
    Background: () => null,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom" },
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

const STORED = {
  id: "t1",
  name: "跨文明移交 · 两级",
  description: "",
  civilization: "CHINESE",
  case_type: "ROUTINE",
  priority: 0,
  is_active: true,
  published_version: 3,
  draft_version: 4,
  created_at: "",
  updated_at: "",
  node_count: 5,
  nodes: [
    { id: "n1", node_name: "来源殿审批", node_type: "TRIAL", court_code: "", approver_role: "JUDGE", approver_type: "ROLE", node_order: 1, on_pass: "n2" },
    {
      id: "n2", node_name: "余额 < 0 ?", node_type: "TRIAL", court_code: "", approver_role: "JUDGE", approver_type: "ROLE", node_order: 2,
      on_pass: "n4",
      branches: [{ id: "neg", when: [{ fact: "balance", op: "lt", value: 0 }], target: "n3" }],
    },
    {
      id: "n3", node_name: "两文明判官", node_type: "TRIAL", court_code: "", approver_role: "", approver_type: "ROLE", node_order: 3,
      on_pass: "n5", kind: "COUNTERSIGN", threshold: 2,
      signers: [
        { label: "Minos", approver_type: "ROLE", approver_role: "JUDGE" },
        { label: "Osiris", approver_type: "ROLE", approver_role: "JUDGE" },
      ],
    },
    {
      id: "n4", node_name: "目标文明判官", node_type: "TRIAL", court_code: "", approver_role: "JUDGE", approver_type: "ROLE", node_order: 4,
      on_pass: "n5", reject_to: "n1", timeout_hours: 72, timeout_action: "ESCALATE", timeout_role: "MODERATOR",
    },
    { id: "n5", node_name: "移交完成", node_type: "FINAL", court_code: "", approver_role: "", approver_type: "ROLE", node_order: 5, kind: "END" },
  ],
};

jest.mock("@soulledger/core/api", () => ({
  workflowApi: {
    templates: {
      get: jest.fn(),
      create: jest.fn().mockResolvedValue({ data: { id: "new-1" } }),
      update: jest.fn().mockResolvedValue({ data: { id: "t1" } }),
      publish: jest.fn().mockResolvedValue({ data: { id: "t1", published_version: 4 } }),
      versions: jest.fn().mockResolvedValue({
        data: [
          { id: "v4", number: 4, status: "DRAFT", nodes: [], created_at: "", updated_at: "2026-09-25T00:00:00Z", published_at: null, saved_by_name: "崔珏", published_by_name: null },
          { id: "v3", number: 3, status: "PUBLISHED", nodes: [], created_at: "", updated_at: "", published_at: "2026-09-20T00:00:00Z", saved_by_name: null, published_by_name: "崔珏" },
        ],
      }),
      approverPreview: jest.fn().mockResolvedValue({
        data: {
          node: "n4", civilization: "CHINESE", tenant: "CN_DIYU", kind: "APPROVAL",
          approver_type: "ROLE", actor: null, role: "JUDGE", users: [{ display_name: "崔珏", role: "JUDGE" }], user_count: 1, signers: [],
        },
      }),
    },
  },
  permApi: { roles: { list: jest.fn().mockResolvedValue({ data: [{ id: 1, name: "JUDGE", display_name: "Judge", is_builtin: true }] }) } },
}));

// Keys come back as themselves, params appended — so an assertion names the
// key it expects AND the value that went into it.
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params && Object.keys(params).length ? `${key}(${Object.values(params).join(",")})` : key,
    locale: "zh-Hans",
  }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
}));

import WorkflowEditor from "@/src/components/workflow/WorkflowEditor";
import { savedTemplateToFlow, type TemplateNode } from "@/src/components/workflow/workflowEditorGraph";
import { SAVE_BLOCKING, nodeRoles, validateFlow } from "@/src/components/workflow/workflowValidation";
import { overlaps, region } from "@/src/components/workflow/workflowConditions";

const api = () => require("@soulledger/core/api").workflowApi.templates;

function node(id: string, data: Record<string, unknown> = {}): Node {
  return { id, position: { x: 0, y: 0 }, data: { label: id, nodeType: "TRIAL", ...data } };
}
function edge(source: string, target: string, extra: Partial<Edge> = {}): Edge {
  return { id: `${source}-${target}-${extra.sourceHandle ?? "pass"}`, source, target, sourceHandle: "pass", ...extra };
}
const codes = (nodes: Node[], edges: Edge[]) => validateFlow(nodes, edges).map((i) => `${i.nodeId}:${i.code}`);

// ── the validator ─────────────────────────────────────────────────────

describe("validateFlow — the rules the backend enforces at publish", () => {
  it("a linear template raises none of the graph rules (absence)", () => {
    expect(validateFlow([node("a"), node("b"), node("c")], [edge("a", "b"), edge("b", "c")])).toEqual([]);
  });

  it("a graph flags an unreachable node, a node with no exit, and a missing end", () => {
    // a ─(balance < 0)→ n ; a ─default→ n ; island → n ; n (通知) has no way out.
    const got = codes(
      [node("a"), node("island"), node("n", { kind: "NOTIFY" })],
      [
        { ...edge("a", "n"), id: "cond", data: { when: [{ fact: "balance", op: "lt", value: 0 }] } },
        edge("a", "n"),
        edge("island", "n"),
      ]
    );
    expect(got).toEqual(expect.arrayContaining(["island:unreachable", "n:no_exit", ":no_end"]));
    // Absence: the entry is reachable by definition.
    expect(got).not.toContain("a:unreachable");
  });

  it("overlapping and empty conditions are refused; complementary ones are not", () => {
    const cond = (id: string, target: string, when: unknown[]) => ({ ...edge("a", target), id, data: { when } });
    const end = node("z", { kind: "END" });
    const overlap = codes(
      [node("a"), node("b"), node("c"), end],
      [cond("x", "b", [{ fact: "balance", op: "lt", value: 0 }]), cond("y", "c", [{ fact: "balance", op: "lte", value: 5 }]),
        edge("a", "z"), edge("b", "z"), edge("c", "z")]
    );
    expect(overlap).toContain("a:condition_overlap");
    const empty = codes(
      [node("a"), node("b"), end],
      [cond("x", "b", [{ fact: "balance", op: "gt", value: 5 }, { fact: "balance", op: "lt", value: 2 }]), edge("a", "z"), edge("b", "z")]
    );
    expect(empty).toContain("a:condition_empty");
    const clean = codes(
      [node("a"), node("b"), node("c"), end],
      [cond("x", "b", [{ fact: "balance", op: "lt", value: 0 }]), cond("y", "c", [{ fact: "balance", op: "gte", value: 0 }]),
        edge("a", "z"), edge("b", "z"), edge("c", "z")]
    );
    expect(clean).toEqual([]);
  });

  it("reject-to, timeout and countersign rules", () => {
    const got = codes(
      [
        node("a", { rejectTo: "b" }),
        node("b", { timeoutHours: 4 }),
        node("c", { timeoutHours: 4, timeoutAction: "ESCALATE" }),
        node("d", { kind: "COUNTERSIGN", signers: [] }),
        node("e", { kind: "COUNTERSIGN", signers: [{ label: "x", approver_type: "ROLE", approver_role: "JUDGE" }], threshold: 3 }),
      ],
      []
    );
    expect(got).toEqual(
      expect.arrayContaining([
        "a:reject_not_earlier",
        "b:timeout_incomplete",
        "c:timeout_role_missing",
        "d:countersign_no_signers",
        "e:threshold_out_of_range",
      ])
    );
  });

  it("only what a draft cannot hold blocks 存草稿; the rest blocks 发布", () => {
    expect([...SAVE_BLOCKING].sort()).toEqual(["duplicate_route", "name_empty", "self_route"]);
    // Two conditional PASS edges from one node are branches, not duplicates.
    const issues = validateFlow(
      [node("a"), node("b"), node("c"), node("z", { kind: "END" })],
      [
        { ...edge("a", "b"), id: "x", data: { when: [{ fact: "balance", op: "lt", value: 0 }] } },
        { ...edge("a", "c"), id: "y", data: { when: [{ fact: "balance", op: "gt", value: 0 }] } },
        edge("a", "z"), edge("b", "z"), edge("c", "z"),
      ]
    );
    expect(issues.filter((i) => SAVE_BLOCKING.has(i.code))).toEqual([]);
  });

  it("the condition boxes are exact over integers, as on the backend", () => {
    const lt0 = region([{ fact: "balance", op: "lt", value: 0 }])!;
    const gtM1 = region([{ fact: "balance", op: "gt", value: -1 }])!;
    expect(overlaps(lt0, gtM1)).toBe(false);
    const cn = region([{ fact: "civilization", op: "in", value: ["CHINESE"] }])!;
    const notCn = region([{ fact: "civilization", op: "not_in", value: ["CHINESE"] }])!;
    expect(overlaps(cn, notCn)).toBe(false);
    expect(overlaps(lt0, cn)).toBe(true);
  });
});

// ── the round trip ────────────────────────────────────────────────────

describe("the canvas carries every new field", () => {
  it("branches become conditional PASS edges, and 结束 is the end role", () => {
    const { nodes, edges } = savedTemplateToFlow(STORED.nodes as TemplateNode[]);
    const cond = edges.find((e) => (e.data as any)?.when);
    expect(cond).toMatchObject({ source: "n2", target: "n3", sourceHandle: "pass", data: { branchId: "neg" } });
    expect(edges.filter((e) => e.source === "n2").map((e) => e.target).sort()).toEqual(["n3", "n4"]);
    const roles = nodeRoles(nodes, edges);
    expect(roles.get("n5")).toBe("end");
    expect(roles.get("n2")).toBe("branch");
    expect(nodes.find((n) => n.id === "n4")!.data).toMatchObject({
      rejectTo: "n1", timeoutHours: 72, timeoutAction: "ESCALATE", timeoutRole: "MODERATOR",
    });
    expect(validateFlow(nodes, edges)).toEqual([]);
  });
});

// ── the editor: badge, 存草稿, 发布 ─────────────────────────────────────

function renderEditor() {
  api().get.mockResolvedValue({ data: STORED });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowEditor templateId="t1" />
    </QueryClientProvider>
  );
}

describe("WorkflowEditor — versions and the engine fields", () => {
  beforeEach(() => {
    api().update.mockClear();
    api().publish.mockClear();
  });

  it("shows 「草稿 v4 · 已发布 v3」 and the read-only history", async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId("version-badge").textContent).toBe(
        "workflow.editor.version.draft(4) · workflow.editor.version.published(3)"
      )
    );
    const history = await screen.findByRole("region", { name: "workflow.editor.version.history" });
    expect(within(history).getByText("v4")).toBeInTheDocument();
    expect(within(history).getByText("v3")).toBeInTheDocument();
    // Read-only: nothing in the history section is a control.
    expect(within(history).queryAllByRole("button")).toEqual([]);
  });

  it("存草稿 sends every new field back as it was loaded", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId("version-badge").textContent).toContain("(4)"));
    await waitFor(() => expect(screen.getByRole("button", { name: "workflow.editor.save_template" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "workflow.editor.save_template" }));
    await waitFor(() => expect(api().update).toHaveBeenCalled());
    expect(api().publish).not.toHaveBeenCalled();

    const sent = api().update.mock.calls.at(-1)![1].nodes;
    const byId = Object.fromEntries(sent.map((n: any) => [n.id, n]));
    expect(byId.n2.branches).toEqual([{ id: "neg", when: [{ fact: "balance", op: "lt", value: 0 }], target: "n3" }]);
    expect(byId.n2.on_pass).toBe("n4");
    expect(byId.n3).toMatchObject({ kind: "COUNTERSIGN", threshold: 2 });
    expect(byId.n3.signers).toHaveLength(2);
    expect(byId.n4).toMatchObject({ reject_to: "n1", timeout_hours: 72, timeout_action: "ESCALATE", timeout_role: "MODERATOR" });
    expect(byId.n5.kind).toBe("END");
    // Absence: a node without a timeout sends null, not "".
    expect(byId.n1.timeout_action).toBeNull();
  });

  it("发布 saves the draft, then publishes it", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByRole("button", { name: "workflow.editor.publish" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "workflow.editor.publish" }));
    await waitFor(() => expect(api().publish).toHaveBeenCalledWith("t1"));
    expect(api().update).toHaveBeenCalledTimes(1);
    expect(api().update.mock.invocationCallOrder[0]).toBeLessThan(api().publish.mock.invocationCallOrder[0]);
  });

  it("a publish-blocking issue disables 发布 and leaves 存草稿 enabled", async () => {
    api().get.mockResolvedValue({
      data: { ...STORED, nodes: [...STORED.nodes.slice(0, 4), { ...STORED.nodes[4], kind: "APPROVAL" }] },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkflowEditor templateId="t1" />
      </QueryClientProvider>
    );
    // Without the 结束 node, the conditional graph has no end.
    await waitFor(() => expect(screen.getAllByText(/workflow\.editor\.issue\.no_end/).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "workflow.editor.publish" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "workflow.editor.save_template" })).toBeEnabled();
  });

  it("the inspector previews a saved node's approver and lists its conditional exits", async () => {
    renderEditor();
    const chip = await screen.findByRole("button", { name: /余额 < 0 \?/ });
    fireEvent.click(chip);
    const exits = await screen.findByRole("region", { name: "workflow.editor.condition.title" });
    expect(within(exits).getByText(/workflow\.editor\.condition\.fact\.balance < 0/)).toBeInTheDocument();
    expect(within(exits).getByText("workflow.editor.condition.default")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /目标文明判官/ }));
    await waitFor(() => expect(api().approverPreview).toHaveBeenCalledWith("t1", { node: "n4", civilization: "CHINESE" }));
    expect(await screen.findByText("workflow.editor.preview_approver.role(JUDGE)")).toBeInTheDocument();
  });

  it("making an exit conditional turns it into a branch on save", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: /来源殿审批/ }));
    const exits = await screen.findByRole("region", { name: "workflow.editor.condition.title" });
    fireEvent.click(within(exits).getByRole("button", { name: "workflow.editor.condition.make" }));
    await waitFor(() => expect(within(exits).getByRole("button", { name: "workflow.editor.condition.clear" })).toBeInTheDocument());
    // It is now a branch with no default beside it — publish must be blocked
    // (no_exit) while the draft still saves.
    expect(screen.getByRole("button", { name: "workflow.editor.publish" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "workflow.editor.save_template" }));
    await waitFor(() => expect(api().update).toHaveBeenCalled());
    const n1 = api().update.mock.calls.at(-1)![1].nodes.find((n: any) => n.id === "n1");
    expect(n1.on_pass).toBeNull();
    expect(n1.branches).toEqual([{ id: expect.any(String), when: [{ fact: "balance", op: "lt", value: 0 }], target: "n2" }]);
  });
});
