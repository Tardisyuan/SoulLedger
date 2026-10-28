/**
 * app/workflow/[id]/page.tsx — 推进 asks for a reason (2026-10-29).
 *
 * The backend marks the stop moved past SKIPPED and writes an audit row, so `POST advance/` now requires
 * `reason` (400 `reason_required`). The button opens a reason field; an empty reason is stopped before the
 * request, and the reason is what is sent.
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
  workflowApi: Record<"get" | "advance", jest.Mock>;
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

function node(id: string, order: number) {
  return {
    id, workflow: "w1", node_name: `第${order}站`, node_type: "TRIAL", court_code: "", node_order: order,
    approver_type: "ROLE", approver_role: "JUDGE", status: "PENDING", decided_at: null, notes: "",
  };
}

function workflow(current: string) {
  const nodes = [node("n1", 1), node("n2", 2)];
  return {
    data: {
      id: "w1", workflow_name: "两站", case_type: "ROUTINE", soul: "s1", soul_name: "张三", priority: 0,
      status: "IN_PROGRESS", is_appeal: false, cross_civilization: false, created_at: "2026-10-29T00:00:00Z",
      completed_at: null, judgment: null, current_node: current,
      current_node_detail: nodes.find((n) => n.id === current), nodes, updated_at: "2026-10-29T00:00:00Z",
    },
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<WorkflowDetailPage />, { wrapper: Wrapper });
}

const reasonField = () => document.getElementById("advance-reason");
const advanceButtons = () => screen.getAllByRole("button", { name: tZh("workflow.detail.advance") });

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 2, username: "judge", role: "JUDGE", permissions: ["workflow.read", "workflow.approve", "workflow.advance"] };
  workflowApi.get.mockResolvedValue(workflow("n1"));
  workflowApi.advance.mockResolvedValue(workflow("n2"));
});

it("the advance button opens a reason field instead of advancing", async () => {
  renderPage();
  fireEvent.click((await screen.findAllByRole("button", { name: tZh("workflow.detail.advance") }))[0]);
  expect(reasonField()).not.toBeNull();
  expect(workflowApi.advance).not.toHaveBeenCalled();
});

it("an empty reason is stopped before the request", async () => {
  renderPage();
  fireEvent.click((await screen.findAllByRole("button", { name: tZh("workflow.detail.advance") }))[0]);
  fireEvent.click(advanceButtons()[1]);
  expect(mockShowToast).toHaveBeenCalledWith(tZh("workflow.detail.advance_needs_reason"), "error");
  expect(workflowApi.advance).not.toHaveBeenCalled();
});

it("the reason is sent with the advance", async () => {
  renderPage();
  fireEvent.click((await screen.findAllByRole("button", { name: tZh("workflow.detail.advance") }))[0]);
  fireEvent.change(reasonField() as HTMLElement, { target: { value: " 审批人休假 " } });
  fireEvent.click(advanceButtons()[1]);
  await waitFor(() => expect(workflowApi.advance).toHaveBeenCalledWith("w1", { reason: "审批人休假" }));
});
