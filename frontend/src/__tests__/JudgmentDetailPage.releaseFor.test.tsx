/**
 * 「替{name}放回」在审判页头(官员端 App O-a 的 release_for):持 judgment.assign 的人打开别人手上的未结案,
 * 页头有这个键;理由必填,确认后 `release(id, reason)`。不持 judgment.assign、自己手上、没人认领、已结案 —— 都没有这个键。
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
  judgmentApi: { get: jest.fn(), conclude: jest.fn(), release: jest.fn() },
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
const mockRelease = judgmentApi.release as jest.Mock;

function asUser(id: number, permissions: string[]) {
  mockTenant.user = { id, username: "me", role: "JUDGE", tenant: { id: 1, code: "CN_DIYU" }, permissions };
}

const HELD = { claimed_by: 2, claimed_by_name: "崔判官" };

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
});

describe("releasing someone else's case from the judgment page", () => {
  it("asks for a reason, refuses a blank one, then releases with it", async () => {
    asUser(1, LEAD);
    mockGet.mockResolvedValue({ data: judgment(HELD) });
    mockRelease.mockResolvedValue({ data: judgment() });
    renderPage();
    fireEvent.click(await screen.findByTestId("desk-release-for", {}, TIMEOUT));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "officer_app.case.release_for(崔判官)" });
    fireEvent.click(confirm);
    expect(await within(dialog).findByText("judgment.claim.reason_required")).toBeInTheDocument();
    expect(mockRelease).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  交接  " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith(ID, "交接"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("officer_app.case.done_released", "success"));
  });

  it.each([
    ["an officer without judgment.assign", 1, JUDGE, HELD],
    ["the holder", 2, LEAD, HELD],
    ["an unclaimed case", 1, LEAD, {}],
    ["a concluded case", 1, LEAD, { ...HELD, is_final: true, verdict: "PASSED", concluded_at: "2026-11-16T00:00:00Z" }],
  ])("offers nothing to %s", async (_label, id, perms, over) => {
    asUser(id as number, perms as string[]);
    mockGet.mockResolvedValue({ data: judgment(over as Record<string, unknown>) });
    renderPage();
    expect(await screen.findByText("judgment.title", {}, TIMEOUT)).toBeInTheDocument();
    expect(screen.queryByTestId("desk-release-for")).toBeNull();
  });
});
