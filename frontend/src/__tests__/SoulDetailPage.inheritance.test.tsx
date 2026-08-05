/**
 * Tests for the reincarnation-inheritance panel on app/souls/[id]/page.tsx.
 *
 * This panel used to recompute merit/demerit carryover client-side from a
 * single percentage. It now calls GET /ledger/inheritance/{soul_id}/ and:
 *   - renders nothing on 409 (terminal cosmology, no next life) rather than
 *     an error or empty state, and does so without retrying the request;
 *   - displays inherited_merit / inherited_demerit straight from the
 *     response, with the balance derived as their difference — not a
 *     percentage of the soul's current balance;
 *   - still treats any other failure (e.g. 500) as a real query error
 *     instead of folding it into the same "render nothing" path as 409.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulDetailPage from "@/app/souls/[id]/page";

const SOUL_ID = "soul-1";
const INHERITANCE_KEY = ["souls", "inheritance", SOUL_ID];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: SOUL_ID }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// t() returns the key unchanged (matching this codebase's real fallback
// behavior when a key is missing) so assertions can target exact key strings
// instead of locale copy. `t`/`formatDate` must be stable references — the
// component's loadSoulData is a useCallback keyed on `t`, so a mock that
// returns a fresh function on every call turns the effect that calls it
// into an infinite render loop.
const mockT = (key: string) => key;
const mockFormatDate = (v: unknown) => String(v);
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: mockT, formatDate: mockFormatDate }),
}));

jest.mock("@/src/hooks/useSouls", () => ({
  useUpdateSoul: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteSoul: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("@/src/components/rbac/RequirePermission", () => ({
  RequirePermission: ({ children }: { children: React.ReactNode }) => children,
}));

// Recharts under next/dynamic isn't relevant to this test and is a
// significant source of unrelated flake in jsdom — stub it out.
jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazySoulLineChart: () => null,
}));

jest.mock("@/src/components/souls/SoulEditModal", () => ({
  SoulEditModal: () => null,
}));

const mockInheritance = jest.fn();
jest.mock("@/lib/api/ledger", () => ({
  ledgerApi: {
    inheritance: (...args: unknown[]) => mockInheritance(...args),
  },
}));

const mockSoulsGet = jest.fn();
const mockSoulsLedger = jest.fn();
jest.mock("@/lib/api", () => ({
  soulsApi: {
    get: (...args: unknown[]) => mockSoulsGet(...args),
    karma: (...args: unknown[]) => mockSoulsLedger(...args),
    records: jest.fn().mockResolvedValue({ data: { results: [] } }),
  },
  judgmentApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  dispositionApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  reincarnationApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  eventsApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
}));

const mockSoul = {
  id: SOUL_ID,
  name: "Test Soul",
  civilization: "CHINESE",
  current_state: "ALIVE",
  birth_date: null,
  death_date: null,
  birth_name: null,
  origin_location: null,
};

// merit_score === demerit_score === 100 is the exact case the old
// client-side formula got wrong: karmic_balance is 0, so the old
// `Math.round(ledger.karmic_balance * 0.2)` line rendered "+0" regardless of
// what the backend's real inheritance figures were.
function mockLedgerWithOneRecord(meritScore: number, demeritScore: number) {
  return {
    soul_id: SOUL_ID,
    merit_score: meritScore,
    demerit_score: demeritScore,
    karmic_balance: meritScore - demeritScore,
    record_count: 1,
    records: [
      {
        id: "rec-1",
        soul: SOUL_ID,
        type: "MERIT",
        record_type: "MERIT",
        category: "test",
        description: "test",
        weight: 1,
        effective_weight: 1,
        event_date: "2020-01-01",
        recorded_at: "2020-01-01T00:00:00Z",
      },
    ],
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SoulDetailPage />
    </QueryClientProvider>
  );
  return { queryClient, ...utils };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSoulsGet.mockResolvedValue({ data: mockSoul });
  mockSoulsLedger.mockResolvedValue({ data: mockLedgerWithOneRecord(100, 100) });
});

describe("SoulDetailPage — inheritance panel", () => {
  it("renders no panel, heading, or empty state on 409 (terminal cosmology)", async () => {
    mockInheritance.mockRejectedValueOnce({
      response: {
        status: 409,
        data: { code: "REBIRTH_NOT_APPLICABLE", civilization: "EGYPTIAN", detail: "no next life" },
      },
    });

    const { queryClient } = renderPage();

    // Wait for the ledger card (and its chart section, which the panel is
    // nested inside) to finish loading.
    await screen.findByText(/ledger\.timeline/);

    await waitFor(() => {
      expect(queryClient.getQueryState(INHERITANCE_KEY)?.status).toBe("success");
    });
    // 409 resolves to a successful `null`, not a query error — this is what
    // keeps it out of TanStack's retry and error paths.
    expect(queryClient.getQueryState(INHERITANCE_KEY)?.data).toBeNull();
    expect(mockInheritance).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("ledger.next_life_inheritance")).not.toBeInTheDocument();
    expect(screen.queryByText("ledger.inheritance_note")).not.toBeInTheDocument();
    expect(screen.queryByText(/inherit/i)).not.toBeInTheDocument();
  });

  it("renders inherited_merit/inherited_demerit and a merit-minus-demerit balance from the response", async () => {
    mockInheritance.mockResolvedValueOnce({
      data: {
        soul_id: SOUL_ID,
        inherited_merit: 20,
        inherited_demerit: 100,
        inheritance_note: "carries forward",
      },
    });

    renderPage();

    await screen.findByText("ledger.next_life_inheritance");

    expect(
      screen.getByText((_, el) => el?.textContent === "souls.detail.merit: +20")
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.textContent === "souls.detail.demerit: -100")
    ).toBeInTheDocument();
    // 20 - 100 = -80: under the old `karmic_balance * 0.2` formula (with
    // merit_score === demerit_score === 100, karmic_balance is 0) this line
    // rendered "+0". This is the regression the endpoint switch fixes.
    expect(screen.getByText("-80")).toBeInTheDocument();
  });

  it("treats a non-409 error (500) as a real query error, not the 409 render-nothing path", async () => {
    mockInheritance.mockRejectedValueOnce({ response: { status: 500 } });

    const { queryClient } = renderPage();

    await screen.findByText(/ledger\.timeline/);

    await waitFor(() => {
      expect(queryClient.getQueryState(INHERITANCE_KEY)?.status).toBe("error");
    });

    // Same visual outcome as 409 (nothing shown, since this is a decorative
    // panel with no dedicated error UI) — but the assertion above is what
    // proves it got there via the error path, not the 409 special case.
    expect(screen.queryByText("ledger.next_life_inheritance")).not.toBeInTheDocument();
  });
});
