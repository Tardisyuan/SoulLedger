/**
 * app/workflow/[id]/page.tsx -- 加签: while an added signer owes a signature, the approver's passing
 * verdict is held (the server answers 409 `cosigners_pending`). The page greys 提交判决 for the
 * passing verdicts, says why with the ◇ line (the officer App's `wait_cosigner` key) and lists the
 * owed signer as ◐. A refusal and a signed co-signer are not held.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkflowDetailPage from "@/app/workflow/[id]/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  workflowApi: { get: jest.fn(), approveNode: jest.fn(), advance: jest.fn(), escalate: jest.fn() },
}));
const { workflowApi } = jest.requireMock("@soulledger/core/api") as { workflowApi: Record<"get" | "approveNode", jest.Mock> };

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
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const NODE = {
  id: "n1",
  workflow: "w1",
  node_name: "判官初审",
  node_type: "EVALUATION",
  court_code: "第一殿",
  node_order: 1,
  approver_type: "ROLE",
  approver_role: "JUDGE",
  status: "PENDING",
  decided_at: null,
  notes: "",
};

function workflow(node: Record<string, unknown>) {
  return {
    data: {
      id: "w1",
      workflow_name: "转生配额审批",
      case_type: "OTHER",
      soul: "s1",
      soul_name: "张三",
      priority: 0,
      status: "IN_PROGRESS",
      is_appeal: false,
      cross_civilization: false,
      created_at: "2026-10-09T00:00:00Z",
      completed_at: null,
      judgment: null,
      current_node: "n1",
      current_node_detail: { ...NODE, ...node },
      nodes: [{ ...NODE, ...node }],
      updated_at: "2026-10-09T00:00:00Z",
    },
  };
}

const OWED = { cosigners: [{ user_id: 2, name: "孟判官", signed: false }], waiting_on_cosigner: { id: 2, name: "孟判官" } };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<WorkflowDetailPage />, { wrapper: Wrapper });
}

const pick = async (verdictKey: string) => fireEvent.click(await screen.findByLabelText(tZh(`workflow.verdicts.${verdictKey}`)));
const submitButton = () => screen.getByRole("button", { name: tZh("workflow.detail.submit_decision") });

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 1, username: "judge", role: "JUDGE", permissions: ["workflow.read", "workflow.approve"] };
});

describe("an added signer owes a signature", () => {
  beforeEach(() => workflowApi.get.mockResolvedValue(workflow(OWED)));

  it("lists the signer as ◐ pending and says why approving is held", async () => {
    renderPage();
    const list = await screen.findByTestId("cosigners");
    expect(list).toHaveTextContent(`◐ 孟判官 · ${tZh("officer_app.detail.cosigner_pending")}`);
    expect(screen.getByTestId("wait-cosigner")).toHaveTextContent(`◇ ${tZh("officer_app.detail.wait_cosigner", { name: "孟判官" })}`);
  });

  it.each(["passed", "confirmed"])("greys the submit button for a %s verdict and sends nothing", async (v) => {
    renderPage();
    await pick(v);
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAttribute("aria-describedby", "wait-cosigner");
    fireEvent.click(submitButton());
    expect(workflowApi.approveNode).not.toHaveBeenCalled();
  });

  it("does not hold a refusal", async () => {
    renderPage();
    await pick("rejected");
    expect(submitButton()).toBeEnabled();
  });
});

describe("nothing owed", () => {
  it("a signed co-signer is a tick and the button is free", async () => {
    workflowApi.get.mockResolvedValue(workflow({ cosigners: [{ user_id: 2, name: "孟判官", signed: true }], waiting_on_cosigner: null }));
    renderPage();
    expect(await screen.findByTestId("cosigners")).toHaveTextContent("✓ 孟判官");
    expect(screen.queryByTestId("wait-cosigner")).toBeNull();
    await pick("passed");
    expect(submitButton()).toBeEnabled();
  });

  it("a node with no co-signers shows neither the list nor the line", async () => {
    workflowApi.get.mockResolvedValue(workflow({}));
    renderPage();
    await pick("passed");
    expect(screen.queryByTestId("cosigners")).toBeNull();
    expect(screen.queryByTestId("wait-cosigner")).toBeNull();
    expect(submitButton()).toBeEnabled();
  });
});
