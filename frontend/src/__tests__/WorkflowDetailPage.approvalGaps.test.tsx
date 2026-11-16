/**
 * app/workflow/[id]/page.tsx -- three things the officer App had and the web did not:
 *   加签 (sheets.tsx CosignSheet): the approver adds a same-hall colleague; refusals land inline.
 *   「下一件」 after a decision (detail.tsx NextBar): the next row of the to-do's own group, 「{name} · 还剩 n 件」.
 *   「最近用过」 above a refusal's notes (memory.ts): remembered only when the server took the refusal.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import WorkflowDetailPage from "@/app/workflow/[id]/page";
import { readReasons, rememberReason } from "@/src/lib/recentRejectReasons";
import { tZh } from "./support/zhBundle";
import { renderWithProviders } from "./support/render";
import { http, page } from "./support/mocks";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  workflowApi: { get: jest.fn(), approveNode: jest.fn(), advance: jest.fn(), escalate: jest.fn() },
  officerAppApi: { todo: jest.fn(), item: jest.fn(), signerCandidates: jest.fn(), addCosigner: jest.fn() },
  soulAccountsApi: { rebirthApplications: jest.fn() },
}));
const { workflowApi, officerAppApi, soulAccountsApi } = jest.requireMock("@soulledger/core/api") as {
  workflowApi: Record<"get" | "approveNode", jest.Mock>;
  officerAppApi: Record<"todo" | "item" | "signerCandidates" | "addCosigner", jest.Mock>;
  soulAccountsApi: Record<"rebirthApplications", jest.Mock>;
};

jest.mock("next/navigation", () => ({ useParams: () => ({ id: "w1" }), useRouter: () => ({ push: jest.fn() }) }));

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ actual: true, zh: "stable", tf: (_k: string, f: string) => f, formatDateTime: (v: string) => `dt(${v})`, formatDate: (v: string) => v, locale: "zh-Hans", hydrated: true }));
const mockToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockToast }) }));

const NODE = { id: "n1", workflow: "w1", node_name: "判官初审", node_type: "EVALUATION", court_code: "第一殿", node_order: 1, approver_type: "ROLE", approver_role: "JUDGE", status: "PENDING", decided_at: null, notes: "" };

function workflow(over: Record<string, unknown> = {}) {
  return {
    data: {
      id: "w1", workflow_name: "转生配额审批", case_type: "OTHER", soul: "s1", soul_name: "张三", priority: 0, status: "IN_PROGRESS",
      is_appeal: false, cross_civilization: false, created_at: "2026-10-09T00:00:00Z", completed_at: null, judgment: null,
      current_node: "n1", can_approve: true, current_node_detail: NODE, nodes: [NODE], updated_at: "2026-10-09T00:00:00Z", ...over,
    },
  };
}

const row = (kind: string, id: string, title: string) => ({ kind, id, title, created_at: "2026-10-09T00:00:00Z", target: { kind, id } });
const group = (count: number, items: unknown[]) => ({ count, items });
const EMPTY = group(0, []);
function todo(over: Record<string, unknown>) {
  return { data: { approvals: EMPTY, reassignments: EMPTY, cooldowns: EMPTY, rebirths: EMPTY, sentence_changes: EMPTY, letters: EMPTY, unassigned_letters: EMPTY, pick_nodes: EMPTY, city_god: EMPTY, wangsi: EMPTY, ...over } };
}

const renderPage = () => renderWithProviders(<WorkflowDetailPage />, { i18n: false });
const pick = async (v: string) => fireEvent.click(await screen.findByLabelText(tZh(`workflow.verdicts.${v}`)));
const submit = () => fireEvent.click(screen.getByRole("button", { name: tZh("workflow.detail.submit_decision") }));
const notesBox = () => screen.getByLabelText(tZh("workflow.detail.notes"));

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockUser = { id: 1, username: "judge", role: "JUDGE", permissions: ["workflow.read", "workflow.approve"] };
  workflowApi.get.mockResolvedValue(workflow());
  officerAppApi.todo.mockResolvedValue(todo({ approvals: group(3, [row("approval", "w0", "甲流程"), row("approval", "w1", "转生配额审批"), row("approval", "w2", "乙流程")]) }));
});

describe("下一件 after a decision", () => {
  it("appears only once the decision went through, pointing at the next row of the to-do", async () => {
    workflowApi.approveNode.mockResolvedValue({ data: {} });
    renderPage();
    await pick("passed");
    expect(screen.queryByTestId("next-bar")).toBeNull();
    await waitFor(() => expect(officerAppApi.todo).toHaveBeenCalled());
    submit();
    const bar = await screen.findByTestId("next-bar");
    const next = within(bar).getByTestId("next-bar-next");
    expect(next).toHaveAttribute("href", "/workflow/w2");
    expect(next).toHaveTextContent(tZh("officer_app.detail.next_meta", { name: "乙流程", n: "1" }));
    expect(next).toHaveAccessibleName(tZh("officer_app.detail.next_aria", { name: "乙流程", n: "1" }));
    expect(within(bar).getByTestId("next-bar-leave")).toHaveAttribute("href", "/dashboard");
    expect(within(bar).getByTestId("next-bar-leave")).toHaveTextContent(tZh("officer_app.detail.back_to_todo"));
  });

  it("keeps the answer when the refetched to-do no longer holds the decided item", async () => {
    workflowApi.approveNode.mockResolvedValue({ data: {} });
    const { client } = renderPage();
    await pick("passed");
    await waitFor(() => expect(officerAppApi.todo).toHaveBeenCalled());
    officerAppApi.todo.mockResolvedValue(todo({ approvals: group(2, [row("approval", "w0", "甲流程"), row("approval", "w2", "乙流程")]) }));
    submit();
    await screen.findByTestId("next-bar");
    const before = officerAppApi.todo.mock.calls.length;
    await client.refetchQueries();
    expect(officerAppApi.todo.mock.calls.length).toBeGreaterThan(before);
    // The refetched to-do no longer has w1; the answer read while it was there stays.
    await waitFor(() => expect(client.getQueryData<{ approvals: { count: number } }>(["dashboard", "todo", "officer"])?.approvals.count).toBe(2));
    await act(async () => {});
    expect(screen.getByTestId("next-bar-next")).toHaveAttribute("href", "/workflow/w2");
  });

  it("the group's last row: one way back, saying it is all done", async () => {
    officerAppApi.todo.mockResolvedValue(todo({ approvals: group(2, [row("approval", "w0", "甲流程"), row("approval", "w1", "转生配额审批")]) }));
    workflowApi.approveNode.mockResolvedValue({ data: {} });
    renderPage();
    await pick("passed");
    await waitFor(() => expect(officerAppApi.todo).toHaveBeenCalled());
    submit();
    const bar = await screen.findByTestId("next-bar");
    expect(within(bar).queryByTestId("next-bar-next")).toBeNull();
    expect(within(bar).getByTestId("next-bar-leave")).toHaveTextContent(tZh("officer_app.detail.all_done"));
  });

  it("a failed decision shows no bar", async () => {
    workflowApi.approveNode.mockRejectedValue(http(500));
    renderPage();
    await pick("passed");
    submit();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.any(String), "error"));
    expect(screen.queryByTestId("next-bar")).toBeNull();
  });

  it("a rebirth row opens its application's workflow", async () => {
    workflowApi.get.mockResolvedValue(workflow({ case_type: "REBIRTH_APPLICATION" }));
    soulAccountsApi.rebirthApplications.mockResolvedValue(page([{ id: "r1", workflow: "w1", appeal_workflow: null }]));
    officerAppApi.todo.mockResolvedValue(todo({ rebirths: group(2, [row("rebirth", "r1", "张三"), row("rebirth", "r2", "王五")]) }));
    officerAppApi.item.mockResolvedValue({ data: { kind: "rebirth", id: "r2", workflow_id: "w9" } });
    workflowApi.approveNode.mockResolvedValue({ data: {} });
    renderPage();
    await pick("passed");
    await waitFor(() => expect(soulAccountsApi.rebirthApplications).toHaveBeenCalledWith({ soul: "s1" }));
    await waitFor(() => expect(officerAppApi.todo).toHaveBeenCalled());
    submit();
    expect(await screen.findByTestId("next-bar-next")).toHaveAttribute("href", "/workflow/w9");
    expect(officerAppApi.item).toHaveBeenCalledWith("rebirth", "r2");
  });
});

describe("最近用过 above a refusal's notes", () => {
  it("offers this officer's reasons for a refusal only, and a tap fills then adds", async () => {
    rememberReason(1, "材料不全");
    rememberReason(2, "别人的理由");
    renderPage();
    await pick("passed");
    expect(screen.queryByTestId("recent-reasons")).toBeNull();
    await pick("rejected");
    const rows = within(screen.getByTestId("recent-reasons")).getAllByRole("button");
    expect(rows.map((b) => b.textContent)).toEqual(["↺材料不全"]);
    fireEvent.click(rows[0]);
    expect(notesBox()).toHaveValue("材料不全");
    fireEvent.click(rows[0]);
    expect(notesBox()).toHaveValue("材料不全\n材料不全");
  });

  it("remembers a refusal the server took", async () => {
    workflowApi.approveNode.mockResolvedValue({ data: {} });
    renderPage();
    await pick("failed");
    fireEvent.change(notesBox(), { target: { value: "证据不足" } });
    submit();
    await screen.findByTestId("next-bar");
    expect(readReasons(1)).toEqual(["证据不足"]);
  });

  it("does not remember a refusal the server refused, nor the notes of a pass", async () => {
    workflowApi.approveNode.mockRejectedValueOnce(http(500));
    renderPage();
    await pick("rejected");
    fireEvent.change(notesBox(), { target: { value: "没发出去" } });
    submit();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.any(String), "error"));
    workflowApi.approveNode.mockResolvedValue({ data: {} });
    await pick("passed");
    fireEvent.change(notesBox(), { target: { value: "同意" } });
    submit();
    await screen.findByTestId("next-bar");
    expect(readReasons(1)).toEqual([]);
  });
});

describe("加签", () => {
  const MENG = { id: 5, name: "孟判官", username: "meng", role: "JUDGE" };
  async function openAndPick() {
    renderPage();
    fireEvent.click(await screen.findByTestId("cosign-open"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("cosign-rules")).toHaveTextContent(tZh("officer_app.cosign.rules"));
    fireEvent.change(within(dialog).getByLabelText(tZh("officer_app.cosign.search")), { target: { value: "孟" } });
    await waitFor(() => expect(officerAppApi.signerCandidates).toHaveBeenLastCalledWith("孟"));
    const option = await screen.findByRole("option", { name: /孟判官/ });
    // 第五十九批 N10: the name on top, 「用户名 · 角色」 underneath -- the officer App's two lines.
    expect(option.querySelector("[data-option-detail]")?.previousElementSibling).toHaveTextContent(/^孟判官$/);
    expect(option.querySelector("[data-option-detail]")).toHaveTextContent(new RegExp(`^meng · ${tZh("users.roles.JUDGE")}$`));
    expect(option).not.toHaveTextContent("孟判官 · meng");
    fireEvent.click(option);
    fireEvent.click(within(dialog).getByTestId("cosign-confirm"));
    return dialog;
  }

  beforeEach(() => officerAppApi.signerCandidates.mockResolvedValue({ data: [MENG] }));

  it("is offered to the approver of this stop only", async () => {
    workflowApi.get.mockResolvedValue(workflow({ can_approve: false }));
    renderPage();
    await screen.findByTestId("workflow-no-decision");
    expect(screen.queryByTestId("cosign-open")).toBeNull();
  });

  it("adds the picked colleague to this approval and reloads the workflow", async () => {
    officerAppApi.addCosigner.mockResolvedValue({ data: {} });
    await openAndPick();
    await waitFor(() => expect(officerAppApi.addCosigner).toHaveBeenCalledWith("approval", "w1", 5));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockToast).toHaveBeenCalledWith(tZh("officer_app.cosign.added"), "success");
    expect(workflowApi.get.mock.calls.length).toBeGreaterThan(1);
  });

  it("a rebirth application's flow is added to as its application, not as a plain approval", async () => {
    workflowApi.get.mockResolvedValue(workflow({ case_type: "REBIRTH_APPLICATION" }));
    soulAccountsApi.rebirthApplications.mockResolvedValue(page([{ id: "r0", workflow: "w0", appeal_workflow: null }, { id: "r1", workflow: "w8", appeal_workflow: "w1" }]));
    officerAppApi.addCosigner.mockResolvedValue({ data: {} });
    await openAndPick();
    await waitFor(() => expect(officerAppApi.addCosigner).toHaveBeenCalledWith("rebirth", "r1", 5));
  });

  it("a person the server refuses is said under the field; the dialog stays", async () => {
    officerAppApi.addCosigner.mockRejectedValue(http(400, { code: "duplicate" }));
    const dialog = await openAndPick();
    expect(await within(dialog).findByText(tZh("officer_app.cosign.duplicate"))).toBeInTheDocument();
    expect(within(dialog).getByTestId("cosign-confirm")).toBeEnabled();
  });

  it("not_allowed greys the confirm and says why, without a promise", async () => {
    officerAppApi.addCosigner.mockRejectedValue(http(403, { code: "not_allowed" }));
    const dialog = await openAndPick();
    expect(await within(dialog).findByTestId("cosign-unavailable")).toHaveTextContent(`◇ ${tZh("officer_app.cosign.unavailable")}`);
    expect(within(dialog).getByTestId("cosign-confirm")).toBeDisabled();
    expect(within(dialog).queryByText(tZh("officer_app.cosign.duplicate"))).toBeNull();
  });
});
