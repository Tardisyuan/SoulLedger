/**
 * app/workflow/[id]/page.tsx -- three facts the officer App's item detail (todoFacts.tsx) shows and the page did not:
 *   who started the flow and from which hall (only in `/officer-app/items/<kind>/<id>/`'s facts);
 *   the real deadline (`activated_at + timeout_hours`), the 「N 小时后」 rule kept beside it;
 *   the step position counted over decision steps only (通知 / 结束 are not steps), not the raw `node_order`.
 */
import { screen, within } from "@testing-library/react";
import WorkflowDetailPage from "@/app/workflow/[id]/page";
import { decisionStepPosition, nodeDeadline } from "@/src/components/workflow/detail/approvalFacts";
import { tZh } from "./support/zhBundle";
import { renderWithProviders } from "./support/render";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  workflowApi: { get: jest.fn(), approveNode: jest.fn(), advance: jest.fn(), escalate: jest.fn() },
  officerAppApi: { todo: jest.fn(), item: jest.fn() },
  soulAccountsApi: { rebirthApplications: jest.fn() },
}));
const { workflowApi, officerAppApi } = jest.requireMock("@soulledger/core/api") as {
  workflowApi: Record<"get", jest.Mock>;
  officerAppApi: Record<"todo" | "item", jest.Mock>;
};

jest.mock("next/navigation", () => ({ useParams: () => ({ id: "w1" }), useRouter: () => ({ push: jest.fn() }) }));
const mockUser = { id: 1, username: "judge", role: "JUDGE", permissions: ["workflow.read", "workflow.approve"] };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ actual: true, zh: "stable", tf: (_k: string, f: string) => f, formatDateTime: (v: string) => `dt(${v})`, formatDate: (v: string) => v, locale: "zh-Hans", hydrated: true }));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const base = { workflow: "w1", node_type: "EVALUATION", court_code: "第一殿", approver_type: "ROLE", approver_role: "JUDGE", decided_at: null, notes: "" };
const NOTIFY = { ...base, id: "n0", node_name: "通知", node_order: 1, kind: "NOTIFY", status: "TRAVERSED" };
const FIRST = { ...base, id: "n1", node_name: "初审", node_order: 2, kind: "APPROVAL", status: "APPROVED" };
const CURRENT = { ...base, id: "n2", node_name: "复审", node_order: 3, kind: "APPROVAL", status: "PENDING", timeout_hours: 24, timeout_action: "ESCALATE", activated_at: "2026-11-01T08:00:00Z" };
const END = { ...base, id: "n3", node_name: "结束", node_order: 4, kind: "END", status: "PENDING" };

function workflow(current: Record<string, unknown> = CURRENT) {
  return {
    data: {
      id: "w1", workflow_name: "转生配额审批", case_type: "OTHER", soul: "s1", soul_name: "张三", priority: 0, status: "IN_PROGRESS",
      is_appeal: false, cross_civilization: false, created_at: "2026-10-09T00:00:00Z", completed_at: null, judgment: null,
      current_node: current.id, can_approve: false, current_node_detail: current, nodes: [NOTIFY, FIRST, current, END], updated_at: "2026-10-09T00:00:00Z",
    },
  };
}

const facts = (over: Record<string, unknown>) => ({ data: { kind: "approval", id: "w1", facts: over } });
const renderPage = () => renderWithProviders(<WorkflowDetailPage />, { i18n: false });

beforeEach(() => {
  jest.clearAllMocks();
  officerAppApi.todo.mockResolvedValue({ data: {} });
});

describe("who started it", () => {
  it("names the requester and the hall from the item's facts", async () => {
    workflowApi.get.mockResolvedValue(workflow());
    officerAppApi.item.mockResolvedValue(facts({ requester: "孟判官", requester_hall: { code: "hall-x", display_name: "第三殿" } }));
    renderPage();
    const row = await screen.findByTestId("workflow-requester");
    expect(row).toHaveTextContent("孟判官 · 第三殿");
    expect(officerAppApi.item).toHaveBeenCalledWith("approval", "w1");
    expect(row.previousElementSibling).toHaveTextContent(tZh("officer_app.detail.requester"));
  });

  it("keeps the hall when another hall's name is withheld", async () => {
    workflowApi.get.mockResolvedValue(workflow());
    officerAppApi.item.mockResolvedValue(facts({ requester: null, requester_hall: { code: "hall-x", display_name: "第三殿" } }));
    renderPage();
    expect(await screen.findByTestId("workflow-requester")).toHaveTextContent(/^第三殿$/);
  });

  it("draws no row when the item cannot be read", async () => {
    workflowApi.get.mockResolvedValue(workflow());
    officerAppApi.item.mockRejectedValue(Object.assign(new Error("403"), { response: { status: 403 } }));
    renderPage();
    await screen.findByTestId("workflow-deadline");
    expect(screen.queryByTestId("workflow-requester")).toBeNull();
  });
});

describe("the deadline", () => {
  it("is a date-time, with the hours rule kept", async () => {
    workflowApi.get.mockResolvedValue(workflow());
    officerAppApi.item.mockResolvedValue(facts({}));
    renderPage();
    const line = await screen.findByTestId("workflow-deadline");
    expect(line).toHaveTextContent(tZh("workflow.detail.deadline", { time: "dt(2026-11-02T08:00:00.000Z)" }));
    expect(line).toHaveTextContent(tZh("workflow.editor.timeout.summary", { hours: "24", action: tZh("workflow.editor.timeout.action.ESCALATE") }));
  });

  it("without activated_at keeps only the rule", async () => {
    workflowApi.get.mockResolvedValue(workflow({ ...CURRENT, activated_at: null }));
    officerAppApi.item.mockResolvedValue(facts({}));
    renderPage();
    const line = await screen.findByTestId("workflow-deadline");
    expect(line).not.toHaveTextContent("dt(");
  });

  it("nodeDeadline adds the hours to activated_at, and needs both", () => {
    expect(nodeDeadline({ activated_at: "2026-11-01T08:00:00Z", timeout_hours: 30 })).toBe("2026-11-02T14:00:00.000Z");
    expect(nodeDeadline({ activated_at: "2026-11-01T08:00:00Z", timeout_hours: null })).toBeNull();
    expect(nodeDeadline({ activated_at: null, timeout_hours: 3 })).toBeNull();
  });
});

describe("the step position", () => {
  it("counts decision steps only, not node_order", async () => {
    workflowApi.get.mockResolvedValue(workflow());
    officerAppApi.item.mockResolvedValue(facts({}));
    renderPage();
    const pos = await screen.findByTestId("workflow-step-position");
    // 通知 and 结束 are not steps: 复审 is the 2nd of 2, though its node_order is 3 of 4.
    expect(pos).toHaveTextContent(tZh("plaque.step", { k: "2", n: "2" }));
    expect(within(pos.parentElement!).queryByText(tZh("workflow.detail.order"))).toBeNull();
  });

  it("decisionStepPosition matches the server's index / total", () => {
    const nodes = [NOTIFY, FIRST, CURRENT, END] as Parameters<typeof decisionStepPosition>[0];
    expect(decisionStepPosition(nodes, "n1")).toEqual({ k: 1, n: 2 });
    expect(decisionStepPosition(nodes, "n2")).toEqual({ k: 2, n: 2 });
    // A current node that is not a step reads as the last one, as `workflow_facts` does.
    expect(decisionStepPosition(nodes, "n3")).toEqual({ k: 2, n: 2 });
    expect(decisionStepPosition(nodes, null)).toBeNull();
  });
});
