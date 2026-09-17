/**
 * app/rebirth-applications/page.tsx — list, filter, the detail dialog, and who
 * is offered the cross-civilization decision.
 *
 * The detail reads `current_step` / `can_appeal` / `cooldown_until` off the
 * application itself. `workflowApi.get` is mocked only so a regression that
 * goes back to fetching the workflow shows up as a call, not as a crash.
 *
 * Permissions run for real (stubbed `useTenant` only).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RebirthApplicationsPage from "@/app/rebirth-applications/page";
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

const INITIAL_STEP = { node_type: "EVALUATION", approver_role: "JUDGE", is_appeal: false };

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
    current_step: INITIAL_STEP as typeof INITIAL_STEP | null,
    can_appeal: false,
    cooldown_until: null as string | null,
    can_decide_cross_civilization: false,
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    ...over,
  };
}

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
});

afterEach(() => {
  // No detail view asks for the workflow any more: current_step is on the application.
  expect(workflowApi.get).not.toHaveBeenCalled();
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

it("the detail shows the current step by node type and role, never by approver", async () => {
  as("GUARDIAN", "workflow.read");
  renderPage();
  const dialog = await openDetail();
  expect(within(dialog).getByText(tZh("workflow.node_type.evaluation"))).toBeInTheDocument();
  expect(within(dialog).getByText(tZh("users.roles.JUDGE"))).toBeInTheDocument();
  expect(within(dialog).getByText("愿再为人")).toBeInTheDocument();
  expect(within(dialog).getByText(tZh("soul_accounts.rebirth.cross.undecided"))).toBeInTheDocument();
  expect(within(dialog).queryByTestId("rebirth-cooldown")).toBeNull();
});

it("a closed application says there is no current step", async () => {
  as("GUARDIAN", "workflow.read");
  soulAccountsApi.rebirthApplications.mockResolvedValue(page([application({ status: "APPROVED", current_step: null })]));
  renderPage();
  const dialog = await openDetail();
  expect(within(dialog).getByTitle(new RegExp(tZh("soul_accounts.rebirth.no_current_node")))).toBeInTheDocument();
});

it("a final rejection in cooldown shows the date, the reason for the soul, and whether it can still appeal", async () => {
  as("GUARDIAN", "workflow.read");
  soulAccountsApi.rebirthApplications.mockResolvedValue(
    page([
      application({
        status: "REJECTED",
        current_step: null,
        can_appeal: true,
        rejection_reason: "功过未清",
        decided_at: "2026-09-10T00:00:00Z",
        cooldown_until: "2026-10-10T00:00:00Z",
      }),
    ])
  );
  renderPage();
  const dialog = await openDetail();
  expect(within(dialog).getByTestId("rebirth-cooldown")).toHaveTextContent(
    tZh("soul_accounts.rebirth.cooldown_until", { time: "dt(2026-10-10T00:00:00Z)" })
  );
  expect(within(dialog).getByText("功过未清")).toBeInTheDocument();
  expect(within(dialog).getByText(tZh("soul_accounts.rebirth.appeal.available"))).toBeInTheDocument();
});

it("REJECTED but can_appeal false (e.g. the life ended) does not claim an appeal is available", async () => {
  as("GUARDIAN", "workflow.read");
  soulAccountsApi.rebirthApplications.mockResolvedValue(page([application({ status: "REJECTED", current_step: null, can_appeal: false })]));
  renderPage();
  const dialog = await openDetail();
  expect(within(dialog).getByText(tZh("soul_accounts.rebirth.appeal.none"))).toBeInTheDocument();
  expect(within(dialog).queryByText(tZh("soul_accounts.rebirth.appeal.available"))).toBeNull();
});

it("an appealed application says the one appeal is used and labels the step as appeal", async () => {
  as("GUARDIAN", "workflow.read");
  soulAccountsApi.rebirthApplications.mockResolvedValue(
    page([
      application({
        status: "APPEALING",
        appeal_workflow: "w2",
        appeal_statement: "请复核",
        current_step: { node_type: "APPEAL", approver_role: "JUDGE", is_appeal: true },
      }),
    ])
  );
  as("JUDGE", "workflow.read", "workflow.approve");
  renderPage();
  const dialog = await openDetail();
  expect(within(dialog).getByText(tZh("soul_accounts.rebirth.appeal.used"))).toBeInTheDocument();
  expect(within(dialog).getByText("请复核")).toBeInTheDocument();
  expect(within(dialog).getByText(tZh("soul_accounts.rebirth.step_appeal"))).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: tZh("soul_accounts.rebirth.open_workflow") })).toHaveAttribute("href", "/workflow/w2");
  // The initial-review decision is not offered on an appeal, even to a JUDGE.
  expect(within(dialog).queryByTestId("cross-civilization-decision")).toBeNull();
});

describe("cross-civilization", () => {
  /* The dialog offers the decision exactly when the backend says
   * `can_decide_cross_civilization` — the field is computed by the same function the
   * endpoint runs. Nothing here may re-derive it from the step or the role. */
  it("offered when the backend says so, and it posts", async () => {
    as("JUDGE", "workflow.read", "workflow.approve");
    soulAccountsApi.rebirthApplications.mockResolvedValue(page([application({ can_decide_cross_civilization: true })]));
    soulAccountsApi.decideCrossCivilization.mockResolvedValue({
      data: application({ cross_civilization: true, can_decide_cross_civilization: true }),
    });
    renderPage();
    const dialog = await openDetail();
    const decision = within(dialog).getByTestId("cross-civilization-decision");
    fireEvent.click(within(decision).getByRole("button", { name: tZh("soul_accounts.rebirth.cross.yes") }));
    await waitFor(() => expect(soulAccountsApi.decideCrossCivilization).toHaveBeenCalledWith("r1", true));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.rebirth.cross_saved"), "success"));
  });

  it("not offered when the backend says no, even to the initial-review role holding workflow.approve", async () => {
    as("JUDGE", "workflow.read", "workflow.approve");
    renderPage();
    const dialog = await openDetail();
    expect(within(dialog).queryByTestId("cross-civilization-decision")).toBeNull();
  });

  it("does not read the step's node type: offered on a non-EVALUATION step when the backend allows it", async () => {
    as("VIEWER", "workflow.read");
    soulAccountsApi.rebirthApplications.mockResolvedValue(
      page([application({ can_decide_cross_civilization: true, current_step: { node_type: "TRIAL", approver_role: "ADMIN", is_appeal: false } })])
    );
    renderPage();
    const dialog = await openDetail();
    expect(within(dialog).getByTestId("cross-civilization-decision")).toBeInTheDocument();
  });

  it("a 403 from the backend is reported, not swallowed", async () => {
    as("JUDGE", "workflow.read", "workflow.approve");
    soulAccountsApi.rebirthApplications.mockResolvedValue(page([application({ can_decide_cross_civilization: true })]));
    soulAccountsApi.decideCrossCivilization.mockRejectedValue(http(403, { detail: "x", code: "not_the_approver" }));
    renderPage();
    const dialog = await openDetail();
    const decision = within(dialog).getByTestId("cross-civilization-decision");
    fireEvent.click(within(decision).getByRole("button", { name: tZh("soul_accounts.rebirth.cross.no") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.rebirth.cross_not_approver"), "error"));
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
