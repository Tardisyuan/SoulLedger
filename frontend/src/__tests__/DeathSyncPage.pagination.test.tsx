/**
 * /death-sync can be paged. Same defect and same fix as
 * `DispositionPage.pagination.test.tsx` (FL-09); read that header. This page
 * reaches the API through the bare `api.get`, so the request shape asserted
 * here is the axios call rather than a typed client method.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeathSyncPage from "@/app/death-sync/page";
import { api } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  api: { get: jest.fn() },
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

const mockGet = api.get as jest.Mock;

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
  mockGet.mockImplementation(async (_url: string, config?: { params?: Record<string, string> }) => {
    const page = Number(config?.params?.page ?? "1");
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
    expect(mockGet).toHaveBeenCalledWith("/death-sync/registrations/", { params: { page: "1" } });
    expect(screen.getByText("pagination.info:1,3,45")).toBeInTheDocument();
  });

  it("requests page 2 when the operator moves forward, and shows its rows", async () => {
    renderPage();
    await screen.findByText("Registry 101");

    fireEvent.click(screen.getByRole("button", { name: "common.next →" }));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith("/death-sync/registrations/", { params: { page: "2" } })
    );
    expect(await screen.findByText("Registry 201")).toBeInTheDocument();
    expect(screen.queryByText("Registry 101")).toBeNull();
  });
});
