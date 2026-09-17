/**
 * app/workflow/[id]/page.tsx — the required "rejection reason for the soul".
 *
 * Shown only when the workflow's `case_type` is REBIRTH_APPLICATION (as the
 * serializer sends it — the workflow NAME is set to something that looks like
 * a rebirth application on the non-rebirth fixture, so a name-based check goes
 * red) and the chosen verdict is not PASSED / CONFIRMED. The backend's 400
 * lands beside the field, and a non-rebirth decision never sends the key.
 *
 * `requiresReasonForSoul` is the real one (requireActual); only the HTTP calls
 * are doubles. Permissions run for real against a stubbed `useTenant`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkflowDetailPage from "@/app/workflow/[id]/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  workflowApi: { get: jest.fn(), approveNode: jest.fn(), advance: jest.fn(), escalate: jest.fn() },
}));
const { workflowApi } = jest.requireMock("@soulledger/core/api") as {
  workflowApi: Record<"get" | "approveNode", jest.Mock>;
};

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "w1" }),
  useRouter: () => ({ push: jest.fn() }),
}));

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, tf: (_k: string, f: string) => f, formatDateTime: (v: string) => `dt(${v})`, formatDate: (v: string) => v, locale: "zh-Hans", hydrated: true }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const NODE = {
  id: "n1",
  workflow: "w1",
  node_name: "判官初审",
  node_type: "EVALUATION",
  court_code: "转生申请",
  node_order: 1,
  approver_type: "ROLE",
  approver_role: "JUDGE",
  status: "PENDING",
  decided_at: null,
  notes: "",
};

function workflow(caseType: string, name: string) {
  return {
    data: {
      id: "w1",
      workflow_name: name,
      case_type: caseType,
      soul: "s1",
      soul_name: "张三",
      priority: 0,
      status: "IN_PROGRESS",
      is_appeal: false,
      cross_civilization: false,
      created_at: "2026-09-17T00:00:00Z",
      completed_at: null,
      judgment: null,
      current_node: "n1",
      current_node_detail: NODE,
      nodes: [NODE],
      updated_at: "2026-09-17T00:00:00Z",
    },
  };
}

const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<WorkflowDetailPage />, { wrapper: Wrapper });
}

const LABEL = () => tZh("workflow.detail.reason_for_soul");
const reasonField = () => screen.queryByLabelText(new RegExp(LABEL()));
const pick = async (verdictKey: string) => fireEvent.click(await screen.findByLabelText(tZh(`workflow.verdicts.${verdictKey}`)));
const submit = () => fireEvent.click(screen.getByRole("button", { name: tZh("workflow.detail.submit_decision") }));

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 2, username: "judge", role: "JUDGE", permissions: ["workflow.read", "workflow.approve"] };
  workflowApi.approveNode.mockResolvedValue(workflow("REBIRTH_APPLICATION", "转生申请: X"));
});

describe("rebirth application workflow", () => {
  beforeEach(() => workflowApi.get.mockResolvedValue(workflow("REBIRTH_APPLICATION", "some workflow")));

  it.each(["rejected", "failed", "skipped"])("a %s verdict shows the required field with the visibility hint", async (v) => {
    renderPage();
    await pick(v);
    const field = reasonField();
    expect(field).not.toBeNull();
    expect(field).toBeRequired();
    expect(field).toHaveAttribute("maxLength", "2000");
    expect(screen.getByText(tZh("workflow.detail.reason_for_soul_hint"))).toBeInTheDocument();
  });

  it.each(["passed", "confirmed"])("a %s verdict shows no reason field", async (v) => {
    renderPage();
    await pick(v);
    expect(reasonField()).toBeNull();
  });

  it("empty reason is stopped before the request, with the message beside the field", async () => {
    renderPage();
    await pick("rejected");
    submit();
    expect(await screen.findByText(tZh("workflow.detail.reason_for_soul_required"))).toBeInTheDocument();
    expect(workflowApi.approveNode).not.toHaveBeenCalled();
  });

  it("sends the reason separately from the internal notes", async () => {
    renderPage();
    await pick("rejected");
    fireEvent.change(screen.getByLabelText(tZh("workflow.detail.notes")), { target: { value: "内部:证据不足" } });
    fireEvent.change(reasonField() as HTMLElement, { target: { value: "  功过未清  " } });
    submit();
    await waitFor(() =>
      expect(workflowApi.approveNode).toHaveBeenCalledWith("w1", "n1", {
        verdict: "REJECTED",
        notes: "内部:证据不足",
        rejection_reason_for_soul: "功过未清",
      })
    );
  });

  it("the backend's 400 for a missing reason lands beside the field, not in a toast", async () => {
    workflowApi.approveNode.mockRejectedValue(
      http(400, { error: "rejection_reason_for_soul is required", detail: "驳回转生申请必须填写给灵魂的驳回理由" })
    );
    renderPage();
    await pick("failed");
    fireEvent.change(reasonField() as HTMLElement, { target: { value: "x" } });
    submit();
    expect(await screen.findByText(tZh("workflow.detail.reason_for_soul_required"))).toBeInTheDocument();
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.anything(), "error");
  });

  it("a passing verdict sends no rejection_reason_for_soul key", async () => {
    renderPage();
    await pick("passed");
    submit();
    await waitFor(() => expect(workflowApi.approveNode).toHaveBeenCalled());
    expect(workflowApi.approveNode.mock.calls[0][2]).not.toHaveProperty("rejection_reason_for_soul");
  });
});

describe("any other workflow", () => {
  it("never shows the field, even when its name reads like a rebirth application, and never sends the key", async () => {
    workflowApi.get.mockResolvedValue(workflow("ROUTINE", "转生申请: 伪装的标题"));
    workflowApi.approveNode.mockResolvedValue(workflow("ROUTINE", "x"));
    renderPage();
    await pick("rejected");
    expect(reasonField()).toBeNull();
    expect(screen.queryByText(tZh("workflow.detail.reason_for_soul_hint"))).toBeNull();
    submit();
    await waitFor(() => expect(workflowApi.approveNode).toHaveBeenCalled());
    expect(workflowApi.approveNode.mock.calls[0][2]).toEqual({ verdict: "REJECTED", notes: "" });
  });
});
