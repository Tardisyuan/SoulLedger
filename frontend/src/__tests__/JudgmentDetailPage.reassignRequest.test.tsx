/**
 * 「请管理员改派」在审判页头(2026-11-16,官员端 App O-a 在网页上的那一半):持 judgment.assign 的人打开别人手上、
 * 有改派请求的未结案,页头写谁、何时请求、理由,页头主动作是「改派给…」,点开就是队列页同一个改派层,确认后改派这一件。
 * 不持 judgment.assign、请求人自己、已结案、没有请求 —— 都不写那一行、不放那个键。
 *
 * 真页面、真 QueryClient,只桩 HTTP 层(同 JudgmentDetailPage.claimAndReopen.test.tsx)。
 */
import { screen, fireEvent, waitFor, within } from "@testing-library/react";

const ID = "j-1";

jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    use: <T,>(value: Promise<T> | T): T => {
      if (value && typeof (value as { then?: unknown }).then === "function") {
        return { id: ID } as unknown as T;
      }
      return value as T;
    },
  };
});

jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => null,
  usePathname: () => `/judgment/${ID}`,
}));

import JudgmentDetailPage from "@/app/judgment/[id]/page";
import { judgmentApi, soulsApi } from "@soulledger/core/api";
import { renderWithProviders } from "./support/render";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { get: jest.fn(), conclude: jest.fn(), reassign: jest.fn(), assignableOfficers: jest.fn() },
  soulsApi: { get: jest.fn() },
}));

const mockI18n = {
  t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
  formatDate: (v: unknown) => String(v),
  formatDateTime: (v: unknown) => String(v),
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ actual: true, useI18n: () => mockI18n }));

const mockToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockToast }),
}));

const JUDGE = ["judgment.read", "judgment.execute"];
const LEAD = [...JUDGE, "judgment.assign"];
const mockTenant: { user: Record<string, unknown> } = { user: {} };
jest.mock("@/src/contexts/TenantContext", () => require("./support/mocks").tenantMock({ ctx: () => mockTenant }));

const mockGet = judgmentApi.get as jest.Mock;
const mockReassign = judgmentApi.reassign as jest.Mock;
const mockOfficers = judgmentApi.assignableOfficers as jest.Mock;

function asUser(id: number, permissions: string[]) {
  mockTenant.user = { id, username: "me", role: "JUDGE", tenant: { id: 1, code: "CN_DIYU" }, permissions };
}

const ASKED = {
  claimed_by: 2,
  claimed_by_name: "崔判官",
  reassign_requested_at: "2026-11-15T09:00:00Z",
  reassign_requested_by: 2,
  reassign_requested_by_name: "崔判官",
  reassign_reason: "本人回避",
};

function judgment(over: Record<string, unknown> = {}) {
  return {
    id: ID, case_number: "J-1", soul: "s-1", soul_name: "李四", civilization: "CHINESE", judge: "u-1", judge_name: "Yama",
    court: "第一殿", evidence_json: {}, confession: "", verdict: null, notes: "", citations: [], is_final: false,
    created_at: "2026-09-12T00:00:00Z", concluded_at: null, claimed_by: null, claimed_by_name: null,
    can_edit: true, flow_cancelled: false, ...over,
  };
}

function renderPage() {
  return renderWithProviders(<JudgmentDetailPage params={Promise.resolve({ id: ID })} />, { i18n: false });
}

const TIMEOUT = { timeout: 5000 };

beforeEach(() => {
  jest.clearAllMocks();
  (soulsApi.get as jest.Mock).mockResolvedValue({ data: { id: "s-1", name: "李四" } });
  mockOfficers.mockResolvedValue({
    data: [
      { id: 2, username: "cui", display_name: "崔判官", role: "JUDGE", in_hand: 3 },
      { id: 3, username: "zhong", display_name: "钟判官", role: "JUDGE", in_hand: 1 },
    ],
  });
});

describe("a pending reassign request on the judgment page", () => {
  it("shows who asked, when and why to the hall lead, and 改派给… reassigns this one case", async () => {
    asUser(1, LEAD);
    mockGet.mockResolvedValue({ data: judgment(ASKED) });
    mockReassign.mockResolvedValue({ data: judgment({ claimed_by: 3 }) });
    renderPage();
    const line = await screen.findByTestId("desk-reassign-request", {}, TIMEOUT);
    expect(line).toHaveTextContent("officer_app.case.reassign_request(崔判官,2026-11-15T09:00:00Z)");
    expect(line).toHaveTextContent("officer_app.dispatch_status.reason(本人回避)");

    fireEvent.click(screen.getByTestId("desk-reassign-to"));
    await waitFor(() => expect(mockOfficers).toHaveBeenCalledWith([ID]));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByText("钟判官"));
    fireEvent.click(within(dialog).getByRole("button", { name: "judgment.claim.reassign_confirm" }));
    await waitFor(() => expect(mockReassign).toHaveBeenCalledWith(ID, 3));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("judgment.claim.done_reassign(1)", "success"));
  });

  it("writes no reason line when the request carried none", async () => {
    asUser(1, LEAD);
    mockGet.mockResolvedValue({ data: judgment({ ...ASKED, reassign_reason: "" }) });
    renderPage();
    const line = await screen.findByTestId("desk-reassign-request", {}, TIMEOUT);
    expect(line).not.toHaveTextContent("officer_app.dispatch_status.reason");
  });

  // 第五十九批 N5: the request is read by everyone on the case; only who can reassign gets 改派给….
  it("shows an officer without judgment.assign the request line, with no 改派给…", async () => {
    asUser(1, JUDGE);
    mockGet.mockResolvedValue({ data: judgment(ASKED) });
    renderPage();
    const line = await screen.findByTestId("desk-reassign-request", {}, TIMEOUT);
    expect(line).toHaveTextContent("officer_app.case.reassign_request(崔判官,2026-11-15T09:00:00Z)");
    expect(screen.queryByTestId("desk-reassign-to")).toBeNull();
  });

  it.each([
    ["the officer who asked", 2, LEAD, ASKED],
    ["a concluded case", 1, LEAD, { ...ASKED, is_final: true, verdict: "PASSED", concluded_at: "2026-11-16T00:00:00Z" }],
    ["no request", 1, LEAD, { claimed_by: 2, claimed_by_name: "崔判官", reassign_requested_at: null }],
  ])("says nothing to %s", async (_label, id, perms, over) => {
    asUser(id as number, perms as string[]);
    mockGet.mockResolvedValue({ data: judgment(over as Record<string, unknown>) });
    renderPage();
    expect(await screen.findByText("judgment.title", {}, TIMEOUT)).toBeInTheDocument();
    expect(screen.queryByTestId("desk-reassign-request")).toBeNull();
    expect(screen.queryByTestId("desk-reassign-to")).toBeNull();
  });
});
