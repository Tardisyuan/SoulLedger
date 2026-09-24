/**
 * 审判台(/judgment/[id],规范 v1 第三类 A·01)新接的几条线:裁决键 1–4、⌘⏎ 落判、
 * 引用签的撤回、律条检索的引用、卷栏的功过与前世、队列进度条。
 *
 * 真页面、真 QueryClient,只桩 HTTP 层。每条行为都断了反面:打字时按 2 不改裁决、
 * 没有 judgment.execute 时 ⌘⏎ 不落判、案子不在队列头时不画进度条。
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tZh } from "./support/zhBundle";

const ID = "j-1";

// `React.use` shim — same one, same reason, as JudgmentDetailPage.notesDraft.test.tsx.
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

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: {
    get: jest.fn(),
    conclude: jest.fn(),
    next: jest.fn(),
    statutes: jest.fn(),
    cite: jest.fn(),
    uncite: jest.fn(),
  },
  soulsApi: { get: jest.fn(), karma: jest.fn() },
  reincarnationApi: { list: jest.fn() },
}));
const { judgmentApi, soulsApi, reincarnationApi } = jest.requireMock("@soulledger/core/api") as Record<
  string,
  Record<string, jest.Mock>
>;

const mockI18n = {
  t: tZh,
  formatDate: (v: unknown) => String(v),
  formatDateTime: (v: unknown) => String(v),
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

let mockUser: { id: number; username: string; role: string; permissions: string[]; tenant: { code: string } };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const statute = (id: string, code: string) => ({
  id, code, civilization: "CHINESE", corpus: "GONGGUOGE", ordinal: 1, polarity: "OFFENCE",
  title_zh: "", title_en: "", title_egy: "", text_zh: "", text_en: "", text_egy: "",
  display_title: `标题 ${code}`, display_text: `条文 ${code}`, is_derived: false, source: "", source_notes: [],
  payload_json: {},
});
const CITED = statute("st-1", "口業 · 三");

const judgment = (over: Record<string, unknown> = {}) => ({
  id: ID, soul: "s-1", soul_name: "沈青梧", civilization: "CHINESE", judge: null, judge_name: null,
  court: "第五殿", evidence_json: {}, confession: "", verdict: null, notes: "", is_final: false,
  citations: [{ id: "c-1", statute: CITED, note: "", created_at: "2026-09-12T00:00:00Z" }],
  created_at: "2026-09-12T00:00:00Z", concluded_at: null, kind: "ORIGINAL", amends_plan_id: null, ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JudgmentDetailPage params={Promise.resolve({ id: ID })} />
    </QueryClientProvider>
  );
}

const radio = (value: string) =>
  screen.getAllByRole("radio").find((r) => (r as HTMLInputElement).value === value) as HTMLInputElement;
const notesBox = () => screen.getByLabelText(tZh("judgment.detail.notes")) as HTMLTextAreaElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 2, username: "op", role: "JUDGE", permissions: ["judgment.read", "judgment.execute"], tenant: { code: "CN_DIYU" } };
  judgmentApi.get.mockResolvedValue({ data: judgment() });
  judgmentApi.conclude.mockResolvedValue({ data: judgment({ is_final: true, verdict: "PURGATORY" }) });
  judgmentApi.next.mockResolvedValue({
    data: { total: 12, remaining: 12, skipped: 0, position: 3, judgment: { id: ID }, soul: null, ledger: null, prior_cycles: [], realm_options: [] },
  });
  judgmentApi.statutes.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [statute("st-7", "口業 · 七")] } });
  judgmentApi.cite.mockResolvedValue({ data: {} });
  judgmentApi.uncite.mockResolvedValue({ data: {} });
  soulsApi.get.mockResolvedValue({ data: { id: "s-1", name: "沈青梧", tenant_code: "CN_DIYU" } });
  soulsApi.karma.mockResolvedValue({
    data: {
      soul_id: "s-1", soul_name: "沈青梧", merit_score: 1284, demerit_score: 937, karmic_balance: 347,
      record_count: 0, records: [], reading: { kind: "BALANCE", civilization: "CHINESE", merit: 1284, demerit: 937, balance: 347 },
    },
  });
  reincarnationApi.list.mockResolvedValue({
    data: { count: 1, next: null, previous: null, results: [{
      id: "r-1", soul: "s-1", disposition: null, target_realm: "", rebirth_form: "HUMAN", cycle_count: 1,
      previous_realm: "", new_identity: "陆氏", notes: "", reincarnated_at: "1931-01-01T00:00:00Z",
    }] },
  });
});

describe("裁决键 1–4 与 ⌘⏎", () => {
  it("1–4 选定裁决;在判词框里按数字是在写字,不改裁决", async () => {
    renderPage();
    await screen.findAllByRole("radio");

    fireEvent.keyDown(document.body, { key: "3" });
    expect(radio("PURGATORY").checked).toBe(true);

    fireEvent.keyDown(notesBox(), { key: "2" });
    expect(radio("FAILED").checked).toBe(false);
    expect(radio("PURGATORY").checked).toBe(true);

    fireEvent.keyDown(document.body, { key: "1" });
    expect(radio("PASSED").checked).toBe(true);
  });

  it("⌘⏎ 落判,带上判词与所选裁决 —— 在判词框里也接", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "3" });
    fireEvent.change(notesBox(), { target: { value: "功过相抵,暂入救济门" } });
    fireEvent.keyDown(notesBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(1));
    expect(judgmentApi.conclude.mock.calls[0]).toEqual([
      ID,
      { verdict: "PURGATORY", notes: "功过相抵,暂入救济门", create_workflow: false },
    ]);
  });

  it("⌘⏎ 与落判按钮同一道门:未选裁决、或没有 judgment.execute,都不落判", async () => {
    const a = renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    a.unmount();

    mockUser = { ...mockUser, permissions: ["judgment.read"] };
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    // 按钮本身也不在(RequirePermission),键不能是一条绕过它的路。
    expect(screen.queryByRole("button", { name: tZh("judgment.detail.conclude") })).toBeNull();
    await act(async () => {});
    expect(judgmentApi.conclude).not.toHaveBeenCalled();
  });

  it("已结案:键不再改任何东西", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ is_final: true, verdict: "PASSED" }) });
    renderPage();
    await screen.findByText(tZh("judgment.detail.final"));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    await act(async () => {});
    expect(judgmentApi.conclude).not.toHaveBeenCalled();
  });
});

describe("引用签与律条检索", () => {
  it("引用签的 × 撤回那一条", async () => {
    renderPage();
    const chips = await screen.findByRole("list", { name: tZh("judgment.grounds.title") });
    fireEvent.click(within(chips).getByRole("button", { name: tZh("judgment.desk.uncite", { code: "口業 · 三" }) }));
    await waitFor(() => expect(judgmentApi.uncite).toHaveBeenCalledWith(ID, "st-1"));
  });

  it("检索按本文明发请求,引用未引过的一条", async () => {
    renderPage();
    const box = await screen.findByPlaceholderText(tZh("judgment.desk.statute_search"));
    expect(judgmentApi.statutes).not.toHaveBeenCalled(); // 空查询不发请求
    fireEvent.change(box, { target: { value: "口业" } });
    await screen.findByText("条文 口業 · 七");
    expect(judgmentApi.statutes).toHaveBeenCalledWith({ search: "口业", civilization: "CHINESE" });
    fireEvent.click(screen.getByRole("button", { name: tZh("judgment.desk.cite") }));
    await waitFor(() => expect(judgmentApi.cite).toHaveBeenCalledWith(ID, "st-7"));
  });

  it("没有 judgment.execute:看得到引用签,但没有撤回键,检索结果也没有引用键", async () => {
    mockUser = { ...mockUser, permissions: ["judgment.read"] };
    renderPage();
    const chips = await screen.findByRole("list", { name: tZh("judgment.grounds.title") });
    expect(within(chips).getByText("口業 · 三")).toBeInTheDocument();
    expect(within(chips).queryByRole("button")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(tZh("judgment.desk.statute_search")), { target: { value: "口业" } });
    await screen.findByText("条文 口業 · 七");
    expect(screen.queryByRole("button", { name: tZh("judgment.desk.cite") })).toBeNull();
  });
});

describe("卷栏与队列进度条", () => {
  it("功过按 reading 画(收 / 支 / 结),前世列出来,进度条给出本案在队列里的位置", async () => {
    renderPage();
    expect(await screen.findByTestId("balance-ledger")).toBeInTheDocument();
    expect(await screen.findByText(/陆氏/)).toBeInTheDocument();
    const bar = await screen.findByTestId("queue-bar");
    expect(within(bar).getByText(tZh("judgment.queue.progress", { position: "3", total: "12" }))).toBeInTheDocument();
    expect(judgmentApi.next).toHaveBeenCalledWith({ at: ID });
  });

  it("队列头不是本案(`at` 只是偏好):不画进度条,不拿别人的位置冒充", async () => {
    judgmentApi.next.mockResolvedValue({
      data: { total: 12, remaining: 12, skipped: 0, position: 1, judgment: { id: "other" }, soul: null, ledger: null, prior_cycles: [], realm_options: [] },
    });
    renderPage();
    await screen.findAllByRole("radio");
    await waitFor(() => expect(judgmentApi.next).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId("queue-bar")).toBeNull();
  });
});
