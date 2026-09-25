/**
 * app/souls/page.tsx — the batch bar (规范 v1 §3.1「有接口」, POST
 * /souls/batch-recycle/ via `useBatchRecycleSouls`).
 *
 * Pinned: the checkbox column is a real, keyboard-reachable control that sits
 * outside the row link; the bar says 「已选 N」 and offers 移入回收站 (behind a
 * confirm in the recycle-bin wording) and 取消选择; the selection empties on a
 * page or filter change and on Esc; a refused batch names the refused souls BY
 * NAME, keeps the selection (nothing was deleted), and leaves the dialog open;
 * without `soul.delete` there is no column and no bar.
 *
 * The refusal is a real AxiosError run through the real
 * `soulBatchRecycleErrorOf`, so the page is tested against the shape the API
 * module actually recognises, not against a stub that agrees with the page.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import SoulsPage from "@/app/souls/page";

const soul = (id: string, name: string) => ({
  id,
  name,
  civilization: "CHINESE",
  current_state: "JUDGING",
  karmic_balance: 0,
  birth_date: null,
  death_date: null,
  date_problems: [],
  has_date_warning: false,
  has_record_error: false,
});
const PAGE_1 = [soul("a1", "沈青梧"), soul("b2", "周慕云")];
const PAGE_2 = [soul("c3", "王素心")];

jest.mock("@soulledger/core/hooks/useSouls", () => ({
  useSouls: (params: { page?: number }) => ({
    data: { results: params.page === 2 ? PAGE_2 : PAGE_1, count: 21 },
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: jest.fn(),
  }),
  useSoul: () => ({ isLoading: false, isError: false }),
  useCreateSoul: () => ({ mutateAsync: jest.fn() }),
  useBatchRecycleSouls: () => ({ mutate: mockMutate, isPending: false }),
}));
const mockMutate = jest.fn();

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  PAGE_SIZE: 20,
  soulsApi: { list: jest.fn().mockResolvedValue({ data: { count: 0, results: [] } }) },
}));

let mockUser: Record<string, unknown> = { role: "OPERATOR", permissions: ["soul.read", "soul.delete"] };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
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

const box = (name: string) => screen.getByRole("checkbox", { name: `souls.batch.select_row:${name}` });
const bar = () => screen.queryByRole("region", { name: "souls.batch.region" });

function refusal(code: string, ids: string[]) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("refused", "ERR_BAD_REQUEST", config, null, {
    status: code === "not_found" ? 404 : 409,
    statusText: "",
    headers: {},
    config,
    data: { code, error: "x", ids },
  });
}

beforeEach(() => {
  mockMutate.mockReset();
  mockUser = { role: "OPERATOR", permissions: ["soul.read", "soul.delete"] };
});

it("the checkbox is its own control, outside the row link, and shows 已选 N", () => {
  renderPage();
  expect(bar()).toBeNull();
  const b = box("沈青梧");
  // Not inside the link whose ::after covers the row, so it never navigates.
  expect(b.closest("a")).toBeNull();
  const row = b.closest("tr") as HTMLElement;
  expect(within(row).getByRole("link", { name: "沈青梧" })).toBeInTheDocument();
  // An ordinary tab stop; lifted above the overlay.
  expect(b.tabIndex).toBe(0);
  expect(b.closest("label")?.className).toContain("z-[1]");

  fireEvent.click(b);
  expect(within(bar() as HTMLElement).getByText("souls.batch.selected:1")).toBeInTheDocument();
  fireEvent.click(box("周慕云"));
  expect(within(bar() as HTMLElement).getByText("souls.batch.selected:2")).toBeInTheDocument();
});

it("移入回收站 confirms in the recycle-bin wording, then sends the selected ids", () => {
  renderPage();
  fireEvent.click(box("沈青梧"));
  fireEvent.click(box("周慕云"));
  fireEvent.click(within(bar() as HTMLElement).getByRole("button", { name: "souls.detail.confirm_delete_action" }));
  expect(mockMutate).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("souls.batch.confirm_title:2")).toBeInTheDocument();
  expect(within(dialog).getByText("souls.detail.delete_confirm_message")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "souls.detail.confirm_delete_action" }));
  expect(mockMutate).toHaveBeenCalledWith({ ids: ["a1", "b2"] }, expect.anything());
});

it("a refused batch names the refused soul by name, deletes nothing and keeps the selection", () => {
  mockMutate.mockImplementation((_vars, opts) => opts.onError(refusal("not_deletable", ["b2"])));
  renderPage();
  fireEvent.click(box("沈青梧"));
  fireEvent.click(box("周慕云"));
  fireEvent.click(within(bar() as HTMLElement).getByRole("button", { name: "souls.detail.confirm_delete_action" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "souls.detail.confirm_delete_action" }));

  const alert = within(dialog).getByRole("alert");
  expect(within(alert).getByText("souls.batch.refused_title:1")).toBeInTheDocument();
  expect(within(alert).getByText("souls.batch.refused_reason.not_deletable")).toBeInTheDocument();
  const list = within(alert).getByRole("list", { name: "souls.batch.refused_list" });
  // Presence AND absence: the refused soul by name, the accepted one not listed, no raw id.
  expect(within(list).getByText("周慕云")).toBeInTheDocument();
  expect(within(list).queryByText("沈青梧")).toBeNull();
  expect(within(list).queryByText("b2")).toBeNull();
  // Nothing was recycled, so the selection is exactly what it was.
  expect(within(bar() as HTMLElement).getByText("souls.batch.selected:2")).toBeInTheDocument();
});

it("a page change empties the selection", () => {
  renderPage();
  fireEvent.click(box("沈青梧"));
  expect(bar()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /common\.next/ }));
  expect(screen.getByText("王素心")).toBeInTheDocument();
  expect(bar()).toBeNull();
  // Back on page 1 the old tick does not come back either.
  fireEvent.click(screen.getByRole("button", { name: /common\.prev/ }));
  expect(box("沈青梧")).not.toBeChecked();
});

it("a filter change empties the selection", () => {
  renderPage();
  fireEvent.click(box("沈青梧"));
  expect(bar()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "souls.date_problem_filter" }));
  expect(bar()).toBeNull();
});

it("取消选择 and Esc both clear it", () => {
  renderPage();
  fireEvent.click(box("沈青梧"));
  fireEvent.click(within(bar() as HTMLElement).getByRole("button", { name: /souls\.batch\.clear/ }));
  expect(bar()).toBeNull();
  fireEvent.click(box("周慕云"));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(bar()).toBeNull();
});

it("without soul.delete there is no selection column and no bar", () => {
  mockUser = { role: "OPERATOR", permissions: ["soul.read"] };
  renderPage();
  expect(screen.getByText("沈青梧")).toBeInTheDocument();
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(bar()).toBeNull();
});
