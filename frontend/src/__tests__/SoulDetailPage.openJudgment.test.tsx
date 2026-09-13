/**
 * FL-19: "start judgment" must find the open judgment wherever it is.
 *
 * `handleStartJudgment` looked for an unfinished judgment with
 * `judgments.find(j => !j.is_final)` over `useJudgments({ soul })` — the first
 * page (PAGE_SIZE 20) of that soul's judgments. A soul with more than twenty
 * judgments whose open one sits on page two got a SECOND pending judgment
 * created alongside it. The backend's `JudgmentFilter` already takes
 * `is_final`, so the page asks the question directly instead of paging.
 *
 * Rendered for real with only the HTTP layer stubbed, like
 * `SoulDetailPage.cacheInvalidation.test.tsx`.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulDetailPage from "@/app/souls/[id]/page";
import { makeTranslateWithFallback } from "@/src/contexts/I18nContext";

const SOUL_ID = "soul-1";

const mockPush = jest.fn();
const mockRouter = { push: mockPush };
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  useParams: () => ({ id: SOUL_ID }),
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockT = (key: string) => key;
const mockI18n = {
  t: mockT,
  tf: makeTranslateWithFallback(mockT),
  formatDate: (v: unknown) => String(v),
  locale: "zh",
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

const mockTenant = {
  user: { id: 1, username: "admin", role: "ADMIN", tenant: null, permissions: [] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazySoulLineChart: () => null,
  LazyLifespanBarChart: () => null,
}));

jest.mock("@soulledger/core/api/ledger", () => ({
  ...jest.requireActual("@soulledger/core/api/ledger"),
  ledgerApi: { inheritance: jest.fn().mockRejectedValue({ response: { status: 409 } }) },
}));

const OPEN_ID = "judgment-on-page-two";

/** Twenty concluded judgments: the whole first page, none of them open. */
const FIRST_PAGE = Array.from({ length: 20 }, (_, i) => ({
  id: `closed-${i}`,
  soul: SOUL_ID,
  civilization: "CHINESE",
  is_final: true,
  verdict: "PASSED",
  created_at: "2026-09-13T00:00:00Z",
}));

const mockJudgmentList = jest.fn((params?: Record<string, string>): Promise<{ data: unknown }> => {
  if (params?.is_final === "false") {
    return Promise.resolve({
      data: { count: 1, next: null, previous: null, results: [{ ...FIRST_PAGE[0], id: OPEN_ID, is_final: false, verdict: null }] },
    });
  }
  return Promise.resolve({ data: { count: 21, next: "?page=2", previous: null, results: FIRST_PAGE } });
});
const mockJudgmentCreate = jest.fn().mockResolvedValue({ data: { id: "a-duplicate" } });

jest.mock("@soulledger/core/api", () => ({
  soulsApi: {
    get: jest.fn().mockResolvedValue({
      data: {
        id: "soul-1",
        name: "待审之魂",
        civilization: "CHINESE",
        current_state: "JUDGING",
        birth_date: null,
        death_date: null,
        birth_name: null,
        origin_location: null,
        date_problems: [],
      },
    }),
    karma: jest.fn().mockResolvedValue({
      data: {
        soul_id: "soul-1",
        merit_score: 0,
        demerit_score: 0,
        karmic_balance: 0,
        record_count: 0,
        records: [],
        reading: { kind: "BALANCE", civilization: "CHINESE", balance: 0, merit: 0, demerit: 0 },
      },
    }),
    records: jest.fn().mockResolvedValue({ data: [] }),
  },
  judgmentApi: {
    list: (params?: Record<string, string>) => mockJudgmentList(params),
    create: (...args: unknown[]) => mockJudgmentCreate(...args),
  },
  dispositionApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  reincarnationApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  eventsApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SoulDetailPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("starting a judgment on a soul with more than one page of judgments", () => {
  it("reuses the open judgment that only exists on page two instead of creating a duplicate", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "souls.detail.start_judgment" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith(`/judgment/${OPEN_ID}`);
    // Absence: the defect is a create call next to a perfectly good open case.
    expect(mockJudgmentCreate).not.toHaveBeenCalled();
    expect(mockJudgmentList).toHaveBeenCalledWith({ soul: SOUL_ID, is_final: "false" });
  });

  it("creates one when the soul really has no open judgment", async () => {
    mockJudgmentList.mockImplementation((params?: Record<string, string>) =>
      Promise.resolve({
        data: params?.is_final === "false"
          ? { count: 0, next: null, previous: null, results: [] }
          : { count: 20, next: null, previous: null, results: FIRST_PAGE },
      })
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "souls.detail.start_judgment" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/judgment/a-duplicate"));
    expect(mockJudgmentCreate).toHaveBeenCalledTimes(1);
  });
});
