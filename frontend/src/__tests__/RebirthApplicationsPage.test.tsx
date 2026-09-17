/**
 * app/rebirth-applications/page.tsx — list, filter, the detail
 * dialog, and who is offered the cross-civilization decision.
 *
 * Permissions run for real (stubbed `useTenant` only).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RebirthApplicationsPage from "@/app/rebirth-applications/page";
import { mayDecideCrossCivilization } from "@/src/components/soul-accounts/RebirthApplicationDetail";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  soulAccountsApi: { rebirthApplications: jest.fn(), decideCrossCivilization: jest.fn() },
  workflowApi: { get: jest.fn() },
}));
const { soulAccountsApi, workflowApi } = jest.requireMock("@soulledger/core/api") as {
  soulAccountsApi: Record<"rebirthApplications" | "decideCrossCivilization", jest.Mock>;
  workflowApi: Record<"get", jest.Mock>;
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

function application(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    soul: "s1",
    soul_code: "ABCDEFGH23",
    soul_name: "张三",
    account: "a1",
    cycle: 0,
    desired_form: "HUMAN",
    statement: "愿再为人",
    appeal_statement: "",
    status: "UNDER_REVIEW",
    workflow: "w1",
    appeal_workflow: null,
    cross_civilization: null,
    rejection_reason: "",
    decided_at: null,
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    ...over,
  };
}

const node = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});
const FINAL = node({ id: "n2", node_name: "终审", node_type: "FINAL", node_order: 2, approver_role: "ADMIN" });

const workflow = (current = "n1", nodes = [node(), FINAL]) => ({
  data: { id: "w1", nodes, current_node: current, current_node_detail: nodes.find((n) => n.id === current) ?? null },
});

const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<RebirthApplicationsPage />, { wrapper: Wrapper });
}

const as = (role: string, ...permissions: string[]) => (mockUser = { id: 2, username: "op", role, permissions });

beforeEach(() => {
  jest.clearAllMocks();
  soulAccountsApi.rebirthApplications.mockResolvedValue(page([application()]));
  workflowApi.get.mockResolvedValue(workflow());
});

async function openDetail() {
  fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.rebirth.view") }));
  return screen.findByRole("dialog");
}

it("refuses the page without workflow.read and asks the API nothing", () => {
  as("GUARDIAN", "soul.read");
  renderPage();
  expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
  expect(soulAccountsApi.rebirthApplications).not.toHaveBeenCalled();
});

it("lists applications and filters by status on the server", async () => {
  as("GUARDIAN", "workflow.read");
  renderPage();
  expect(await screen.findByText("张三")).toBeInTheDocument();
  expect(screen.getByText(tZh("reincarnation.forms.HUMAN"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: tZh("soul_accounts.rebirth_status.REJECTED") }));
  await waitFor(() => expect(soulAccountsApi.rebirthApplications).toHaveBeenLastCalledWith({ status: "REJECTED", page: 1 }));
});

it("the detail shows the current step by role, never by approver", async () => {
  as("GUARDIAN", "workflow.read");
  renderPage();
  const dialog = await openDetail();
  expect(await within(dialog).findByText("判官初审")).toBeInTheDocument();
  expect(within(dialog).getByText(tZh("users.roles.JUDGE"))).toBeInTheDocument();
  expect(within(dialog).getByText("愿再为人")).toBeInTheDocument();
  expect(within(dialog).getByText(tZh("soul_accounts.rebirth.cross.undecided"))).toBeInTheDocument();
  expect(workflowApi.get).toHaveBeenCalledWith("w1");
});

it("an appealed application reads its appeal workflow and says the one appeal is used", async () => {
  as("GUARDIAN", "workflow.read");
  soulAccountsApi.rebirthApplications.mockResolvedValue(
    page([application({ status: "APPEALING", appeal_workflow: "w2", appeal_statement: "请复核" })])
  );
  renderPage();
  const dialog = await openDetail();
  expect(within(dialog).getByText(tZh("soul_accounts.rebirth.appeal.used"))).toBeInTheDocument();
  expect(within(dialog).getByText("请复核")).toBeInTheDocument();
  await waitFor(() => expect(workflowApi.get).toHaveBeenCalledWith("w2"));
  // The initial-review decision is not offered on an appeal, even to a JUDGE.
  expect(within(dialog).queryByTestId("cross-civilization-decision")).toBeNull();
});

describe("cross-civilization", () => {
  it("offered to the approver role of the pending first node, and it posts", async () => {
    as("JUDGE", "workflow.read", "workflow.approve");
    soulAccountsApi.decideCrossCivilization.mockResolvedValue({ data: application({ cross_civilization: true }) });
    renderPage();
    const dialog = await openDetail();
    const decision = await within(dialog).findByTestId("cross-civilization-decision");
    fireEvent.click(within(decision).getByRole("button", { name: tZh("soul_accounts.rebirth.cross.yes") }));
    await waitFor(() => expect(soulAccountsApi.decideCrossCivilization).toHaveBeenCalledWith("r1", true));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.rebirth.cross_saved"), "success"));
  });

  it("not offered without workflow.approve", async () => {
    as("JUDGE", "workflow.read");
    renderPage();
    const dialog = await openDetail();
    await within(dialog).findByText("判官初审");
    expect(within(dialog).queryByTestId("cross-civilization-decision")).toBeNull();
  });

  it("a 403 from the backend is reported, not swallowed", async () => {
    as("JUDGE", "workflow.read", "workflow.approve");
    soulAccountsApi.decideCrossCivilization.mockRejectedValue(http(403, { detail: "x", code: "not_the_approver" }));
    renderPage();
    const dialog = await openDetail();
    const decision = await within(dialog).findByTestId("cross-civilization-decision");
    fireEvent.click(within(decision).getByRole("button", { name: tZh("soul_accounts.rebirth.cross.no") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.rebirth.cross_not_approver"), "error"));
  });

  it.each([
    ["another role", { role: "ADMIN" }],
    ["past the first node", { current: "n2" }],
    ["first node already decided", { nodes: [node({ status: "APPROVED" }), FINAL] }],
    ["ACTOR-designated node", { nodes: [node({ approver_type: "ACTOR" }), FINAL] }],
    ["not under review", { status: "REJECTED" }],
  ] as const)("mayDecideCrossCivilization: false for %s", (_label, over) => {
    const o = over as { role?: string; current?: string; nodes?: ReturnType<typeof node>[]; status?: string };
    const nodes = o.nodes ?? [node(), FINAL];
    expect(
      mayDecideCrossCivilization({ status: (o.status ?? "UNDER_REVIEW") as never }, nodes as never, o.current ?? "n1", o.role ?? "JUDGE", true)
    ).toBe(false);
  });

  it("mayDecideCrossCivilization: true for the matching role on the pending first node, listed out of order", () => {
    expect(mayDecideCrossCivilization({ status: "UNDER_REVIEW" }, [FINAL, node()] as never, "n1", "JUDGE", true)).toBe(true);
  });
});

describe("states", () => {
  it("error, empty and filtered-empty are different screens", async () => {
    as("GUARDIAN", "workflow.read");
    soulAccountsApi.rebirthApplications.mockRejectedValueOnce(http(500));
    const { unmount } = renderPage();
    expect(await screen.findByRole("button", { name: tZh("error.retry") })).toBeInTheDocument();
    expect(screen.queryByText(tZh("soul_accounts.rebirth.empty"))).toBeNull();
    unmount();

    soulAccountsApi.rebirthApplications.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText(tZh("soul_accounts.rebirth.empty"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: tZh("soul_accounts.rebirth_status.APPROVED") }));
    expect(await screen.findByText(tZh("soul_accounts.rebirth.empty_filtered"))).toBeInTheDocument();
    expect(screen.queryByText(tZh("soul_accounts.rebirth.empty"))).toBeNull();
  });

  it("unknown status and form render as unrecognized with the raw member in title", async () => {
    as("GUARDIAN", "workflow.read");
    soulAccountsApi.rebirthApplications.mockResolvedValue(page([application({ status: "LIMBO", desired_form: "DRAGON" })]));
    renderPage();
    expect(await screen.findByTitle("LIMBO")).toHaveTextContent(tZh("common.value.unrecognized"));
    expect(screen.getByTitle("DRAGON")).toHaveTextContent(tZh("common.value.unrecognized"));
    expect(screen.queryByText("LIMBO")).toBeNull();
    expect(screen.queryByText("DRAGON")).toBeNull();
  });
});
