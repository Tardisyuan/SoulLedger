/**
 * 灵魂详情页身份带右栏的「案号」(Design 第十五批 B2)。
 *
 * 页面经 `usePlaque({ caseRef })` 报给身份带:有未结的写未结那场(「未结」),否则写最近一场已结的
 * (「已结」),一场都没有是 `{}`(「案号 —」);无 judgment.read 的人不发审判列表请求,也是 `{}`。
 * 未读到列表(加载中)不下结论 —— 此时没有 caseRef,不能先闪一个「—」。
 * 审判不止一场时多报 `allHref` / `allCount`(「全部 N 场 ›」):N 是列表接口的 `count`,不是当前页的条数;
 * 只有一场或没有时不报。
 *
 * 真页面,只替换 HTTP 层与身份带的 setter(同 WelcomePage.test 的做法)。
 */
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulDetailPage from "@/app/souls/[id]/page";
import { makeTranslateWithFallback } from "@/src/contexts/I18nContext";

const SOUL_ID = "soul-1";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: SOUL_ID }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const mockT = (key: string) => key;
const mockI18n = { t: mockT, tf: makeTranslateWithFallback(mockT), formatDate: (v: unknown) => String(v), formatDateTime: (v: unknown) => String(v), locale: "zh" };
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

let mockUser: { id: number; username: string; role: string; tenant: null; permissions: string[] };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/components/charts/LifespanBarChart", () => ({ LifespanBarChart: () => null }));
jest.mock("@soulledger/core/api/ledger", () => ({
  ...jest.requireActual("@soulledger/core/api/ledger"),
  ledgerApi: { inheritance: jest.fn().mockRejectedValue({ response: { status: 409 } }) },
}));

const mockPlaque = jest.fn();
jest.mock("@/src/components/plaque/Plaque", () => ({ usePlaque: (text: unknown) => mockPlaque(text) }));
const caseRefs = () => mockPlaque.mock.calls.map((c) => c[0]?.caseRef);
const lastCaseRef = () => caseRefs().at(-1);

const judgment = (id: string, over: Record<string, unknown>) => ({
  id,
  case_number: `CN-${id}`,
  soul: SOUL_ID,
  civilization: "CHINESE",
  is_final: true,
  verdict: "PASSED",
  created_at: "2026-09-01T00:00:00Z",
  ...over,
});
const mockJudgmentList = jest.fn();

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  soulsApi: {
    get: jest.fn().mockResolvedValue({
      data: {
        id: "soul-1", name: "待审之魂", civilization: "CHINESE", current_state: "JUDGING",
        birth_date: null, death_date: null, birth_name: null, origin_location: null, date_problems: [],
      },
    }),
    karma: jest.fn().mockResolvedValue({
      data: {
        soul_id: "soul-1", merit_score: 0, demerit_score: 0, karmic_balance: 0, record_count: 0, records: [],
        reading: { kind: "BALANCE", civilization: "CHINESE", balance: 0, merit: 0, demerit: 0 },
      },
    }),
    records: jest.fn().mockResolvedValue({ data: [] }),
  },
  judgmentApi: { list: (params?: Record<string, string>) => mockJudgmentList(params), create: jest.fn() },
  dispositionApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  reincarnationApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  eventsApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  soulAccountsApi: { accounts: (params?: Record<string, string>) => mockAccounts(params) },
}));
const mockAccounts = jest.fn();
const account = (over: Record<string, unknown>) => ({
  id: "acc-1", soul: SOUL_ID, cycle: 1, soul_code: "7K3Q4G8B2M", origin: "AUTO", retired_at: null,
  must_change_password: false, initial_password_expires_at: null, mfa_enabled: false, mfa_enabled_at: null,
  last_login: null, email_not_synced: null, ...over,
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SoulDetailPage />
    </QueryClientProvider>,
  );
}

const withJudgments = (results: unknown[]) =>
  mockJudgmentList.mockResolvedValue({ data: { count: results.length, next: null, previous: null, results } });

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 1, username: "admin", role: "ADMIN", tenant: null, permissions: [] };
  mockAccounts.mockResolvedValue({ data: { results: [] } });
});

describe("the identity band's case number on a soul", () => {
  it("shows the open judgment, linked, marked open, even when newer-looking closed ones exist", async () => {
    withJudgments([
      judgment("open", { is_final: false, verdict: null, created_at: "2026-09-01T00:00:00Z" }),
      judgment("closed", { created_at: "2026-10-01T00:00:00Z" }),
    ]);
    renderPage();
    await waitFor(() =>
      expect(lastCaseRef()).toEqual({ number: "CN-open", href: "/judgment/open", label: "souls.detail.case_open", allHref: `/judgment?soul=${SOUL_ID}`, allCount: 2 }),
    );
  });

  it("with only concluded judgments shows the most recent one, marked concluded", async () => {
    withJudgments([
      judgment("older", { created_at: "2026-08-01T00:00:00Z" }),
      judgment("newer", { created_at: "2026-09-20T00:00:00Z" }),
    ]);
    renderPage();
    await waitFor(() =>
      expect(lastCaseRef()).toEqual({ number: "CN-newer", href: "/judgment/newer", label: "souls.detail.case_closed", allHref: `/judgment?soul=${SOUL_ID}`, allCount: 2 }),
    );
  });

  const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|soul-1/i;

  it("the printed footer carries this life's account soul code, from the account card's own query (one request)", async () => {
    withJudgments([]);
    mockAccounts.mockResolvedValue({
      data: { results: [account({ id: "old", cycle: 0, soul_code: "SL-OLD-0001", retired_at: "2026-01-01T00:00:00Z" }), account({})] },
    });
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector("[data-print-reference]")).toHaveTextContent("print.soul_no 7K3 Q4G8 B2M"));
    expect(container.querySelector("[data-print-foot]")?.textContent ?? "").not.toMatch(UUID_SHAPE);
    expect(mockAccounts).toHaveBeenCalledTimes(1);
  });

  it("with no account yet the footer carries the soul's name, never its internal id", async () => {
    withJudgments([]);
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector("[data-print-reference]")).toHaveTextContent("待审之魂"));
    expect(container.querySelector("[data-print-reference]")?.textContent).toBe("待审之魂");
    expect(container.querySelector("[data-print-foot]")?.textContent ?? "").not.toMatch(UUID_SHAPE);
  });

  it("a viewer without soul_account.read sends no account request and gets the soul's name", async () => {
    mockUser = { ...mockUser, role: "OFFICER", permissions: ["soul.read"] };
    withJudgments([]);
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector("[data-print-reference]")).toHaveTextContent("待审之魂"));
    expect(mockAccounts).not.toHaveBeenCalled();
  });

  it("with no judgment at all keeps the label and reports an empty value", async () => {
    withJudgments([]);
    renderPage();
    await waitFor(() => expect(lastCaseRef()).toEqual({}));
    expect(lastCaseRef()).not.toHaveProperty("href");
  });

  it("does not conclude 'none' before the list has been read", async () => {
    mockJudgmentList.mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(mockPlaque).toHaveBeenCalled());
    expect(caseRefs().every((c) => c === undefined)).toBe(true);
  });

  it("sends no judgment request without judgment.read, and shows the empty value", async () => {
    mockUser = { ...mockUser, role: "OFFICER", permissions: ["soul.read"] };
    withJudgments([judgment("secret", {})]);
    renderPage();
    await waitFor(() => expect(lastCaseRef()).toEqual({}));
    expect(mockJudgmentList).not.toHaveBeenCalled();
    expect(JSON.stringify(caseRefs())).not.toContain("CN-secret");
  });

  it("with several judgments adds the 'all N' link to this soul's list; N is the API total, not the page length", async () => {
    mockJudgmentList.mockResolvedValue({
      data: { count: 21, next: "?page=2", previous: null, results: [judgment("a", {}), judgment("b", { created_at: "2026-09-02T00:00:00Z" })] },
    });
    renderPage();
    await waitFor(() => expect(lastCaseRef()?.number).toBe("CN-b"));
    expect(lastCaseRef()).toMatchObject({ allHref: `/judgment?soul=${SOUL_ID}`, allCount: 21 });
  });

  it("with exactly one judgment reports no 'all N' link", async () => {
    withJudgments([judgment("only", {})]);
    renderPage();
    await waitFor(() => expect(lastCaseRef()?.number).toBe("CN-only"));
    expect(Object.keys(lastCaseRef() as object).sort()).toEqual(["href", "label", "number"]);
  });

  it("with none reports no 'all N' link either", async () => {
    withJudgments([]);
    renderPage();
    await waitFor(() => expect(lastCaseRef()).toEqual({}));
  });
});
