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
const ADMIN = { id: 1, username: "admin", role: "ADMIN", permissions: [] as string[] };
let mockUser = ADMIN;
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
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
      can_approve: true,
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

/**
 * v3 A1: civilization colour does not enter the page — except the 3 px
 * 「待我处理」 bar on the current node's row, and only for an operator who can
 * decide it (`workflow.approve`, the gate on 提交判决).
 */
describe("待我处理 bar", () => {
  const bars = () => document.querySelectorAll("li [class*='--color-main']");
  afterEach(() => {
    mockUser = ADMIN;
  });

  it("marks the current node's row, and no other row, for an operator who can approve", async () => {
    workflowApi.get.mockResolvedValue(payload("IN_PROGRESS", "n2"));
    renderPage();
    await preview();
    expect(bars()).toHaveLength(1);
    expect(bars()[0].closest("li")).toHaveAttribute("aria-current", "step");
    expect(bars()[0].closest("li")).toHaveTextContent("复核");
  });

  it("is absent for an operator without workflow.approve", async () => {
    mockUser = { id: 2, username: "clerk", role: "CLERK", permissions: ["workflow.view"] };
    workflowApi.get.mockResolvedValue(payload("IN_PROGRESS", "n2"));
    renderPage();
    await preview();
    expect(bars()).toHaveLength(0);
  });

  // rbac-web M-6:持码而不是本站指定的审批人(服务端 can_approve=false)—— 不标「待我」,也不画「提交判决」。
  it("is absent, with no submit button, for a holder of workflow.approve this node does not designate", async () => {
    const base = payload("IN_PROGRESS", "n2");
    workflowApi.get.mockResolvedValue({ data: { ...base.data, can_approve: false } });
    renderPage();
    await preview();
    expect(bars()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: tZh("workflow.detail.submit_decision") })).toBeNull();
  });

  it("the designated approver sees the submit button", async () => {
    workflowApi.get.mockResolvedValue(payload("IN_PROGRESS", "n2"));
    renderPage();
    await preview();
    expect(screen.getByRole("button", { name: tZh("workflow.detail.submit_decision") })).toBeInTheDocument();
  });

  it("is absent once the workflow is completed", async () => {
    workflowApi.get.mockResolvedValue(payload("COMPLETED", "n3"));
    renderPage();
    await preview();
    expect(bars()).toHaveLength(0);
  });
});

describe("flat node list (a workflow with no segments) · 这次没走到", () => {
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>("ol > li"));
  const notReached = () => rows().filter((r) => r.dataset.nodeState === "not-reached");

  it("marks a station still PENDING when the workflow ended, and one the engine routed past", async () => {
    const base = payload("REJECTED", null);
    const nodes = [node("n1", 1, "初审", "REJECTED"), node("n2", 2, "复核", "SKIPPED"), node("n3", 3, "终审")];
    workflowApi.get.mockResolvedValue({ data: { ...base.data, nodes } });
    renderPage();
    await preview();
    expect(notReached().map((r) => r.textContent)).toEqual([
      expect.stringContaining("复核"),
      expect.stringContaining("终审"),
    ]);
    for (const row of notReached()) {
      expect(row).toHaveTextContent(tZh("workflow.node_state.not_reached"));
      expect(row).toHaveTextContent("–");
      expect(row).not.toHaveTextContent(tZh("workflow.status.SKIPPED"));
    }
    expect(rows()[0]).not.toHaveAttribute("data-node-state");
  });

  it("marks nothing while the workflow runs, and not a station someone skipped", async () => {
    const base = payload("IN_PROGRESS", "n3");
    const skipped = { ...node("n2", 2, "复核", "SKIPPED"), skip_kind: "LATER" };
    const nodes = [node("n1", 1, "初审", "APPROVED"), skipped, node("n3", 3, "终审")];
    workflowApi.get.mockResolvedValue({ data: { ...base.data, nodes } });
    renderPage();
    await preview();
    expect(notReached()).toHaveLength(0);
  });
});

describe("workflow info card · 案号", () => {
  it("prints the judgment's case number whole and copyable; a workflow with no judgment is 不适用, not 未记录", async () => {
    const base = payload("IN_PROGRESS", "n2");
    workflowApi.get.mockResolvedValue({ data: { ...base.data, judgment: "j1", judgment_case_number: "EG-2026-0013" } });
    const { unmount } = renderPage();
    const chip = await screen.findByRole("button", { name: tZh("common.value.copy_case_number", { value: "EG-2026-0013" }) });
    expect(chip).toHaveTextContent(/^EG-2026-0013 ⧉$/);
    unmount();

    workflowApi.get.mockResolvedValue(payload("IN_PROGRESS", "n2"));
    renderPage();
    await preview();
    const label = screen.getByText(tZh("judgment.case_number"));
    const value = label.nextElementSibling as HTMLElement;
    expect(value.querySelector('[data-missing="inapplicable"]')).not.toBeNull();
    expect(value.querySelector("button")).toBeNull();
  });
});

/** 灵魂上诉到申诉流程(2026-10-27):流程页链回那一轮申诉,结论在申诉页上作。 */
describe("escalated appeal", () => {
  it("links the APPEAL workflow to the soul's appeal round, and a plain workflow links nothing", async () => {
    const base = payload("IN_PROGRESS", "n2");
    const judgment_appeal = { id: "ap1", case_number: "CN-2026-0007", round: 2, status: "IN_REVIEW" };
    workflowApi.get.mockResolvedValue({ data: { ...base.data, is_appeal: true, judgment_appeal } });
    const { unmount } = renderPage();
    const row = await screen.findByTestId("workflow-judgment-appeal");
    // The case number goes through <CaseNumber> (whole, copyable — CASE_NUMBER_POLICY) and links to the round.
    expect(row.querySelector("a")).toHaveAttribute("href", "/judgment/appeals/ap1");
    expect(row).toHaveTextContent("CN-2026-0007");
    expect(row).toHaveTextContent(tZh("appeals.round", { round: "2" }));
    unmount();

    workflowApi.get.mockResolvedValue(payload("IN_PROGRESS", "n2"));
    renderPage();
    await preview();
    expect(screen.queryByTestId("workflow-judgment-appeal")).toBeNull();
  });
});

/** 第五十六批 W-1:上诉详情「查看审批流程 →」带 `#node-<id>` 进来,那一行滚到眼前,左 3px ink 竖条 + surface-2 浅底。 */
describe("arriving at one node by its anchor", () => {
  const scroll = jest.fn();
  beforeEach(() => {
    scroll.mockClear();
    Element.prototype.scrollIntoView = scroll;
  });
  afterEach(() => {
    window.location.hash = "";
  });

  it("highlights and scrolls to the anchored row, and only that one — not the current node", async () => {
    window.location.hash = "#node-n1";
    workflowApi.get.mockResolvedValue(payload("IN_PROGRESS", "n2"));
    renderPage();
    await preview();
    const row = document.getElementById("node-n1")!;
    expect(row).toHaveAttribute("data-anchored", "true");
    expect(row).toHaveClass("bg-[oklch(var(--color-surface-2))]", "shadow-[inset_3px_0_0_oklch(var(--color-ink))]");
    expect(scroll.mock.contexts).toContain(row);
    for (const other of ["node-n2", "node-n3"]) {
      expect(document.getElementById(other)).not.toHaveAttribute("data-anchored");
      expect(document.getElementById(other)).not.toHaveClass("shadow-[inset_3px_0_0_oklch(var(--color-ink))]");
    }
  });

  it("highlights nothing without an anchor", async () => {
    workflowApi.get.mockResolvedValue(payload("IN_PROGRESS", "n2"));
    renderPage();
    await preview();
    expect(document.querySelector("[data-anchored]")).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
  });
});
