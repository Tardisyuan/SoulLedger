/**
 * /judgment 审判队列(规范 v1 第三类 A·02)。
 *
 * - 分段切换带两边的真实计数(各取自一次 `has_verdict` 查询的 count);
 * - Q 进入队列,打字时不接;
 * - 紧凑行(28 px 那一档)、整行点进审判台;
 * - 后端没有认领 / 批量接口:不画勾选列,不画认领列 —— 断的是「不在」。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JudgmentListPage from "@/app/judgment/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { list: jest.fn() },
  PAGE_SIZE: 20,
}));
const { judgmentApi } = jest.requireMock("@soulledger/core/api") as Record<string, Record<string, jest.Mock>>;

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, formatDate: (v: unknown) => String(v), formatDateTime: (v: unknown) => String(v), locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "yama", role: "ADMIN", permissions: [], tenant: null } }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const row = (id: string, name: string) => ({
  id, soul: `s-${id}`, soul_name: name, civilization: "CHINESE", judge: null, judge_name: "阎罗王",
  court: "第五殿", evidence_json: {}, confession: "", verdict: null, notes: "", citations: [], is_final: false,
  created_at: new Date(Date.now() - 7.5 * 86_400_000).toISOString(), concluded_at: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  judgmentApi.list.mockImplementation(async (params: Record<string, string>) => ({
    data: params.has_verdict === "false"
      ? { count: 12, next: null, previous: null, results: [row("a", "沈青梧")] }
      : { count: 148, next: null, previous: null, results: [] },
  }));
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JudgmentListPage />
    </QueryClientProvider>
  );
}

describe("审判队列", () => {
  it("分段切换两边都带计数,当前一段 aria-pressed", async () => {
    renderPage();
    await screen.findByText("沈青梧");
    const pending = screen.getByRole("button", { name: /待审/ });
    const concluded = screen.getByRole("button", { name: /已结案/ });
    expect(pending).toHaveAttribute("aria-pressed", "true");
    expect(concluded).toHaveAttribute("aria-pressed", "false");
    expect(await within(pending).findByText("12")).toBeInTheDocument();
    expect(await within(concluded).findByText("148")).toBeInTheDocument();
  });

  it("Q 进入队列;焦点在输入框里时不接", async () => {
    renderPage();
    await screen.findByText("沈青梧");
    const field = document.createElement("input");
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: "q" });
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "q" });
    expect(mockPush).toHaveBeenCalledWith("/judgment/queue");
    field.remove();
  });

  it("行是紧凑档、整行链到审判台,等待天数由 created_at 算出;没有勾选列、没有认领列", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: "沈青梧" });
    expect(link).toHaveAttribute("href", "/judgment/a");
    const table = screen.getByRole("table");
    expect(table.className).toContain("[&_tbody_td]:py-1");
    expect(within(table).getByText(tZh("judgment.waiting_days", { n: "7" }))).toBeInTheDocument();
    expect(within(table).queryByRole("checkbox")).toBeNull();
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
  });
});
