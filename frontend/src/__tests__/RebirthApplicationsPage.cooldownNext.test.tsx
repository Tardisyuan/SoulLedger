/**
 * The 「缩短冷却申请」 dialog after a decision: 「下一件」 in the to-do's own order (officer App D1), opened in the
 * dialog's place; and 「最近用过」 above the note box, remembered only for a reject the server took (D8).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import RebirthApplicationsPage from "@/app/rebirth-applications/page";
import { readReasons, rememberReason } from "@/src/lib/recentRejectReasons";
import { tZh } from "./support/zhBundle";
import { renderWithProviders } from "./support/render";
import { http, page } from "./support/mocks";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  soulAccountsApi: {
    rebirthApplications: jest.fn(),
    cooldownShortenings: jest.fn(),
    cooldownShortening: jest.fn(),
    cooldownShorteningCounts: jest.fn(),
    approveCooldownShortening: jest.fn(),
    rejectCooldownShortening: jest.fn(),
  },
  officerAppApi: { todo: jest.fn() },
  workflowApi: { get: jest.fn() },
}));
const { soulAccountsApi, officerAppApi } = jest.requireMock("@soulledger/core/api") as {
  soulAccountsApi: Record<"rebirthApplications" | "cooldownShortenings" | "cooldownShortening" | "cooldownShorteningCounts" | "approveCooldownShortening" | "rejectCooldownShortening", jest.Mock>;
  officerAppApi: Record<"todo", jest.Mock>;
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ actual: true, zh: "stable", formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true }));
jest.mock("@/src/contexts/ToastContext", () => require("./support/mocks").toastMock());

function shortening(over: Record<string, unknown> = {}) {
  return {
    id: "c1", soul: "s1", soul_code: "ABCDEFGH23", soul_name: "李四", account: "a1", application: "r1", cycle: 0, reason: "家中有事",
    desired_remaining_days: null, status: "PENDING", approved_days: null, decision_note: "", decided_by: null, decided_by_username: null,
    decided_at: null, cooldown_until: "2026-11-07T00:00:00Z", remaining_days: 30, cooldown_end: "2026-11-07T00:00:00Z",
    cooldown_original_until: "2026-11-07T00:00:00Z", cooldown_total_days: 30, cooldown_past_days: 0,
    can_reject: (over.status ?? "PENDING") === "PENDING",
    created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z", ...over,
  };
}
const row = (id: string, title: string) => ({ kind: "cooldown", id, title, created_at: "2026-10-08T00:00:00Z", target: { kind: "cooldown", id } });
const EMPTY = { count: 0, items: [] };
const todo = (cooldowns: unknown) => ({ data: { approvals: EMPTY, reassignments: EMPTY, cooldowns, rebirths: EMPTY, letters: EMPTY } });

let rows: Record<string, ReturnType<typeof shortening>>;

beforeEach(() => {
  jest.resetAllMocks();
  window.localStorage.clear();
  mockUser = { id: 3, username: "judge", role: "JUDGE", permissions: ["workflow.read", "workflow.approve"] };
  rows = { c1: shortening(), c2: shortening({ id: "c2", soul_name: "王五", soul_code: "WANGWU0001" }) };
  soulAccountsApi.rebirthApplications.mockResolvedValue(page([]));
  soulAccountsApi.cooldownShortenings.mockResolvedValue(page([rows.c1]));
  soulAccountsApi.cooldownShorteningCounts.mockResolvedValue({ data: { PENDING: 2, APPROVED: 0, REJECTED: 0 } });
  soulAccountsApi.cooldownShortening.mockImplementation(async (id: string) => ({ data: rows[id] }));
  officerAppApi.todo.mockResolvedValue(todo({ count: 2, items: [row("c1", "李四"), row("c2", "王五")] }));
});

async function openDetail() {
  renderWithProviders(<RebirthApplicationsPage />, { i18n: false });
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${tZh("soul_accounts.cooldown.tabs.shortenings")}`) }));
  fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.rebirth.view") }));
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(officerAppApi.todo).toHaveBeenCalled());
  return dialog;
}

it("after an approval: 下一件 opens the next request in the dialog's place", async () => {
  soulAccountsApi.approveCooldownShortening.mockImplementation(async () => {
    rows.c1 = shortening({ status: "APPROVED", approved_days: 0 });
    return { data: rows.c1 };
  });
  const dialog = await openDetail();
  expect(within(dialog).queryByTestId("next-bar")).toBeNull();
  fireEvent.click(within(dialog).getByTestId("shortening-approve"));
  const next = await within(dialog).findByTestId("next-bar-next");
  expect(next).toHaveTextContent(tZh("officer_app.detail.next_meta", { name: "王五", n: "1" }));
  expect(within(dialog).getByTestId("next-bar-leave")).toHaveTextContent(tZh("common.close"));
  fireEvent.click(next);
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(tZh("soul_accounts.cooldown.detail_title", { name: "王五" })));
  expect(soulAccountsApi.cooldownShortening).toHaveBeenCalledWith("c2");
  // The next one is undecided: its own decision bar, not the bar of the one before.
  expect(within(screen.getByRole("dialog")).getByTestId("cooldown-decision-bar")).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).queryByTestId("next-bar")).toBeNull();
});

it("remembers a reject the server took, and offers it as a row next time", async () => {
  rememberReason(3, "上次的理由");
  soulAccountsApi.rejectCooldownShortening.mockImplementation(async () => {
    rows.c1 = shortening({ status: "REJECTED" });
    return { data: rows.c1 };
  });
  const dialog = await openDetail();
  // 第五十九批 N9: the shared note box offers no reject reasons until 驳回 is pressed.
  expect(within(dialog).queryByTestId("recent-reason-0")).toBeNull();
  fireEvent.click(within(dialog).getByTestId("shortening-reject"));
  expect(soulAccountsApi.rejectCooldownShortening).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByTestId("recent-reason-0"));
  expect(within(dialog).getByTestId("shortening-note")).toHaveValue("上次的理由");
  fireEvent.change(within(dialog).getByTestId("shortening-note"), { target: { value: "不合规" } });
  fireEvent.click(within(dialog).getByTestId("shortening-reject"));
  await within(dialog).findByTestId("next-bar");
  expect(readReasons(3)).toEqual(["不合规", "上次的理由"]);
});

it("a reject the server refused is not remembered and shows no 下一件", async () => {
  soulAccountsApi.rejectCooldownShortening.mockRejectedValue(http(409, { code: "already_decided" }));
  const dialog = await openDetail();
  fireEvent.change(within(dialog).getByTestId("shortening-note"), { target: { value: "没发出去" } });
  fireEvent.click(within(dialog).getByTestId("shortening-reject"));
  await waitFor(() => expect(soulAccountsApi.rejectCooldownShortening).toHaveBeenCalled());
  await waitFor(() => expect(within(dialog).getByTestId("shortening-reject")).toBeEnabled());
  expect(readReasons(3)).toEqual([]);
  expect(within(dialog).queryByTestId("next-bar")).toBeNull();
});
