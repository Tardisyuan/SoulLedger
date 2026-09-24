/**
 * /death-sync can be paged. Same defect and same fix as
 * `DispositionPage.pagination.test.tsx` (FL-09); read that header. Also the
 * status filter: it lives in `?status=`, so the dashboard's 「死亡同步异常」 cell
 * can link straight to it.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeathSyncPage from "@/app/death-sync/page";
import { deathSyncApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  deathSyncApi: { registrations: jest.fn(), summary: jest.fn() },
  // The page derives `totalPages` from this; a mock without it is NaN pages.
  PAGE_SIZE: 20,
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    formatDateTime: (v: string) => v,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const mockTenant = {
  user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: [] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

jest.mock("@/src/components/layout/MenuGloss", () => ({
  MenuGloss: () => null,
}));

const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/death-sync",
  useSearchParams: () => mockSearch,
}));

const mockGet = deathSyncApi.registrations as jest.Mock;
const mockSummary = deathSyncApi.summary as jest.Mock;

function row(i: number) {
  return {
    id: `r-${i}`,
    source_system: `Registry ${i}`,
    source_reference_id: `REF-${i}`,
    idempotency_key: `k-${i}`,
    status: "PROCESSED",
    request_timestamp: "2026-09-12T00:00:00Z",
    processing_duration_ms: null,
    error_message: "",
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DeathSyncPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockSummary.mockResolvedValue({ data: { anomaly_status: "FAILED", anomaly_count: 0 } });
  mockGet.mockImplementation(async (params?: Record<string, string>) => {
    const page = Number(params?.page ?? "1");
    return {
      data: {
        count: 45,
        next: page < 3 ? `http://x/api/v1/death-sync/registrations/?page=${page + 1}` : null,
        previous: null,
        results: [row(page * 100 + 1), row(page * 100 + 2)],
      },
    };
  });
});

describe("death registration list pagination", () => {
  it("asks the server for page 1 explicitly and shows 3 pages of 45", async () => {
    renderPage();

    await screen.findByText("Registry 101");
    expect(mockGet).toHaveBeenCalledWith({ page: "1" });
    expect(screen.getByText("pagination.info:1,3,45")).toBeInTheDocument();
  });

  it("requests page 2 when the operator moves forward, and shows its rows", async () => {
    renderPage();
    await screen.findByText("Registry 101");

    fireEvent.click(screen.getByRole("button", { name: "common.next →" }));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith({ page: "2" })
    );
    expect(await screen.findByText("Registry 201")).toBeInTheDocument();
    expect(screen.queryByText("Registry 101")).toBeNull();
  });
});

describe("death registration status filter", () => {
  it("sends ?status= from the URL to the server and shows it on the chip", async () => {
    mockSearch = new URLSearchParams("status=FAILED");
    renderPage();
    await screen.findByText("Registry 101");
    expect(mockGet).toHaveBeenCalledWith({ page: "1", status: "FAILED" });
    expect((screen.getByLabelText("death_sync.status_label") as HTMLSelectElement).value).toBe("FAILED");
  });

  it("writes a picked status into the URL, and clearing it drops the parameter", async () => {
    mockSearch = new URLSearchParams("status=FAILED");
    renderPage();
    await screen.findByText("Registry 101");
    fireEvent.change(screen.getByLabelText("death_sync.status_label"), { target: { value: "PENDING" } });
    expect(mockReplace).toHaveBeenLastCalledWith("/death-sync?status=PENDING");
    fireEvent.click(screen.getByRole("button", { name: "filter.clear_one:death_sync.status_label" }));
    expect(mockReplace).toHaveBeenLastCalledWith("/death-sync");
  });

  it("shows the server's anomaly count as a shortcut to that status, and nothing at zero", async () => {
    mockSummary.mockResolvedValue({ data: { anomaly_status: "FAILED", anomaly_count: 4 } });
    renderPage();
    const shortcut = await screen.findByTestId("death-sync-anomalies");
    expect(shortcut).toHaveTextContent("death_sync.anomaly_count:4");
    fireEvent.click(shortcut);
    expect(mockReplace).toHaveBeenLastCalledWith("/death-sync?status=FAILED");
  });

  it("has no anomaly shortcut when nothing failed", async () => {
    renderPage();
    await screen.findByText("Registry 101");
    await waitFor(() => expect(mockSummary).toHaveBeenCalled());
    expect(screen.queryByTestId("death-sync-anomalies")).not.toBeInTheDocument();
  });
});
