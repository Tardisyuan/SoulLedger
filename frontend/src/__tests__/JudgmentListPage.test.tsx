/**
 * /judgment 审判队列(规范 v1 第三类 A·02)。
 *
 * - 分段切换带两边的真实计数(各取自一次 `has_verdict` 查询的 count);Q 进入队列,打字时不接;
 * - 「待审」按谁在处理分四组,组头的数来自 `queue-counts/` —— 不是本页行数;
 * - 28 px 紧凑行、整行链到审判台;认领标是圆形头像,未认领的行给「认领」;
 * - J / K 移焦点,X 勾选,C 认领焦点行;打字时一概不接;
 * - 勾选后出批量条:认领 / 改派… / 暂缓;暂缓理由必填,改派只列同租户的官员;
 * - 搜索与殿筛选同时进列表与计数的请求;殿的选项来自 `courts/`,不是已加载的行。
 *
 * 每条都断了反面:没勾选时没有批量条、理由空时不发请求、改派名单不再读 `/users/`。
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JudgmentListPage from "@/app/judgment/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { list: jest.fn(), queueCounts: jest.fn(), courts: jest.fn(), claim: jest.fn(), batch: jest.fn(), assignableOfficers: jest.fn(), requestReassign: jest.fn() },
  usersApi: { list: jest.fn() },
  PAGE_SIZE: 20,
}));
const { judgmentApi, usersApi } = jest.requireMock("@soulledger/core/api") as Record<string, Record<string, jest.Mock>>;

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, formatDate: (v: unknown) => String(v), formatDateTime: (v: unknown) => String(v), locale: "zh-Hans", hydrated: true }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
let mockUser: { id: number; username: string; role: string; permissions: string[]; tenant: { code: string } | null };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const row = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, soul: `s-${id}`, soul_name: name, civilization: "CHINESE", judge: null, judge_name: "阎罗王",
  court: "第五殿", evidence_json: {}, confession: "", verdict: null, notes: "", citations: [], is_final: false,
  created_at: new Date(Date.now() - 7.5 * 86_400_000).toISOString(), concluded_at: null,
  claimed_by: null, claimed_by_name: null, deferred_at: null, defer_reason: "", karmic_balance: 347, evidence_count: 12,
  ...over,
});

const GROUP_ROWS: Record<string, ReturnType<typeof row>[]> = {
  mine: [row("a", "沈青梧", { claimed_by: 1, claimed_by_name: "阎罗" })],
  unclaimed: [row("b", "Marguerite Vey", { civilization: "EUROPEAN", court: "米诺斯", karmic_balance: null, evidence_count: 7 })],
  others: [row("c", "陆晚晴", { claimed_by: 2, claimed_by_name: "秦广" })],
  deferred: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 1, username: "yama", role: "JUDGE", permissions: ["judgment.read", "judgment.execute"], tenant: { code: "diyu" } };
  judgmentApi.list.mockImplementation(async (params: Record<string, string>) => {
    if (params.group) {
      const results = GROUP_ROWS[params.group];
      return { data: { count: results.length, next: null, previous: null, results } };
    }
    return {
      data: params.has_verdict === "false"
        ? { count: 12, next: null, previous: null, results: [] }
        : { count: 148, next: null, previous: null, results: [] },
    };
  });
  // 计数故意与行数不同:组头必须读服务端的数。
  judgmentApi.queueCounts.mockResolvedValue({ data: { mine: 2, unclaimed: 5, others: 4, deferred: 1, total: 12 } });
  // 名单故意与行不同:第九殿没有任何一行,米诺斯有行却不在名单里。
  judgmentApi.courts.mockResolvedValue({ data: [{ court: "第五殿", pending: 9 }, { court: "第九殿", pending: 0 }] });
  judgmentApi.claim.mockResolvedValue({ data: {} });
  judgmentApi.batch.mockResolvedValue({ data: { operation: "claim", count: 1, ids: [] } });
  // 名单已由服务端按案子的租户、按改派同一条规则筛好;页面照单全列。
  judgmentApi.assignableOfficers.mockResolvedValue({
    data: [
      { id: 7, display_name: "秦广王", username: "qinguang", role: "JUDGE", in_hand: 2 },
      { id: 9, display_name: "", username: "songdi", role: "MODERATOR", in_hand: 0 },
    ],
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JudgmentListPage />
    </QueryClientProvider>
  );
}

const rowOf = (name: string) => screen.getByRole("link", { name }).closest("tr") as HTMLElement;

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

  it("四组各一次 group 查询,组头的数是 queue-counts 的,不是本页行数", async () => {
    renderPage();
    await screen.findByText("沈青梧");
    for (const group of ["mine", "unclaimed", "others", "deferred"]) {
      expect(judgmentApi.list).toHaveBeenCalledWith({ group, page: "1", ordering: "created_at" });
    }
    await waitFor(() => expect(screen.getByTestId("group-count-unclaimed")).toHaveTextContent("5"));
    expect(screen.getByTestId("group-count-mine")).toHaveTextContent("2");
    expect(screen.getByTestId("group-count-others")).toHaveTextContent("4");
    expect(screen.getByTestId("group-count-deferred")).toHaveTextContent("1");
    expect(within(screen.getByTestId("queue-group-deferred")).getByText(tZh("judgment.claim.group_empty"))).toBeInTheDocument();
  });

  it("行是 28 px、整行链到审判台;余额与证据两列;认领标是圆形,只有未认领的行给「认领」", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: "沈青梧" });
    expect(link).toHaveAttribute("href", "/judgment/a");
    const mine = rowOf("沈青梧");
    expect(mine.className).toContain("h-7");
    expect(within(mine).getByText("+347")).toBeInTheDocument();
    expect(within(mine).getByText("12")).toBeInTheDocument();
    expect(within(mine).getByText(tZh("judgment.waiting_days", { n: "7" }))).toBeInTheDocument();
    const avatar = within(mine).getByRole("img", { name: tZh("judgment.claim.claimed_by_me") });
    expect(avatar.className).toContain("rounded-full");
    expect(within(mine).queryByRole("button", { name: tZh("judgment.claim.claim") })).toBeNull();

    const others = rowOf("陆晚晴");
    expect(within(others).getByRole("img", { name: tZh("judgment.claim.claimed_by", { name: "秦广" }) })).toHaveTextContent("秦");

    const unclaimed = rowOf("Marguerite Vey");
    expect(within(unclaimed).queryByRole("img")).toBeNull();
    // 非功过格的余额是「不适用」,不是 0。
    expect(within(unclaimed).queryByText("0")).toBeNull();
    fireEvent.click(within(unclaimed).getByRole("button", { name: tZh("judgment.claim.claim") }));
    await waitFor(() => expect(judgmentApi.claim).toHaveBeenCalledWith("b"));
  });

  it("J 移到第一行、再 J 到下一行;C 认领焦点行;打字时 J / C 都不接", async () => {
    renderPage();
    await screen.findByText("Marguerite Vey");
    const search = screen.getByPlaceholderText(tZh("judgment.claim.search"));
    search.focus();
    fireEvent.keyDown(search, { key: "j" });
    fireEvent.keyDown(search, { key: "c" });
    expect(document.activeElement).toBe(search);
    expect(judgmentApi.claim).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "j" });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "沈青梧" }));
    fireEvent.keyDown(document.body, { key: "j" });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Marguerite Vey" }));
    expect(rowOf("Marguerite Vey")).toHaveAttribute("data-focused", "true");

    fireEvent.keyDown(document.body, { key: "c" });
    await waitFor(() => expect(judgmentApi.claim).toHaveBeenCalledWith("b"));
    expect(judgmentApi.claim).toHaveBeenCalledTimes(1);
  });

  it("没有勾选时没有批量条;X 勾选焦点行后出现,批量认领带勾选的 id", async () => {
    renderPage();
    await screen.findByText("Marguerite Vey");
    expect(screen.queryByTestId("batch-bar")).toBeNull();

    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "x" });
    const bar = await screen.findByTestId("batch-bar");
    expect(within(bar).getByText(tZh("judgment.claim.selected", { n: "1" }))).toBeInTheDocument();
    // JUDGE 没有 judgment.assign:没有「改派…」。
    expect(within(bar).queryByRole("button", { name: tZh("judgment.claim.reassign") })).toBeNull();

    fireEvent.click(within(rowOf("陆晚晴")).getByRole("checkbox"));
    fireEvent.click(within(bar).getByRole("button", { name: tZh("judgment.claim.claim") }));
    await waitFor(() => expect(judgmentApi.batch).toHaveBeenCalledWith({ operation: "claim", ids: ["a", "c"] }));
    await waitFor(() => expect(screen.queryByTestId("batch-bar")).toBeNull());
  });

  it("批量被拒时按拒绝码说是什么,不回显服务端英文", async () => {
    judgmentApi.batch.mockRejectedValue({ response: { status: 409, data: { error: "This judgment is already claimed", code: "already_claimed", id: "c" } } });
    renderPage();
    await screen.findByText("陆晚晴");
    fireEvent.click(within(rowOf("陆晚晴")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByTestId("batch-bar")).getByRole("button", { name: tZh("judgment.claim.claim") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("judgment.claim.refused.already_claimed"), "error"));
  });

  it("暂缓要理由:空理由不发请求,写了才带着理由发", async () => {
    renderPage();
    await screen.findByText("沈青梧");
    fireEvent.click(within(rowOf("沈青梧")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByTestId("batch-bar")).getByRole("button", { name: tZh("judgment.claim.defer") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.claim.defer") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(tZh("judgment.claim.reason_required"));
    expect(judgmentApi.batch).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  待补证  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.claim.defer") }));
    await waitFor(() => expect(judgmentApi.batch).toHaveBeenCalledWith({ operation: "defer", ids: ["a"], reason: "待补证" }));
  });

  it("殿主(MODERATOR,没有用户管理权)打开改派,看得到名单,且名单按勾选的案子取,不读 /users/", async () => {
    mockUser = { ...mockUser, role: "MODERATOR", permissions: ["judgment.read", "judgment.execute", "judgment.assign"] };
    renderPage();
    await screen.findByText("沈青梧");
    fireEvent.click(within(rowOf("沈青梧")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByTestId("batch-bar")).getByRole("button", { name: tZh("judgment.claim.reassign") }));
    const dialog = await screen.findByRole("dialog");
    const group = await within(dialog).findByRole("radiogroup");
    await waitFor(() => expect(within(group).getByRole("radio", { name: /秦广王/ })).toBeInTheDocument());
    // 没有 display_name 的人退回 username。
    expect(within(group).getByRole("radio", { name: /songdi/ })).toBeInTheDocument();
    expect(within(group).queryByRole("radio", { name: /qinguang/ })).toBeNull();
    expect(judgmentApi.assignableOfficers).toHaveBeenCalledWith(["a"]);
    expect(usersApi.list).not.toHaveBeenCalled();
    // 在手件数读 in_hand;表头是可改派的人数。
    expect(within(dialog).getByText(tZh("judgment.claim.reassign_count", { n: "2" }))).toBeInTheDocument();
    const qin = dialog.querySelector('[data-officer="7"]') as HTMLElement;
    expect(qin).toHaveTextContent(tZh("judgment.claim.in_hand_n", { n: "2" }));
    // 搜索只留匹配的人。
    fireEvent.change(within(dialog).getByRole("searchbox", { name: tZh("judgment.claim.reassign_search") }), { target: { value: "秦" } });
    expect(within(group).queryByRole("radio", { name: /songdi/ })).toBeNull();

    fireEvent.click(within(group).getByRole("radio", { name: /秦广王/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.claim.reassign_confirm") }));
    await waitFor(() => expect(judgmentApi.batch).toHaveBeenCalledWith({ operation: "reassign", ids: ["a"], to: 7 }));
  });

  it("连可改派名单也被拒(403)时照实说,不给一个空下拉", async () => {
    mockUser = { ...mockUser, role: "MODERATOR", permissions: ["judgment.read", "judgment.execute", "judgment.assign"] };
    judgmentApi.assignableOfficers.mockRejectedValue({ response: { status: 403 } });
    renderPage();
    await screen.findByText("沈青梧");
    fireEvent.click(within(rowOf("沈青梧")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByTestId("batch-bar")).getByRole("button", { name: tZh("judgment.claim.reassign") }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(tZh("judgment.claim.officers_unavailable"));
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
  });

  it("自己也列出但置灰、写「你」、件数「—」、不可选", async () => {
    mockUser = { ...mockUser, id: 9, role: "MODERATOR", permissions: ["judgment.read", "judgment.execute", "judgment.assign"] };
    renderPage();
    await screen.findByText("沈青梧");
    fireEvent.click(within(rowOf("沈青梧")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByTestId("batch-bar")).getByRole("button", { name: tZh("judgment.claim.reassign") }));
    const dialog = await screen.findByRole("dialog");
    const me = await within(dialog).findByRole("radio", { name: /songdi/ });
    expect(me).toBeDisabled();
    const row = dialog.querySelector('[data-officer="9"]') as HTMLElement;
    expect(row).toHaveTextContent(tZh("judgment.claim.reassign_you"));
    expect(row).toHaveTextContent("—");
    expect(within(dialog).getByText(tZh("judgment.claim.reassign_count", { n: "1" }))).toBeInTheDocument();
  });

  it("除自己之外没有人:虚线框的空状态,改派按钮不可按", async () => {
    mockUser = { ...mockUser, id: 9, role: "MODERATOR", permissions: ["judgment.read", "judgment.execute", "judgment.assign"] };
    judgmentApi.assignableOfficers.mockResolvedValue({ data: [{ id: 9, display_name: "", username: "songdi", role: "MODERATOR", in_hand: 0 }] });
    renderPage();
    await screen.findByText("沈青梧");
    fireEvent.click(within(rowOf("沈青梧")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByTestId("batch-bar")).getByRole("button", { name: tZh("judgment.claim.reassign") }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByTestId("reassign-empty")).toHaveTextContent(tZh("judgment.claim.reassign_empty_title"));
    expect(within(dialog).getByRole("button", { name: tZh("judgment.claim.reassign_confirm") })).toBeDisabled();
  });

  describe("空状态的「请管理员改派」", () => {
    async function openEmpty() {
      mockUser = { ...mockUser, id: 9, role: "MODERATOR", permissions: ["judgment.read", "judgment.execute", "judgment.assign"] };
      judgmentApi.assignableOfficers.mockResolvedValue({ data: [{ id: 9, display_name: "", username: "songdi", role: "MODERATOR", in_hand: 0 }] });
      renderPage();
      await screen.findByText("沈青梧");
      fireEvent.click(within(rowOf("沈青梧")).getByRole("checkbox"));
      fireEvent.click(within(rowOf("陆晚晴")).getByRole("checkbox"));
      fireEvent.click(within(screen.getByTestId("batch-bar")).getByRole("button", { name: tZh("judgment.claim.reassign") }));
      const dialog = await screen.findByRole("dialog");
      const empty = await within(dialog).findByTestId("reassign-empty");
      fireEvent.click(within(empty).getByRole("button", { name: tZh("judgment.claim.request_admin") }));
      return empty;
    }
    const refused = (status: number, retry_after?: number) =>
      Promise.reject({ response: { status, data: retry_after === undefined ? {} : { retry_after } } });

    it("每件案子请一次,发出后说「已请」,按钮收起", async () => {
      judgmentApi.requestReassign.mockResolvedValue({ data: { notified: 1 } });
      const empty = await openEmpty();
      expect(await within(empty).findByRole("status")).toHaveTextContent(tZh("judgment.claim.request_admin_sent"));
      expect(judgmentApi.requestReassign.mock.calls.map(([id]) => id).sort()).toEqual(["a", "c"]);
      expect(within(empty).queryByRole("button", { name: tZh("judgment.claim.request_admin") })).toBeNull();
    });

    it("全部被限流:说还要等几分钟(取最长的那件),不说「已请」", async () => {
      judgmentApi.requestReassign.mockImplementation((id: string) => refused(429, id === "a" ? 30 : 250));
      const empty = await openEmpty();
      expect(await within(empty).findByRole("status")).toHaveTextContent(
        tZh("judgment.claim.request_admin_limited", { minutes: "5" })
      );
      expect(within(empty).queryByText(tZh("judgment.claim.request_admin_sent"))).toBeNull();
    });

    it("有一件不是限流的失败:报错,按钮留着可重试", async () => {
      judgmentApi.requestReassign.mockImplementation((id: string) => (id === "a" ? refused(500) : Promise.resolve({ data: { notified: 1 } })));
      const empty = await openEmpty();
      expect(await within(empty).findByRole("alert")).toHaveTextContent(tZh("judgment.claim.request_admin_failed"));
      expect(within(empty).getByRole("button", { name: tZh("judgment.claim.request_admin") })).toBeInTheDocument();
    });
  });

  it("搜索(去抖后)与殿筛选同时进列表与计数的请求", async () => {
    jest.useFakeTimers();
    try {
      renderPage();
      await act(async () => {
        await jest.runOnlyPendingTimersAsync();
      });
      fireEvent.change(screen.getByPlaceholderText(tZh("judgment.claim.search")), { target: { value: "沈" } });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(400);
      });
      await waitFor(() => expect(judgmentApi.queueCounts).toHaveBeenCalledWith({ search: "沈" }));
      expect(judgmentApi.list).toHaveBeenCalledWith({ search: "沈", group: "unclaimed", page: "1", ordering: "created_at" });

      fireEvent.change(screen.getByRole("combobox", { name: tZh("judgment.court") }), { target: { value: "第五殿" } });
      await waitFor(() => expect(judgmentApi.queueCounts).toHaveBeenCalledWith({ search: "沈", court: "第五殿" }));
      expect(judgmentApi.list).toHaveBeenCalledWith({ search: "沈", court: "第五殿", group: "mine", page: "1", ordering: "created_at" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("殿的选项是 courts/ 的全部殿(带未结案数),不是已加载行里出现过的殿", async () => {
    renderPage();
    await screen.findByText("Marguerite Vey");
    const select = screen.getByRole("combobox", { name: tZh("judgment.court") });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    const labels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual([tZh("judgment.claim.court_all"), "第五殿 · 9", "第九殿 · 0"]);
    // 反面:只在行里出现的米诺斯不是选项。
    expect(within(select).queryByRole("option", { name: /米诺斯/ })).toBeNull();
    fireEvent.change(select, { target: { value: "第九殿" } });
    await waitFor(() => expect(judgmentApi.queueCounts).toHaveBeenCalledWith({ court: "第九殿" }));
  });

  it("文明:ADMIN 列全部四个文明,其余角色只列自己租户的;选中后进列表与计数", async () => {
    mockUser = { ...mockUser, role: "ADMIN", tenant: null };
    const { unmount } = renderPage();
    await screen.findByText("Marguerite Vey");
    const adminSelect = screen.getByRole("combobox", { name: tZh("judgment.civilization") });
    expect(within(adminSelect).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual([
      "", "CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK",
    ]);
    unmount();

    mockUser = { ...mockUser, role: "JUDGE", tenant: { code: "EG_DUAT" } };
    renderPage();
    await screen.findByText("Marguerite Vey");
    const select = screen.getByRole("combobox", { name: tZh("judgment.civilization") });
    const values = within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["", "EGYPTIAN"]);
    expect(values).not.toContain("CHINESE");
    fireEvent.change(select, { target: { value: "EGYPTIAN" } });
    await waitFor(() => expect(judgmentApi.queueCounts).toHaveBeenCalledWith({ civilization: "EGYPTIAN" }));
    expect(judgmentApi.list).toHaveBeenCalledWith({ civilization: "EGYPTIAN", group: "mine", page: "1", ordering: "created_at" });
  });

  it("排序:默认等待最久(ordering=created_at),可切成最近入队;计数不带排序", async () => {
    renderPage();
    await screen.findByText("Marguerite Vey");
    expect(screen.getByText(tZh("judgment.claim.hints.unclaimed"))).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: tZh("judgment.claim.sort") });
    fireEvent.change(select, { target: { value: "-created_at" } });
    await waitFor(() =>
      expect(judgmentApi.list).toHaveBeenCalledWith({ group: "unclaimed", page: "1", ordering: "-created_at" })
    );
    expect(judgmentApi.queueCounts).not.toHaveBeenCalledWith(expect.objectContaining({ ordering: expect.anything() }));
    // 「等待最久在上」不再为真,就不再说。
    expect(screen.queryByText(tZh("judgment.claim.hints.unclaimed"))).toBeNull();
  });

  it("没有 judgment.execute 的人看不到勾选列,也没有「认领」", async () => {
    mockUser = { ...mockUser, permissions: ["judgment.read"] };
    renderPage();
    await screen.findByText("Marguerite Vey");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: tZh("judgment.claim.claim") })).toBeNull();
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "c" });
    expect(judgmentApi.claim).not.toHaveBeenCalled();
  });
});
