/**
 * app/workflow/[id]/page.tsx — coded refusals get a sentence of their own (2026-10-29).
 *
 * 越级推进最多到终审(审查 A,400 `escalate_past_final`);五逆判了通过的案子不能批(审查 J,400
 * `five_heinous_must_fail`)。Other refusals keep the server's `error` text.
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
  workflowApi: Record<"get" | "escalate" | "approveNode", jest.Mock>;
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

const node = {
  id: "n1", workflow: "w1", node_name: "终审", node_type: "FINAL", court_code: "", node_order: 1,
  approver_type: "ROLE", approver_role: "JUDGE", status: "PENDING", decided_at: null, notes: "",
};
const WORKFLOW = {
  data: {
    id: "w1", workflow_name: "一站", case_type: "ROUTINE", soul: "s1", soul_name: "张三", priority: 0,
    status: "IN_PROGRESS", is_appeal: false, cross_civilization: false, created_at: "2026-10-29T00:00:00Z",
    completed_at: null, judgment: null, current_node: "n1", current_node_detail: node, nodes: [node], can_approve: true,
    updated_at: "2026-10-29T00:00:00Z",
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<WorkflowDetailPage />, { wrapper: Wrapper });
}

const refused = (code: string, error: string) => Promise.reject({ response: { status: 400, data: { code, error } } });

async function escalate() {
  renderPage();
  fireEvent.click((await screen.findAllByRole("button", { name: tZh("workflow.detail.escalate") }))[0]);
  fireEvent.change(document.getElementById("escalate-reason") as HTMLElement, { target: { value: "告假" } });
  fireEvent.click(screen.getAllByRole("button", { name: tZh("workflow.detail.escalate") })[1]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 2, username: "mod", role: "MODERATOR", permissions: ["workflow.read", "workflow.escalate", "workflow.approve"] };
  workflowApi.get.mockResolvedValue(WORKFLOW);
});

it("escalate_past_final reads as its own sentence, not the server's English", async () => {
  workflowApi.escalate.mockImplementation(() => refused("escalate_past_final", "The final review cannot be escalated past"));
  await escalate();
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("workflow.detail.refusals.escalate_past_final"), "error"));
  expect(mockShowToast).not.toHaveBeenCalledWith("The final review cannot be escalated past", "error");
});

it("an uncoded refusal still shows the server's error", async () => {
  workflowApi.escalate.mockImplementation(() => refused("something_else", "no"));
  await escalate();
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("no", "error"));
});

it("five_heinous_must_fail on approval reads as its own sentence", async () => {
  workflowApi.approveNode.mockImplementation(() => refused("five_heinous_must_fail", "This node does not accept that verdict."));
  renderPage();
  fireEvent.click(await screen.findByLabelText(tZh("workflow.verdicts.passed")));
  fireEvent.click(screen.getByRole("button", { name: tZh("workflow.detail.submit_decision") }));
  await waitFor(() =>
    expect(mockShowToast).toHaveBeenCalledWith(tZh("workflow.detail.refusals.five_heinous_must_fail"), "error"),
  );
});
