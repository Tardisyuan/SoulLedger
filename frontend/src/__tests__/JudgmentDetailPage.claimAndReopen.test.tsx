/**
 * fix-be1 遗留(网页),审判台两件事:
 *
 * 1. 别人认领中、自己又不持 judgment.assign(服务端 `can_edit: false`,与 `claims.assert_may_edit` 同一条规则):
 *    判词框、裁决键、落判一概不可用,页头说为什么;持 judgment.assign 越过的人照常可改,页头说「会留痕」。
 * 2. 原审的审批流被撤销(`flow_cancelled`):持 judgment.assign 的人看到「重开一案」,成功去新案,拒绝码走译文。
 *
 * 真页面、真 QueryClient,只桩 HTTP 层(同 JudgmentDetailPage.notesDraft.test.tsx)。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ID = "j-1";

// `React.use` shim:同 notesDraft 那份,只解开测试递进去的那个已决 params。
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

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => null,
  usePathname: () => `/judgment/${ID}`,
}));

import JudgmentDetailPage from "@/app/judgment/[id]/page";
import { judgmentApi, soulsApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { get: jest.fn(), conclude: jest.fn(), reopenCancelled: jest.fn() },
  soulsApi: { get: jest.fn() },
}));

const mockI18n = {
  t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
  formatDate: (v: unknown) => String(v),
  formatDateTime: (v: unknown) => String(v),
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

const mockToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockToast }),
}));

const JUDGE = ["judgment.read", "judgment.execute"];
const LEAD = [...JUDGE, "judgment.assign"];
const mockTenant: { user: Record<string, unknown> } = { user: {} };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

const mockGet = judgmentApi.get as jest.Mock;
const mockReopen = judgmentApi.reopenCancelled as jest.Mock;

function asUser(permissions: string[]) {
  mockTenant.user = { id: 1, username: "me", role: "JUDGE", tenant: { id: 1, code: "CN_DIYU" }, permissions };
}

function judgment(over: Record<string, unknown> = {}) {
  return {
    id: ID, case_number: "J-1", soul: "s-1", soul_name: "李四", civilization: "CHINESE", judge: "u-1", judge_name: "Yama",
    court: "第一殿", evidence_json: {}, confession: "", verdict: null, notes: "草稿判词", citations: [], is_final: false,
    created_at: "2026-09-12T00:00:00Z", concluded_at: null, claimed_by: null, claimed_by_name: null,
    can_edit: true, flow_cancelled: false, ...over,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JudgmentDetailPage params={Promise.resolve({ id: ID })} />
    </QueryClientProvider>,
  );
}

const TIMEOUT = { timeout: 5000 };

beforeEach(() => {
  jest.clearAllMocks();
  (soulsApi.get as jest.Mock).mockResolvedValue({ data: { id: "s-1", name: "李四" } });
});

describe("someone else's claimed case", () => {
  it("shows no editing controls to an officer who may not edit it, and says why", async () => {
    asUser(JUDGE);
    mockGet.mockResolvedValue({ data: judgment({ claimed_by: 2, claimed_by_name: "崔判官", can_edit: false }) });
    renderPage();
    expect(await screen.findByTestId("desk-not-claimant", {}, TIMEOUT)).toHaveTextContent(
      "judgment.claim.not_yours_readonly(崔判官)",
    );
    expect(screen.queryByLabelText("judgment.detail.notes")).toBeNull();
    expect(screen.getAllByText("草稿判词").length).toBeGreaterThan(0); // 读得到草稿,只是不能改
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    for (const b of screen.getAllByRole("button", { name: /judgment\.desk\.to_confirm/ })) expect(b).toBeDisabled();
    expect(screen.queryByTestId("desk-claim-override")).toBeNull();
  });

  it("lets an officer holding judgment.assign edit, and says the edit is recorded", async () => {
    asUser(LEAD);
    mockGet.mockResolvedValue({ data: judgment({ claimed_by: 2, claimed_by_name: "崔判官", can_edit: true }) });
    renderPage();
    expect(await screen.findByTestId("desk-claim-override", {}, TIMEOUT)).toHaveTextContent(
      "judgment.claim.override_recorded(崔判官)",
    );
    expect(screen.getByLabelText("judgment.detail.notes")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-not-claimant")).toBeNull();
  });

  it("says nothing to the claimant", async () => {
    asUser(JUDGE);
    mockGet.mockResolvedValue({ data: judgment({ claimed_by: 1, claimed_by_name: "me", can_edit: true }) });
    renderPage();
    expect(await screen.findByLabelText("judgment.detail.notes", {}, TIMEOUT)).toBeInTheDocument();
    expect(screen.queryByTestId("desk-claim-override")).toBeNull();
    expect(screen.queryByTestId("desk-not-claimant")).toBeNull();
  });
});

describe("reopening a case whose flow was cancelled", () => {
  const concluded = (over: Record<string, unknown> = {}) =>
    judgment({ is_final: true, verdict: "FAILED", concluded_at: "2026-10-01T00:00:00Z", ...over });

  it("offers the hall lead a new case, and goes to it", async () => {
    asUser(LEAD);
    mockGet.mockResolvedValue({ data: concluded({ flow_cancelled: true }) });
    mockReopen.mockResolvedValue({ data: { id: "j-2", case_number: "J-2" } });
    renderPage();
    fireEvent.click(await screen.findByTestId("reopen-cancelled", {}, TIMEOUT));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/judgment/j-2"));
    expect(mockReopen).toHaveBeenCalledWith(ID);
    expect(mockToast).toHaveBeenCalledWith("judgment.reopen_cancelled.done(J-2)", "success");
  });

  it("translates a refusal", async () => {
    asUser(LEAD);
    mockGet.mockResolvedValue({ data: concluded({ flow_cancelled: true }) });
    mockReopen.mockRejectedValue({ response: { status: 409, data: { code: "cannot_reopen" } } });
    renderPage();
    fireEvent.click(await screen.findByTestId("reopen-cancelled", {}, TIMEOUT));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("judgment.reopen_cancelled.refusal.cannot_reopen", "error"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("is not offered without judgment.assign, or when the flow was not cancelled", async () => {
    asUser(JUDGE);
    mockGet.mockResolvedValue({ data: concluded({ flow_cancelled: true }) });
    const first = renderPage();
    await screen.findByRole("button", { name: "print.button" }, TIMEOUT);
    expect(screen.queryByTestId("reopen-cancelled")).toBeNull();
    first.unmount();

    asUser(LEAD);
    mockGet.mockResolvedValue({ data: concluded({ flow_cancelled: false }) });
    renderPage();
    await screen.findByRole("button", { name: "print.button" }, TIMEOUT);
    expect(screen.queryByTestId("reopen-cancelled")).toBeNull();
  });
});
