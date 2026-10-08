/**
 * app/rebirth-applications/page.tsx — the 「缩短冷却申请」 tab: list, server-side
 * status filter, the detail dialog, and who is offered approve / reject.
 *
 * The decision is gated on `workflow.approve` (the backend's codename for
 * `approve/` and `reject/`); the days rule (0 ≤ days < remaining_days) is
 * applied before the round trip and the backend's `code` is read on failure.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RebirthApplicationsPage from "@/app/rebirth-applications/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  soulAccountsApi: {
    rebirthApplications: jest.fn(),
    decideCrossCivilization: jest.fn(),
    cooldownShortenings: jest.fn(),
    approveCooldownShortening: jest.fn(),
    rejectCooldownShortening: jest.fn(),
  },
  workflowApi: { get: jest.fn() },
}));
const { soulAccountsApi } = jest.requireMock("@soulledger/core/api") as {
  soulAccountsApi: Record<"rebirthApplications" | "cooldownShortenings" | "approveCooldownShortening" | "rejectCooldownShortening", jest.Mock>;
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

function shortening(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    soul: "s1",
    soul_code: "ABCDEFGH23",
    soul_name: "李四",
    account: "a1",
    application: "r1",
    cycle: 0,
    reason: "家中有事",
    status: "PENDING",
    approved_days: null,
    decision_note: "",
    decided_by: null,
    decided_by_username: null,
    decided_at: null,
    cooldown_until: "2026-11-07T00:00:00Z",
    remaining_days: 30,
    created_at: "2026-10-08T00:00:00Z",
    updated_at: "2026-10-08T00:00:00Z",
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
  soulAccountsApi.rebirthApplications.mockResolvedValue(page([]));
  soulAccountsApi.cooldownShortenings.mockResolvedValue(page([shortening()]));
});

async function openTab() {
  fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.cooldown.tabs.shortenings") }));
  expect(await screen.findByText("李四")).toBeInTheDocument();
}

async function openDetail() {
  fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.rebirth.view") }));
  return screen.findByRole("dialog");
}

it("the tab lists requests, shows the days left, and filters by status on the server", async () => {
  as("GUARDIAN", "workflow.read");
  renderPage();
  // The first tab is the applications table; the second is asked for only once opened.
  expect(screen.getByRole("button", { name: tZh("soul_accounts.cooldown.tabs.applications") })).toHaveAttribute("aria-pressed", "true");
  await openTab();
  expect(screen.getByRole("button", { name: tZh("soul_accounts.cooldown.tabs.shortenings") })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shortening-remaining")).toHaveTextContent("30 天");
  // The badge in the row, not the filter chip of the same name.
  expect(within(screen.getByText("李四").closest("li") as HTMLElement).getByText(tZh("soul_accounts.cooldown_status.PENDING"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: tZh("soul_accounts.cooldown_status.REJECTED") }));
  await waitFor(() => expect(soulAccountsApi.cooldownShortenings).toHaveBeenLastCalledWith({ status: "REJECTED", page: 1 }));
});

it("without workflow.approve the detail shows the reason but offers no decision", async () => {
  as("GUARDIAN", "workflow.read");
  renderPage();
  await openTab();
  const dialog = await openDetail();
  expect(within(dialog).getByText("家中有事")).toBeInTheDocument();
  expect(within(dialog).queryByTestId("cooldown-decision")).not.toBeInTheDocument();
});

it("approves with a day count below the days left, and refuses one at or above it before calling the API", async () => {
  as("JUDGE", "workflow.read", "workflow.approve");
  soulAccountsApi.approveCooldownShortening.mockResolvedValue({ data: shortening({ status: "APPROVED", approved_days: 3 }) });
  renderPage();
  await openTab();
  const dialog = await openDetail();
  fireEvent.change(within(dialog).getByTestId("shortening-days"), { target: { value: "30" } });
  fireEvent.click(within(dialog).getByTestId("shortening-approve"));
  expect(within(dialog).getByText(tZh("soul_accounts.cooldown.invalid_days"))).toBeInTheDocument();
  expect(soulAccountsApi.approveCooldownShortening).not.toHaveBeenCalled();

  fireEvent.change(within(dialog).getByTestId("shortening-days"), { target: { value: "3" } });
  fireEvent.change(within(dialog).getByTestId("shortening-note"), { target: { value: "情有可原" } });
  fireEvent.click(within(dialog).getByTestId("shortening-approve"));
  await waitFor(() => expect(soulAccountsApi.approveCooldownShortening).toHaveBeenCalledWith("c1", 3, "情有可原"));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.cooldown.decided"), "success"));
});

it("a rejection needs a note, and the backend's code picks the toast", async () => {
  as("JUDGE", "workflow.read", "workflow.approve");
  soulAccountsApi.rejectCooldownShortening.mockRejectedValue(http(409, { detail: "x", code: "already_decided" }));
  renderPage();
  await openTab();
  const dialog = await openDetail();
  fireEvent.click(within(dialog).getByTestId("shortening-reject"));
  expect(within(dialog).getByText(tZh("soul_accounts.cooldown.note_required"))).toBeInTheDocument();
  expect(soulAccountsApi.rejectCooldownShortening).not.toHaveBeenCalled();

  fireEvent.change(within(dialog).getByTestId("shortening-note"), { target: { value: "理由不足" } });
  fireEvent.click(within(dialog).getByTestId("shortening-reject"));
  await waitFor(() => expect(soulAccountsApi.rejectCooldownShortening).toHaveBeenCalledWith("c1", "理由不足"));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.cooldown.already_decided"), "error"));
});

it("a decided or expired request offers no decision even to an approver", async () => {
  as("JUDGE", "workflow.read", "workflow.approve");
  soulAccountsApi.cooldownShortenings.mockResolvedValue(
    page([shortening({ status: "REJECTED", decision_note: "理由不足", decided_by_username: "judge", decided_at: "2026-10-09T00:00:00Z" })])
  );
  renderPage();
  await openTab();
  const dialog = await openDetail();
  expect(within(dialog).getByText("理由不足")).toBeInTheDocument();
  expect(within(dialog).getByText(/judge/)).toBeInTheDocument();
  expect(within(dialog).queryByTestId("cooldown-decision")).not.toBeInTheDocument();
});
