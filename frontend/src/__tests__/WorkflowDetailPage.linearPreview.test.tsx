/**
 * app/workflow/[id]/page.tsx — the linear preview under 甲 (Design 第三类 C
 * 「模板预览 · 线性」).
 *
 * Pinned: the chips follow `node_order` (not the order the API happens to send),
 * a dashed end chip closes the row, and exactly the running instance's
 * `current_node` carries the current mark — none once the workflow is COMPLETED.
 * Rendered through the real page so the wiring from `current_node` is what is
 * measured, not a prop handed to the component by this file.
 */
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkflowDetailPage from "@/app/workflow/[id]/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  workflowApi: { get: jest.fn(), approveNode: jest.fn(), advance: jest.fn(), escalate: jest.fn() },
}));
const { workflowApi } = jest.requireMock("@soulledger/core/api") as {
  workflowApi: Record<"get", jest.Mock>;
};

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "w1" }),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "admin", role: "ADMIN", permissions: [] } }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, tf: (_k: string, f: string) => f, formatDateTime: (v: string) => v, formatDate: (v: string) => v, locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const node = (id: string, order: number, name: string, status = "PENDING") => ({
  id,
  workflow: "w1",
  node_name: name,
  node_type: "TRIAL",
  court_code: "第一殿",
  node_order: order,
  approver_type: "ROLE",
  approver_role: "JUDGE",
  status,
  decided_at: null,
  notes: "",
});

function payload(status: string, current: string | null) {
  // Sent out of order on purpose: the preview must sort by node_order.
  const nodes = [node("n3", 3, "终审"), node("n1", 1, "初审", "APPROVED"), node("n2", 2, "复核")];
  return {
    data: {
      id: "w1",
      workflow_name: "十殿审批",
      case_type: "STANDARD",
      soul: "s1",
      soul_name: "张三",
      priority: 0,
      status,
      is_appeal: false,
      cross_civilization: false,
      created_at: "2026-09-17T00:00:00Z",
      completed_at: null,
      judgment: null,
      current_node: current,
      current_node_detail: nodes.find((n) => n.id === current) ?? null,
      nodes,
      updated_at: "2026-09-17T00:00:00Z",
    },
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<WorkflowDetailPage />, { wrapper: Wrapper });
}

const preview = async () => screen.findByRole("list", { name: tZh("workflow.detail.nodes") });
const chips = (list: HTMLElement) => Array.from(list.querySelectorAll<HTMLElement>("[data-preview-chip]"));

describe("workflow linear preview", () => {
  it("lists the nodes by node_order and closes with a dashed end chip", async () => {
    workflowApi.get.mockResolvedValue(payload("IN_PROGRESS", "n2"));
    renderPage();
    const list = await preview();
    expect(chips(list).map((c) => c.textContent)).toEqual(["初审", "复核", "终审", tZh("workflow.status.COMPLETED")]);
    expect(chips(list).at(-1)!.className).toContain("border-dashed");
  });

  it("marks the running instance's current node, and only that one", async () => {
    workflowApi.get.mockResolvedValue(payload("IN_PROGRESS", "n2"));
    renderPage();
    const list = await preview();
    const current = within(list).getByText("复核");
    expect(current).toHaveAttribute("aria-current", "step");
    expect(current.className).toContain("font-semibold");
    expect(chips(list).filter((c) => c.hasAttribute("data-current")).map((c) => c.textContent)).toEqual(["复核"]);
  });

  it("marks nothing once the workflow is completed", async () => {
    workflowApi.get.mockResolvedValue(payload("COMPLETED", "n3"));
    renderPage();
    const list = await preview();
    expect(chips(list)).toHaveLength(4);
    expect(list.querySelector("[aria-current]")).toBeNull();
  });
});
