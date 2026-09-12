/**
 * /disposition can be paged.
 *
 * `dispositionApi.list()` was called with no `page` and nothing on screen
 * offered another one, so everything past the server's twentieth row was
 * invisible and unreachable, and nothing said so (FL-09). `app/dispatch/page.tsx`
 * is the fixed sibling: page in the query key, `placeholderData` across the
 * flip, and `<Pagination>` with the count under the list.
 *
 * Two things are asserted, because either alone passes for the wrong reason:
 * the request carries the page (a control that changes state and never
 * reaches the wire is a decoration), and the control is on screen with the
 * total (a page param nobody can change is the old behaviour with extra
 * characters).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DispositionPage from "@/app/disposition/page";
import { dispositionApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  dispositionApi: { list: jest.fn(), execute: jest.fn() },
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

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const mockTenant = {
  user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: ["disposition.execute"] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

jest.mock("@/src/components/layout/MenuGloss", () => ({
  MenuGloss: () => null,
}));

const mockList = dispositionApi.list as jest.Mock;

function row(i: number) {
  return {
    id: `d-${i}`,
    soul: `s-${i}`,
    soul_name: `Soul ${i}`,
    destination_realm: "R1",
    realm_name: "Diyu",
    is_executed: false,
    executed_at: null,
    memory_reset: false,
    is_eternal: false,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DispositionPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockImplementation(async (params?: Record<string, string>) => {
    const page = Number(params?.page ?? "1");
    return {
      data: {
        count: 45,
        next: page < 3 ? `http://x/api/v1/disposition/?page=${page + 1}` : null,
        previous: null,
        results: [row(page * 100 + 1), row(page * 100 + 2)],
      },
    };
  });
});

describe("disposition list pagination", () => {
  it("asks the server for page 1 explicitly and shows 3 pages of 45", async () => {
    renderPage();

    await screen.findByText("Soul 101");
    expect(mockList).toHaveBeenCalledWith({ page: "1" });
    // page, total, count — the order `Pagination` hands `t`.
    expect(screen.getByText("pagination.info:1,3,45")).toBeInTheDocument();
  });

  it("requests page 2 when the operator moves forward, and shows its rows", async () => {
    renderPage();
    await screen.findByText("Soul 101");

    // The step button's name is its text (`common.next →`); only first/last
    // and the jump field carry `aria-label`s.
    fireEvent.click(screen.getByRole("button", { name: "common.next →" }));

    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ page: "2" }));
    expect(await screen.findByText("Soul 201")).toBeInTheDocument();
    expect(screen.queryByText("Soul 101")).toBeNull();
    expect(screen.getByText("pagination.info:2,3,45")).toBeInTheDocument();
  });
});
