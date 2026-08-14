/**
 * The rebirth form actually reaches the API (app/souls/[id]/page.tsx).
 *
 * `handleReincarnate` posted a literal `rebirth_form: "HUMAN"`, and there was
 * no control anywhere in the UI to say otherwise — so every reincarnation this
 * product performed was written into 人道 while the backend enum carried all
 * six paths. Rendering a picker is only half the fix; these pin that what the
 * operator picks is what gets posted.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulDetailPage from "@/app/souls/[id]/page";

const SOUL_ID = "soul-1";
const DISPOSITION_ID = "disp-1";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: SOUL_ID }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// t() returns the key unchanged, matching this codebase's real missing-key
// fallback — so the page's `tf` helper renders its code-level fallbacks and
// the six options show up as their raw enum values. Stable references: the
// page's loadSoulData is a useCallback keyed on `t`.
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

jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazySoulLineChart: () => null,
  LazyLifespanBarChart: () => null,
}));

jest.mock("@/src/components/souls/SoulEditModal", () => ({
  SoulEditModal: () => null,
}));

jest.mock("@/lib/api/ledger", () => ({
  ledgerApi: { inheritance: jest.fn().mockRejectedValue({ response: { status: 409 } }) },
}));

const mockReborn = jest.fn();
const mockDispositionList = jest.fn();
jest.mock("@/lib/api", () => ({
  soulsApi: {
    get: (...args: unknown[]) => mockSoulsGet(...args),
    karma: jest.fn().mockResolvedValue({ data: null }),
    records: jest.fn().mockResolvedValue({ data: [] }),
  },
  judgmentApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  dispositionApi: { list: (...args: unknown[]) => mockDispositionList(...args) },
  reincarnationApi: {
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
    reborn: (...args: unknown[]) => mockReborn(...args),
  },
  eventsApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
}));

const mockSoulsGet = jest.fn();

const disposedSoul = {
  id: SOUL_ID,
  name: "Test Soul",
  civilization: "CHINESE",
  current_state: "DISPOSED",
  birth_date: null,
  death_date: null,
  birth_name: null,
  origin_location: null,
  date_problems: [],
};

const pendingDisposition = {
  id: DISPOSITION_ID,
  is_executed: false,
  realm_name: "第五殿",
  realm_code: "DY_COURT_05_YANLUO",
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SoulDetailPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSoulsGet.mockResolvedValue({ data: disposedSoul });
  mockDispositionList.mockResolvedValue({ data: { results: [pendingDisposition] } });
  mockReborn.mockResolvedValue({ data: {} });
});

describe("SoulDetailPage — rebirth form selection", () => {
  it("posts the picked path instead of the old hardcoded HUMAN", async () => {
    renderPage();

    await screen.findByRole("radio", { name: "HUNGRY_GHOST" });
    fireEvent.click(screen.getByRole("radio", { name: "HUNGRY_GHOST" }));
    fireEvent.click(screen.getByRole("button", { name: /souls\.detail\.reincarnate/ }));

    await waitFor(() => expect(mockReborn).toHaveBeenCalledTimes(1));
    expect(mockReborn).toHaveBeenCalledWith(
      expect.objectContaining({
        soul_id: SOUL_ID,
        disposition_id: DISPOSITION_ID,
        rebirth_form: "HUNGRY_GHOST",
      })
    );
  });

  it("still posts HUMAN when the operator picks nothing", async () => {
    renderPage();

    await screen.findByRole("radio", { name: "HUMAN" });
    fireEvent.click(screen.getByRole("button", { name: /souls\.detail\.reincarnate/ }));

    await waitFor(() => expect(mockReborn).toHaveBeenCalledTimes(1));
    expect(mockReborn.mock.calls[0][0]).toMatchObject({ rebirth_form: "HUMAN" });
  });

  it("shows no picker for a soul with nothing to reincarnate into", async () => {
    mockDispositionList.mockResolvedValue({ data: { results: [] } });
    renderPage();

    await screen.findByText("souls.detail.actions");
    await waitFor(() => {
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    });
  });
});
