/**
 * app/souls/page.tsx — the right drawer (规范 v1「抽屉 · 右侧 480 px」).
 *
 * What is pinned: the row stays a link to the full record (the drawer is a
 * separate control, not a hijacked row click); J / K step rows and stop at the
 * ends; Esc closes and focus goes back to the row now shown (not the one that
 * first opened it); loading is a skeleton under aria-busy; a failed detail
 * fetch is an error bar under the header, not an empty drawer.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulsPage from "@/app/souls/page";

const souls = [
  { id: "a1", name: "沈青梧", civilization: "CHINESE", current_state: "DISPOSED", karmic_balance: 347, birth_date: null, death_date: null, date_problems: [], has_date_warning: false, has_record_error: false, is_eval_identity: false },
  { id: "b2", name: "Marguerite Vey", civilization: "EUROPEAN", current_state: "JUDGING", birth_date: null, death_date: null, date_problems: [], has_date_warning: false, has_record_error: false, is_eval_identity: false },
  { id: "c3", name: "Nebet-Iunu", civilization: "EGYPTIAN", current_state: "ALIVE", birth_date: null, death_date: null, date_problems: [], has_date_warning: false, has_record_error: false, is_eval_identity: true },
];

type DetailState = { data?: unknown; isLoading: boolean; isError: boolean };
let detail: (_id: string) => DetailState = (id) => ({
  isLoading: false,
  isError: false,
  data: { ...souls.find((s) => s.id === id), origin_location: `loc-${id}`, merit_score: 1284, demerit_score: 937 },
});
const mockRefetch = jest.fn();

const mockListParams: Record<string, unknown>[] = [];
jest.mock("@soulledger/core/hooks/useSouls", () => ({
  useSouls: (params: Record<string, unknown>) => (mockListParams.push(params), { data: { results: souls, count: souls.length }, isLoading: false, isError: false, isPlaceholderData: false, refetch: jest.fn() }),
  useSoul: (id: string) => ({ ...(id ? detail(id) : { isLoading: false, isError: false }), refetch: mockRefetch }),
  useCreateSoul: () => ({ mutateAsync: jest.fn() }),
  // The batch bar (SoulBatchBar) is on this page too; ADMIN holds soul.delete.
  useBatchRecycleSouls: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  soulsApi: { list: jest.fn().mockResolvedValue({ data: { count: 0, results: [] } }) },
}));

// The real gate runs (suiteShape forbids stubbing it); an ADMIN session lets it through.
let mockSearch = "";
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => new URLSearchParams(mockSearch) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { role: "ADMIN" } }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params?.name ? `${key}:${params.name}` : key),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SoulsPage />
    </QueryClientProvider>
  );
}

const previewButton = (name: string) => screen.getByRole("button", { name: `souls.preview.open_aria:${name}` });
const drawer = () => screen.getByRole("dialog");

beforeEach(() => {
  mockSearch = "";
  mockListParams.length = 0;
  detail = (id) => ({
    isLoading: false,
    isError: false,
    data: { ...souls.find((s) => s.id === id), origin_location: `loc-${id}`, merit_score: 1284, demerit_score: 937 },
  });
});

describe("?q= from the global search", () => {
  it("fills the search box and the first list request carries it", () => {
    mockSearch = "q=%E6%B2%88";
    renderPage();
    expect(screen.getByPlaceholderText("souls.search_placeholder")).toHaveValue("沈");
    expect(mockListParams[0]).toMatchObject({ search: "沈", page: 1 });
    // Absence: no request went out without the word first.
    expect(mockListParams.some((p) => !("search" in p))).toBe(false);
  });
});

describe("souls list drawer", () => {
  it("keeps the row a link to the full record; the drawer has its own control", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "沈青梧" })).toHaveAttribute("href", "/souls/a1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(previewButton("沈青梧"));
    expect(within(drawer()).getByText("沈青梧")).toBeInTheDocument();
    expect(within(drawer()).getByText("loc-a1")).toBeInTheDocument();
    expect(within(drawer()).getByRole("link", { name: "souls.preview.open_full" })).toHaveAttribute("href", "/souls/a1");
  });

  it("J / K step rows and stop at either end", () => {
    renderPage();
    fireEvent.click(previewButton("沈青梧"));
    fireEvent.keyDown(drawer(), { key: "k" }); // already first: nothing
    expect(within(drawer()).getByText("loc-a1")).toBeInTheDocument();
    fireEvent.keyDown(drawer(), { key: "j" });
    expect(within(drawer()).getByText("loc-b2")).toBeInTheDocument();
    // Absence as well as presence: the previous soul is gone, not stacked.
    expect(within(drawer()).queryByText("loc-a1")).not.toBeInTheDocument();
    fireEvent.keyDown(drawer(), { key: "j" });
    fireEvent.keyDown(drawer(), { key: "j" }); // already last: nothing
    expect(within(drawer()).getByText("loc-c3")).toBeInTheDocument();
    fireEvent.keyDown(drawer(), { key: "K" });
    expect(within(drawer()).getByText("loc-b2")).toBeInTheDocument();
  });

  it("Esc closes, and focus returns to the row now shown, not the one that opened it", async () => {
    renderPage();
    previewButton("沈青梧").focus();
    fireEvent.click(previewButton("沈青梧"));
    fireEvent.keyDown(drawer(), { key: "j" });
    await act(async () => {
      fireEvent.keyDown(drawer(), { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(previewButton("Marguerite Vey")).toHaveFocus());
  });

  it("shows a skeleton under aria-busy while the detail loads", () => {
    detail = () => ({ isLoading: true, isError: false });
    renderPage();
    fireEvent.click(previewButton("沈青梧"));
    expect(drawer().querySelector("dl")).toHaveAttribute("aria-busy", "true");
    expect(drawer().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(within(drawer()).queryByText("loc-a1")).not.toBeInTheDocument();
  });

  it("a failed detail fetch is an error bar with retry, not an empty drawer", () => {
    detail = () => ({ isLoading: false, isError: true });
    renderPage();
    fireEvent.click(previewButton("沈青梧"));
    const alert = within(drawer()).getByRole("alert");
    expect(alert).toHaveTextContent("souls.preview.load_error");
    fireEvent.click(within(alert).getByRole("button", { name: "common.retry" }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("tags the assistant's eval soul, and only it (「评测专用 · 不能登录」)", () => {
    renderPage();
    const tags = screen.getAllByText("assist_admin.identities.tag");
    expect(tags).toHaveLength(1);
    expect(tags[0].closest("tr")).toHaveTextContent("Nebet-Iunu");
    // Design: after the row's status tag, in the same cell; dashed neutral border.
    expect(tags[0].previousElementSibling).toHaveAttribute("title", "ALIVE");
    expect(tags[0].className).toContain("border-dashed");
  });
});
