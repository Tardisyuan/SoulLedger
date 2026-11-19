/**
 * app/workflow/[id]/page.tsx -- three facts the officer App's item detail (todoFacts.tsx) shows and the page did not:
 *   who started the flow and from which hall (only in `/officer-app/items/<kind>/<id>/`'s facts);
 *   the real deadline (`activated_at + timeout_hours`), the 「N 小时后」 rule kept beside it;
 *   the step position counted over decision steps only (通知 / 结束 are not steps), not the raw `node_order`.
 */
import { screen, within } from "@testing-library/react";
import WorkflowDetailPage from "@/app/workflow/[id]/page";
import { deadlineDistance, decisionStepPosition, nodeDeadline } from "@/src/components/workflow/detail/approvalFacts";
import egy from "@soulledger/core/messages/egy.json";
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
  const at = (iso: string) => jest.spyOn(Date, "now").mockReturnValue(new Date(iso).getTime());
  afterEach(() => jest.restoreAllMocks());

  // 第五十九批 N11: 「{time} 截止 · 还有 {left} · 到时转交上级」, not 「24 小时后」 (read as "due in 24 hours").
  it("says the time it runs out and how long is left, then the escalation", async () => {
    at("2026-11-01T08:20:00Z");
    workflowApi.get.mockResolvedValue(workflow());
    officerAppApi.item.mockResolvedValue(facts({}));
    renderPage();
    const line = await screen.findByTestId("workflow-deadline");
    // 第六十批 P9: the duration is `common.duration.hours` 「23 小时」, no 「后」.
    expect(line).toHaveTextContent(tZh("workflow.detail.deadline_line", { time: "dt(2026-11-02T08:00:00.000Z)", left: "23 小时" }));
    expect(line).not.toHaveTextContent("小时后");
    expect(line).not.toHaveAttribute("data-overdue");
    expect(line.className).not.toContain("color-warning");
  });

  it("past it, says how late and that it went up, in warning ink", async () => {
    at("2026-11-02T11:00:00Z");
    workflowApi.get.mockResolvedValue(workflow());
    officerAppApi.item.mockResolvedValue(facts({}));
    renderPage();
    const line = await screen.findByTestId("workflow-deadline");
    expect(line).toHaveTextContent(new RegExp(`^${tZh("workflow.detail.deadline_overdue", { late: "3 小时" })}$`));
    expect(line).toHaveAttribute("data-overdue");
    expect(line.className).toContain("color-warning");
  });

  // 第六十批 P8: each timeout action has its own pair; past the deadline warning ink, except a refusal already made (--sub).
  it.each([
    ["AUTO_REJECT", "workflow.detail.deadline_line_auto_reject", "workflow.detail.deadline_overdue_auto_reject", false],
    ["NOTIFY", "workflow.detail.deadline_line_notify", "workflow.detail.deadline_overdue_notify", true],
  ] as const)("%s: its own line before the deadline, its own after", async (action, lineKey, overdueKey, warns) => {
    at("2026-11-01T08:20:00Z");
    workflowApi.get.mockResolvedValue(workflow({ ...CURRENT, timeout_action: action }));
    officerAppApi.item.mockResolvedValue(facts({}));
    const first = renderPage();
    const line = await screen.findByTestId("workflow-deadline");
    expect(line.textContent).toBe(tZh(lineKey, { time: "dt(2026-11-02T08:00:00.000Z)", left: "23 小时" }));
    // Absence: not the escalation wording, not the old 「24 小时后 · 动作」 rule line.
    expect(line).not.toHaveTextContent(tZh("workflow.editor.timeout.action.ESCALATE"));
    expect(line).not.toHaveTextContent("小时后");
    expect(line.className).not.toContain("color-warning");
    first.unmount();

    at("2026-11-02T11:00:00Z");
    renderPage();
    const late = await screen.findByTestId("workflow-deadline");
    expect(late.textContent).toBe(tZh(overdueKey, { late: "3 小时" }));
    expect(late).toHaveAttribute("data-overdue");
    expect(late.className.includes("color-warning")).toBe(warns);
    if (!warns) expect(late.className).toContain("color-ink-muted");
  });

  it("an unknown action keeps the rule's own words", async () => {
    workflowApi.get.mockResolvedValue(workflow({ ...CURRENT, timeout_action: "SOMETHING_ELSE" }));
    officerAppApi.item.mockResolvedValue(facts({}));
    renderPage();
    const line = await screen.findByTestId("workflow-deadline");
    expect(line).toHaveTextContent(tZh("workflow.detail.deadline", { time: "dt(2026-11-02T08:00:00.000Z)" }));
  });

  it("deadlineDistance rounds down, in minutes / hours / days, in common.duration.* (第六十批 P9)", () => {
    const now = new Date("2026-11-01T00:00:00Z").getTime();
    const later = (ms: number) => new Date(now + ms).toISOString();
    expect(deadlineDistance(later(59 * 60_000 + 59_000), now, tZh)).toEqual({ overdue: false, text: "59 分钟" });
    expect(deadlineDistance(later(10_000), now, tZh).text).toBe("1 分钟");
    expect(deadlineDistance(later(47.9 * 3_600_000), now, tZh).text).toBe("47 小时");
    expect(deadlineDistance(later(49 * 3_600_000), now, tZh).text).toBe("2 天");
    expect(deadlineDistance(later(-2 * 3_600_000), now, tZh)).toEqual({ overdue: true, text: "2 小时" });
    // egy: the unit before the number (「Unut 24」), not English h / d.
    const units = egy.common.duration as Record<string, string>;
    const tEgy = (k: string, v?: Record<string, string>) => units[k.split(".").pop()!].replace("{{n}}", v!.n);
    expect(deadlineDistance(later(24 * 3_600_000), now, tEgy).text).toBe("Unut 24");
    expect(deadlineDistance(later(72 * 3_600_000), now, tEgy).text).toBe("Hru 3");
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

// 第五十九批 N14: 「{name} · {time} 处理」 beside the status tag, in place of the 「最近一步」 panel.
describe("who handled it last", () => {
  const withFirst = (over: Record<string, unknown>) => ({
    data: { ...workflow().data, nodes: [NOTIFY, { ...FIRST, decided_at: "2026-11-01T07:00:00Z", verdict: "PASSED", ...over }, CURRENT, END] },
  });
  const time = "dt(2026-11-01T07:00:00Z)";

  it("names the approver of the node decided last, with its time", async () => {
    workflowApi.get.mockResolvedValue(withFirst({ approver: 7, approver_display_name: "孟判官", approver_username: "meng" }));
    officerAppApi.item.mockResolvedValue(facts({}));
    renderPage();
    expect((await screen.findByTestId("handled-by")).textContent).toBe(tZh("common.handled_by", { name: "孟判官", time }));
    expect(screen.queryByText(/最近一步/)).toBeNull();
  });

  it("writes the node's hall when the approver's name is withheld", async () => {
    workflowApi.get.mockResolvedValue(withFirst({ approver: 7, approver_display_name: null, approver_username: null }));
    officerAppApi.item.mockResolvedValue(facts({}));
    renderPage();
    const line = await screen.findByTestId("handled-by");
    expect(line).toHaveTextContent(/^\S.* · dt\(2026-11-01T07:00:00Z\) 处理$/);
    expect(line).not.toHaveTextContent("孟判官");
  });

  it("names no one for a node nobody decided", async () => {
    workflowApi.get.mockResolvedValue(withFirst({ approver: null, approver_display_name: null, approver_username: null, status: "SKIPPED", verdict: null }));
    officerAppApi.item.mockResolvedValue(facts({}));
    renderPage();
    await screen.findByTestId("workflow-deadline");
    expect(screen.queryByTestId("handled-by")).toBeNull();
  });
});
