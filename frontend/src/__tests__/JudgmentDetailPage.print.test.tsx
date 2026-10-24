/**
 * 判词页的「打印」(第十五批 C1):只在已结案(有判词)时出现,点它调 `window.print()`;
 * 未结案的草稿不是文书,没有这个入口。页面带打印框(`data-print-doc`),别的打印规则见 printLayout.test.tsx。
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ID = "j-1";

/**
 * `React.use` shim — the same one, for the same reason, as
 * `dispatchApproveConfirms.test.tsx` (whose note now says why it outlived the
 * React 19 upgrade: the real `use` suspends a synchronous render). It unwraps the
 * one already-resolved params promise these tests hand in and proves nothing
 * about suspense. Read the note over there before widening it.
 */
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

import JudgmentDetailPage from "@/app/judgment/[id]/page";
import { judgmentApi, soulsApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { get: jest.fn(), conclude: jest.fn() },
  soulsApi: { get: jest.fn() },
}));

const mockI18n = {
  t: (key: string) => key,
  formatDate: (v: unknown) => String(v),
  formatDateTime: (v: unknown) => String(v),
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const mockTenant = {
  user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: [] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

const mockGet = judgmentApi.get as jest.Mock;
const mockSoulGet = soulsApi.get as jest.Mock;

function judgment(final: boolean) {
  const notes = "n";
  const confession = "";
  return {
    id: ID,
    soul: "s-1",
    soul_name: "李四",
    civilization: "CHINESE",
    judge: "u-1",
    judge_name: "Yama",
    court: "第一殿",
    evidence_json: {},
    confession,
    verdict: "PASSED",
    notes,
    citations: [],
    is_final: final,
    created_at: "2026-09-12T00:00:00Z",
    concluded_at: final ? "2026-09-12T01:00:00Z" : null,
  };
}

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JudgmentDetailPage params={Promise.resolve({ id: ID })} />
    </QueryClientProvider>
  );
}


beforeEach(() => {
  jest.clearAllMocks();
  mockSoulGet.mockResolvedValue({ data: { id: "s-1", name: "李四" } });
  window.print = jest.fn();
});

it("offers 打印 on a concluded judgment and calls window.print", async () => {
  mockGet.mockResolvedValue({ data: judgment(true) });
  const { container } = renderPage();
  const button = await screen.findByRole("button", { name: "print.button" }, { timeout: 5000 });
  expect(container.querySelector("[data-print-doc]")).not.toBeNull();
  button.click();
  expect(window.print).toHaveBeenCalledTimes(1);
});

it("offers nothing to print on an open judgment", async () => {
  mockGet.mockResolvedValue({ data: judgment(false) });
  renderPage();
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  await screen.findByLabelText("judgment.detail.notes", {}, { timeout: 5000 });
  expect(screen.queryByRole("button", { name: "print.button" })).toBeNull();
});

// 身份带下的元信息(第五十一批 F-3):候审期间多一行「枉死 · 候至 · 在枉死城」,到期后只剩「枉死」;
// 不是枉死的审判没有这一行。放在这里是因为这份文件已经把审判台整页立起来了。
describe("枉死 in the identity band", () => {
  it("held: 枉死 · 候至 · 在枉死城", async () => {
    mockGet.mockResolvedValue({ data: { ...judgment(false), untimely: true, held_until: "2999-11-03" } });
    renderPage();
    const line = await screen.findByTestId("desk-untimely", {}, { timeout: 5000 });
    expect(line).toHaveTextContent("judgment.untimely · judgment.held_until · judgment.in_city");
  });

  it("past the date: only 枉死", async () => {
    mockGet.mockResolvedValue({ data: { ...judgment(false), untimely: true, held_until: "2000-01-01" } });
    renderPage();
    const line = await screen.findByTestId("desk-untimely", {}, { timeout: 5000 });
    expect(line).toHaveTextContent(/^judgment\.untimely$/);
  });

  it("not untimely: no line", async () => {
    mockGet.mockResolvedValue({ data: judgment(false) });
    renderPage();
    await screen.findByLabelText("judgment.detail.notes", {}, { timeout: 5000 });
    expect(screen.queryByTestId("desk-untimely")).toBeNull();
  });
});
