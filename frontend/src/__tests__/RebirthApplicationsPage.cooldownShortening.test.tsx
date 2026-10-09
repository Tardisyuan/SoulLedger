/**
 * app/rebirth-applications/page.tsx — the 「缩短冷却申请」 tab: list, server-side
 * status filter, the detail dialog, and who is offered approve / reject.
 *
 * The decision is gated on `workflow.approve` (the backend's codename for
 * `approve/` and `reject/`); the days rule (0 ≤ days < remaining_days) is
 * applied before the round trip and the backend's `code` is read on failure.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    cooldownShortening: jest.fn(),
    cooldownShorteningCounts: jest.fn(),
    approveCooldownShortening: jest.fn(),
    rejectCooldownShortening: jest.fn(),
  },
  workflowApi: { get: jest.fn() },
}));
const { soulAccountsApi } = jest.requireMock("@soulledger/core/api") as {
  soulAccountsApi: Record<"rebirthApplications" | "cooldownShortenings" | "cooldownShortening" | "cooldownShorteningCounts" | "approveCooldownShortening" | "rejectCooldownShortening", jest.Mock>;
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
    desired_remaining_days: null,
    status: "PENDING",
    approved_days: null,
    decision_note: "",
    decided_by: null,
    decided_by_username: null,
    decided_at: null,
    cooldown_until: "2026-11-07T00:00:00Z",
    remaining_days: 30,
    cooldown_end: "2026-11-07T00:00:00Z",
    cooldown_original_until: "2026-11-07T00:00:00Z",
    cooldown_total_days: 30,
    cooldown_past_days: 0,
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
  jest.resetAllMocks();
  soulAccountsApi.rebirthApplications.mockResolvedValue(page([]));
  soulAccountsApi.cooldownShortenings.mockResolvedValue(page([shortening()]));
  soulAccountsApi.cooldownShorteningCounts.mockResolvedValue({ data: { PENDING: 3, APPROVED: 2, REJECTED: 1 } });
});

const shorteningsTab = () => screen.findByRole("button", { name: new RegExp(`^${tZh("soul_accounts.cooldown.tabs.shortenings")}`) });

async function openTab() {
  fireEvent.click(await shorteningsTab());
  expect((await screen.findAllByTestId("shortening-remaining")).length).toBeGreaterThan(0);
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
  expect(await shorteningsTab()).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shortening-remaining")).toHaveTextContent("30 天");
  // The default filter is 待决定; the badge in the row, not the chip of the same name.
  expect(soulAccountsApi.cooldownShortenings).toHaveBeenLastCalledWith({ status: "PENDING", page: 1 });
  expect(within(screen.getByTestId("shortening-remaining").closest("li") as HTMLElement).getAllByText(tZh("soul_accounts.cooldown_status.PENDING")).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${tZh("soul_accounts.cooldown_status.REJECTED")}`) }));
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

it("pre-fills the days with the soul's wish and shows it; the officer may still edit it, and 0 is a wish", async () => {
  as("JUDGE", "workflow.read", "workflow.approve");
  soulAccountsApi.cooldownShortenings.mockResolvedValue(page([shortening({ desired_remaining_days: 7 })]));
  soulAccountsApi.approveCooldownShortening.mockResolvedValue({ data: shortening({ status: "APPROVED", approved_days: 5 }) });
  renderPage();
  await openTab();
  const dialog = await openDetail();
  expect(within(dialog).getByTestId("shortening-days")).toHaveValue(7);
  expect(within(dialog).getByTestId("shortening-desired")).toHaveTextContent(tZh("soul_accounts.cooldown.desired", { n: "7" }));
  fireEvent.change(within(dialog).getByTestId("shortening-days"), { target: { value: "5" } });
  fireEvent.click(within(dialog).getByTestId("shortening-approve"));
  await waitFor(() => expect(soulAccountsApi.approveCooldownShortening).toHaveBeenCalledWith("c1", 5, ""));
});

it("without a wish the days default to 0 and no wish line is shown; a wish of 0 is shown", async () => {
  as("JUDGE", "workflow.read", "workflow.approve");
  renderPage();
  await openTab();
  let dialog = await openDetail();
  expect(within(dialog).getByTestId("shortening-days")).toHaveValue(0);
  expect(within(dialog).queryByTestId("shortening-desired")).not.toBeInTheDocument();
  cleanup();
  soulAccountsApi.cooldownShortenings.mockResolvedValue(page([shortening({ desired_remaining_days: 0 })]));
  renderPage();
  await openTab();
  dialog = await openDetail();
  expect(within(dialog).getByTestId("shortening-desired")).toHaveTextContent(tZh("soul_accounts.cooldown.desired", { n: "0" }));
});

it("a rejection without a note is checked on press, not before: danger field, message, focus back, nothing sent", async () => {
  as("JUDGE", "workflow.read", "workflow.approve");
  renderPage();
  await openTab();
  const dialog = await openDetail();
  const reject = within(dialog).getByTestId("shortening-reject");
  // Never pre-disabled: the empty note does not grey the button out.
  expect(reject).toBeEnabled();
  const note = within(dialog).getByTestId("shortening-note");
  expect(note).not.toHaveAttribute("aria-invalid");
  fireEvent.click(reject);
  expect(within(dialog).getByText(tZh("soul_accounts.cooldown.note_required"))).toBeInTheDocument();
  expect(note).toHaveAttribute("aria-invalid", "true");
  expect(note).toHaveFocus();
  // The hint is replaced by the message, not stacked with it.
  expect(within(dialog).queryByText(tZh("soul_accounts.cooldown.note_hint"))).not.toBeInTheDocument();
  expect(soulAccountsApi.rejectCooldownShortening).not.toHaveBeenCalled();
  // Typing clears it.
  fireEvent.change(note, { target: { value: "理由不足" } });
  expect(note).not.toHaveAttribute("aria-invalid");
});

it("a server refusal toasts the reason, keeps the dialog open and re-reads the row", async () => {
  as("JUDGE", "workflow.read", "workflow.approve");
  let refused = false;
  soulAccountsApi.rejectCooldownShortening.mockImplementation(async () => {
    refused = true;
    throw http(409, { detail: "x", code: "already_decided" });
  });
  // Until the refusal the server still has it pending; after it, already decided (and gone from the PENDING list).
  soulAccountsApi.cooldownShortening.mockImplementation(async () => ({
    data: refused ? shortening({ status: "APPROVED", approved_days: 3, decided_at: "2026-10-09T00:00:00Z", decided_by_username: "other" }) : shortening(),
  }));
  renderPage();
  await openTab();
  const dialog = await openDetail();
  fireEvent.change(within(dialog).getByTestId("shortening-note"), { target: { value: "理由不足" } });
  fireEvent.click(within(dialog).getByTestId("shortening-reject"));
  await waitFor(() => expect(soulAccountsApi.rejectCooldownShortening).toHaveBeenCalledWith("c1", "理由不足"));
  const reason = tZh("soul_accounts.cooldown.already_decided");
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.cooldown.decide_failed", { reason }), "error"));
  // Still open, now showing the server's state: decided by someone else, no decision area.
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await waitFor(() => expect(within(screen.getByRole("dialog")).getByText(/other/)).toBeInTheDocument());
  expect(within(screen.getByRole("dialog")).queryByTestId("cooldown-decision")).not.toBeInTheDocument();
});

it("the approve button says how many days are left, as typed", async () => {
  as("JUDGE", "workflow.read", "workflow.approve");
  renderPage();
  await openTab();
  const dialog = await openDetail();
  expect(within(dialog).getByTestId("shortening-approve")).toHaveTextContent("批准 · 还需 0 天");
  fireEvent.change(within(dialog).getByTestId("shortening-days"), { target: { value: "5" } });
  expect(within(dialog).getByTestId("shortening-approve")).toHaveTextContent("批准 · 还需 5 天");
});

it("keeps the server order (days left, ended last), with counts on the chips and the tab and a sort note", async () => {
  as("GUARDIAN", "workflow.read");
  soulAccountsApi.cooldownShortenings.mockResolvedValue(
    page([
      shortening({ id: "near", soul_name: "近", remaining_days: 2, cooldown_past_days: 28 }),
      shortening({ id: "far", soul_name: "远", remaining_days: 20, cooldown_past_days: 10 }),
      shortening({ id: "done", soul_name: "毕", remaining_days: 0, cooldown_until: null }),
      shortening({ id: "ok", soul_name: "决", status: "APPROVED", remaining_days: 1 }),
    ])
  );
  renderPage();
  await openTab();
  const order = Array.from(document.querySelectorAll("li[data-shortening-id]")).map((li) => li.getAttribute("data-shortening-id"));
  expect(order).toEqual(["near", "far", "done", "ok"]);
  expect(screen.getByText(tZh("soul_accounts.cooldown.sort_note"))).toBeInTheDocument();
  // Counts: the tab shows the pending number, each chip its own, 全部 the sum.
  await waitFor(async () => expect(await shorteningsTab()).toHaveTextContent("3"));
  expect(screen.getByRole("button", { name: new RegExp(`^${tZh("soul_accounts.cooldown_status.APPROVED")}`) })).toHaveTextContent("2");
  expect(screen.getByRole("button", { name: new RegExp(`^${tZh("soul_accounts.rebirth.filters.all")}`) })).toHaveTextContent("6");
  // The progress cell: N 天, 已过 a / 共 b 天, and a line at past/total.
  const near = document.querySelector('li[data-shortening-id="near"] [data-testid="shortening-remaining"]') as HTMLElement;
  expect(near).toHaveTextContent("2 天");
  expect(near).toHaveTextContent("已过 28 / 共 30 天");
  expect((near.querySelector('[data-testid="shortening-progress"] > div') as HTMLElement).style.width).toMatch(/^93\.3/);
});

it("an ended row says so in its cell only, and its detail has no decision area, just 关闭", async () => {
  as("JUDGE", "workflow.read", "workflow.approve");
  soulAccountsApi.cooldownShortenings.mockResolvedValue(page([shortening({ remaining_days: 0, cooldown_until: null })]));
  renderPage();
  await openTab();
  expect(screen.getByTestId("shortening-remaining")).toHaveTextContent("○ 冷却已结束");
  expect(screen.queryByTestId("shortening-progress")).not.toBeInTheDocument();
  const dialog = await openDetail();
  expect(within(dialog).queryByTestId("cooldown-decision")).not.toBeInTheDocument();
  expect(within(dialog).queryByTestId("shortening-approve")).not.toBeInTheDocument();
  expect(within(dialog).queryByTestId("shortening-reject")).not.toBeInTheDocument();
  expect(within(dialog).getAllByRole("button", { name: tZh("common.close") }).length).toBeGreaterThan(0);
});

it("an approved request shows the new end date with the original beside it", async () => {
  as("GUARDIAN", "workflow.read");
  soulAccountsApi.cooldownShortenings.mockResolvedValue(
    page([
      shortening({
        status: "APPROVED",
        approved_days: 3,
        decided_at: "2026-10-10T12:00:00Z",
        decided_by_username: "judge",
        cooldown_end: "2026-10-13T12:00:00Z",
        cooldown_original_until: "2026-10-26T12:00:00Z",
      }),
    ])
  );
  renderPage();
  await openTab();
  const dialog = await openDetail();
  expect(within(dialog).getByText("2026-10-13 (原 10-26)")).toBeInTheDocument();
});

it("after an approval the remaining figure is labelled as the days left with it applied; before, the plain label", async () => {
  as("GUARDIAN", "workflow.read");
  soulAccountsApi.cooldownShortenings.mockResolvedValue(
    page([shortening({ status: "APPROVED", approved_days: 3, remaining_days: 3, decided_at: "2026-10-10T12:00:00Z" })])
  );
  renderPage();
  await openTab();
  const dialog = await openDetail();
  expect(within(dialog).getByText(tZh("soul_accounts.cooldown.fields.remaining_after"))).toBeInTheDocument();
  expect(within(dialog).queryByText(tZh("soul_accounts.cooldown.fields.remaining"))).toBeNull();
  cleanup();
  soulAccountsApi.cooldownShortenings.mockResolvedValue(page([shortening()]));
  renderPage();
  await openTab();
  const pending = await openDetail();
  expect(within(pending).getByText(tZh("soul_accounts.cooldown.fields.remaining"))).toBeInTheDocument();
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
