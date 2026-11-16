/**
 * RebirthApplicationDetail -- two facts the officer App's rebirth item shows (todoFacts.tsx) and the dialog did not,
 * both read from `/officer-app/items/rebirth/<id>/` (the application's own serializer carries neither):
 *   功过结余 (`facts.merit_balance`), printed as the App prints it (the integer, sign included);
 *   前面几步 (`facts.history`): 发起 → each decided node → the current one.
 */
import { screen, within } from "@testing-library/react";
import type { OfficerRebirthApplication } from "@soulledger/core/api";
import { RebirthApplicationDetail } from "@/src/components/soul-accounts/RebirthApplicationDetail";
import { tZh } from "./support/zhBundle";
import { renderWithProviders } from "./support/render";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  officerAppApi: { item: jest.fn() },
  soulAccountsApi: { decideCrossCivilization: jest.fn() },
}));
const { officerAppApi } = jest.requireMock("@soulledger/core/api") as { officerAppApi: Record<"item", jest.Mock> };

jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ actual: true, zh: "stable", formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true }));
jest.mock("@/src/contexts/ToastContext", () => require("./support/mocks").toastMock());

const APP = {
  id: "r1", soul: "s1", soul_code: "ABCDEFGH23", soul_name: "张三", account: "a1", cycle: 0, desired_form: "HUMAN",
  statement: "愿再为人", appeal_statement: "", status: "UNDER_REVIEW", workflow: "w1", appeal_workflow: null,
  cross_civilization: null, target_hall: null, cross_civilization_targets: [], rejection_reason: "", decided_at: null,
  current_step: { node_type: "EVALUATION", approver_role: "JUDGE", is_appeal: false }, can_appeal: false, cooldown_until: null,
  can_decide_cross_civilization: false, first_rejection_reason: "", first_decided_at: null,
  created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
} as unknown as OfficerRebirthApplication;

const HISTORY = [
  { kind: "start", name: "", actor: "崔判官", verdict: "", comment: "", at: "2026-09-17T00:00:00Z", mine: false },
  { kind: "decided", name: "初审", actor: "孟判官", verdict: "PASSED", comment: "功德可观", at: "2026-09-18T00:00:00Z", mine: false },
  { kind: "current", name: "复审", actor: null, verdict: "", comment: "", at: "2026-09-18T00:00:00Z", mine: true },
];

const item = (facts: Record<string, unknown>) => ({ data: { kind: "rebirth", id: "r1", facts } });
const renderDetail = () => renderWithProviders(<RebirthApplicationDetail application={APP} onClose={() => {}} />, { i18n: false });

beforeEach(() => jest.clearAllMocks());

describe("功过结余", () => {
  it.each([[-12, "-12"], [0, "0"], [35, "35"]])("prints %p as %s under the App's label", async (n, shown) => {
    officerAppApi.item.mockResolvedValue(item({ merit_balance: n }));
    renderDetail();
    const value = await screen.findByTestId("rebirth-merit");
    expect(value).toHaveTextContent(new RegExp(`^${shown}$`));
    expect(value.parentElement!.previousElementSibling).toHaveTextContent(tZh("ledger.journal.col_balance"));
    expect(officerAppApi.item).toHaveBeenCalledWith("rebirth", "r1");
  });

  it("draws no row when the item cannot be read", async () => {
    officerAppApi.item.mockRejectedValue(new Error("404"));
    renderDetail();
    await screen.findByText(tZh("soul_accounts.rebirth.open_workflow"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("rebirth-merit")).toBeNull();
    expect(screen.queryByTestId("rebirth-history")).toBeNull();
  });
});

describe("前面几步", () => {
  it("lists 发起, the decided step with its verdict and comment, then the current step", async () => {
    officerAppApi.item.mockResolvedValue(item({ merit_balance: 3, history: HISTORY }));
    renderDetail();
    const list = await screen.findByTestId("rebirth-history");
    expect(within(list).getByText(tZh("officer_app.detail.history"))).toBeInTheDocument();
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-step"))).toEqual(["start", "decided", "current"]);
    expect(rows[0]).toHaveTextContent(`✓${tZh("officer_app.detail.requester")} · 崔判官 · dt(2026-09-17T00:00:00Z)`);
    expect(rows[1]).toHaveTextContent(`初审 · 孟判官 · ${tZh("workflow.verdicts.passed")} · dt(2026-09-18T00:00:00Z)`);
    expect(rows[1]).toHaveTextContent("「功德可观」");
    expect(rows[1]).not.toHaveTextContent("PASSED");
    expect(rows[2]).toHaveTextContent(`◐复审 · ${tZh("officer_app.detail.history_yours")}`);
  });

  it("the current step that is not mine carries no 待办 mark", async () => {
    officerAppApi.item.mockResolvedValue(item({ history: [HISTORY[0], { ...HISTORY[2], mine: false }] }));
    renderDetail();
    const list = await screen.findByTestId("rebirth-history");
    expect(list).not.toHaveTextContent(tZh("officer_app.detail.history_yours"));
  });
});

// 第五十九批 N14: the item's `handled_by` / `handled_at`, as one line beside the status tag.
describe("who handled it", () => {
  const handled = (over: Record<string, unknown>) => ({ data: { ...item({}).data, handled_by: null, handled_at: null, ...over } });

  it("names who acted last, with the time, next to the status", async () => {
    officerAppApi.item.mockResolvedValue(handled({ handled_by: { id: 4, name: "孟判官" }, handled_at: "2026-09-18T00:00:00Z" }));
    renderDetail();
    const line = await screen.findByTestId("handled-by");
    expect(line.textContent).toBe(tZh("common.handled_by", { name: "孟判官", time: "dt(2026-09-18T00:00:00Z)" }));
    expect(line.parentElement).toContainElement(screen.getByText(tZh("soul_accounts.rebirth_status.UNDER_REVIEW")));
  });

  it("draws nothing while nobody has handled it", async () => {
    officerAppApi.item.mockResolvedValue(handled({}));
    renderDetail();
    await screen.findByText(tZh("soul_accounts.rebirth_status.UNDER_REVIEW"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("handled-by")).toBeNull();
  });
});
