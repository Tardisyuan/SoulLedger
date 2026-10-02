/**
 * /judgment 审判队列(规范 v1 第三类 A·02)。
 *
 * - 分段切换带两边的真实计数(各取自一次 `has_verdict` 查询的 count);Q 进入队列,打字时不接;
 * - 「待审」按谁在处理分四组,组头的数来自 `queue-counts/` —— 不是本页行数;
 * - v3 的 64 px 行(`--table-row-h`)、整行链到审判台;认领标是圆形头像,未认领的行给「认领」;
 * - 行尾「⋯」菜单按权限给认领 / 取消认领 / 延后 / 改派…;取消认领时色标反着退场(scaleY 1→0,140ms);
 * - ↑↓ 或 J / K 移焦点,X 勾选,C 认领 / 取消认领焦点行,S 延后到本次会话末,R 确认后全部放回;
 *   打字时一概不接;
 * - 工具条「全部案卷 / 我认领的」;草拟判决是字形 + 文字;
 * - 勾选后出批量条:认领 / 改派… / 暂缓;暂缓理由必填,改派只列同租户的官员;
 * - 搜索与殿筛选同时进列表与计数的请求;殿的选项来自 `courts/`,不是已加载的行。
 *
 * 每条都断了反面:没勾选时没有批量条、理由空时不发请求、改派名单不再读 `/users/`。
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JudgmentListPage from "@/app/judgment/page";
import { BATCH_BAR } from "@/components/ui/data-table";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { list: jest.fn(), queueCounts: jest.fn(), courts: jest.fn(), claim: jest.fn(), release: jest.fn(), batch: jest.fn(), assignableOfficers: jest.fn(), requestReassign: jest.fn() },
  usersApi: { list: jest.fn() },
  PAGE_SIZE: 20,
}));
const { judgmentApi, usersApi } = jest.requireMock("@soulledger/core/api") as Record<string, Record<string, jest.Mock>>;

const mockPush = jest.fn();
let mockSearch = "";
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }), useSearchParams: () => new URLSearchParams(mockSearch) }));
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
  merit_score: 1842, demerit_score: 391, cycle: 3, kind: "ORIGINAL", case_number: `CN-2026-00${id}`,
  ...over,
});

const GROUP_ROWS: Record<string, ReturnType<typeof row>[]> = {
  mine: [row("a", "沈青梧", { claimed_by: 1, claimed_by_name: "阎罗" })],
  unclaimed: [row("b", "Marguerite Vey", { civilization: "EUROPEAN", court: "米诺斯", karmic_balance: null, evidence_count: 7, merit_score: 641, demerit_score: 602, cycle: 0 })],
  others: [row("c", "陆晚晴", { claimed_by: 2, claimed_by_name: "秦广" })],
  deferred: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  mockSearch = "";
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

  it("行是 v3 的 64 px(--table-row-h)、整行链到审判台;功 / 过与证据两列;认领标是圆形,只有未认领的行给「认领」", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: "沈青梧" });
    // 来源写在链接上(v3:审判台的返回键回到来源队列,不靠浏览器历史)。
    expect(link).toHaveAttribute("href", "/judgment/a?from=%2Fjudgment");
    const mine = rowOf("沈青梧");
    expect(mine.className.split(/\s+/)).toContain("h-(--table-row-h)");
    // 只有这一个高度:旧的 h-10 与 393 下的 max-sm:h-11 补丁都不在了。
    expect(mine.className).not.toMatch(/\bh-(7|10|11|16)\b/);
    // v3「C 认领」:待我处理的色标挂上时 scaleY(0→1),160ms。
    expect(within(mine).getByTestId("row-mark").className.split(/\s+/)).toEqual(expect.arrayContaining(["starting:scale-y-0", "duration-fast"]));
    // 「功 / 过」分列:功在前加粗,过在后;不是净值。
    expect(within(mine).getByTestId("merit-demerit-cell")).toHaveTextContent(/^1842 \/ 391$/);
    expect(within(mine).getByText("1842")).toHaveClass("font-semibold");
    expect(within(mine).queryByText("+347")).toBeNull();
    expect(within(mine).getByText("12")).toBeInTheDocument();
    expect(within(mine).getByText(tZh("judgment.waiting_days", { n: "7" }))).toBeInTheDocument();
    const avatar = within(mine).getByRole("img", { name: tZh("judgment.claim.claimed_by_me") });
    expect(avatar.className).toContain("rounded-full");
    expect(within(mine).queryByRole("button", { name: tZh("judgment.claim.claim") })).toBeNull();

    const others = rowOf("陆晚晴");
    expect(within(others).getByRole("img", { name: tZh("judgment.claim.claimed_by", { name: "秦广" }) })).toHaveTextContent("秦");

    const unclaimed = rowOf("Marguerite Vey");
    expect(within(unclaimed).queryByRole("img")).toBeNull();
    // 功 / 过两本账四个文明都有:欧洲的案子也写数,不是「不适用」。
    expect(within(unclaimed).getByTestId("merit-demerit-cell")).toHaveTextContent(/^641 \/ 602$/);
    expect(within(unclaimed).getByTestId("merit-demerit-cell").querySelector("[data-missing]")).toBeNull();
    fireEvent.click(within(unclaimed).getByRole("button", { name: tZh("judgment.claim.claim") }));
    await waitFor(() => expect(judgmentApi.claim).toHaveBeenCalledWith("b"));
  });

  it("v3「案号 / 灵魂」:名字下一行是整串案号,可复制,压在整行链接之上", async () => {
    renderPage();
    await screen.findByRole("link", { name: "沈青梧" });
    const chip = within(rowOf("沈青梧")).getByRole("button", { name: tZh("common.value.copy_case_number", { value: "CN-2026-00a" }) });
    expect(chip).toHaveTextContent(/^CN-2026-00a ⧉$/);
    // 整行是一个 ::after 盖满的链接;不抬到它上面,点案号就是打开审判台。
    expect(chip.parentElement!.className.split(/\s+/)).toEqual(expect.arrayContaining(["relative", "z-10"]));
    // 列头跟着这一格写「案号 / 灵魂」(用户 2026-10-02),不再是只说一半的「灵魂名称」。
    expect(screen.getByRole("columnheader", { name: "案号 / 灵魂" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: tZh("judgment.soul_name") })).toBeNull();
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

  it("v3 焦点恢复:从审判台回到队列,焦点落回原案卷行;只恢复一次", async () => {
    const first = renderPage();
    fireEvent.click(await screen.findByRole("link", { name: "Marguerite Vey" }));
    first.unmount();

    const second = renderPage();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Marguerite Vey" })));
    expect(rowOf("Marguerite Vey")).toHaveAttribute("data-focused", "true");
    // 不是落在第一行(J 的默认落点)。
    expect(rowOf("沈青梧")).not.toHaveAttribute("data-focused");
    second.unmount();

    // 读一次就删:再进队列(不是从审判台回来)焦点不再被拽到那一行。
    renderPage();
    await screen.findByRole("link", { name: "Marguerite Vey" });
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
  });

  it("没有勾选时没有批量条;X 勾选焦点行后出现,批量认领带勾选的 id", async () => {
    renderPage();
    await screen.findByText("Marguerite Vey");
    expect(screen.queryByTestId("batch-bar")).toBeNull();

    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "x" });
    const bar = await screen.findByTestId("batch-bar");
    expect(within(bar).getByText(tZh("judgment.claim.selected", { n: "1" }))).toBeInTheDocument();
    // v3 (2026-10-01): the bar is inverted, and every button on it carries the surface-1 ring.
    expect(bar.className.split(/\s+/)).toEqual(expect.arrayContaining(BATCH_BAR.split(" ")));
    expect(bar.className).not.toContain("--color-surface-2");
    for (const b of within(bar).getAllByRole("button")) expect(b.className).toContain("focus-visible:outline-[oklch(var(--color-surface-1))]!");
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

  it("全局搜索「查看全部」带来的 ?q=:填进搜索框,并进待审四组、计数与已结案的请求", async () => {
    mockSearch = "q=CN-2026-0042";
    renderPage();
    expect(screen.getByPlaceholderText(tZh("judgment.claim.search"))).toHaveValue("CN-2026-0042");
    await waitFor(() => expect(judgmentApi.queueCounts).toHaveBeenCalledWith({ search: "CN-2026-0042" }));
    expect(judgmentApi.list).toHaveBeenCalledWith({ search: "CN-2026-0042", group: "unclaimed", page: "1", ordering: "created_at" });
    expect(judgmentApi.list).toHaveBeenCalledWith({ page: "1", has_verdict: "true", search: "CN-2026-0042" });
    // 反面:没有不带词的请求。
    expect(judgmentApi.queueCounts).not.toHaveBeenCalledWith({});
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

  describe("v3 审判队列", () => {
    it("页头:标题是「审判队列」,眉题「审判」;待审一面有快捷键条,已结案一面没有", async () => {
      renderPage();
      await screen.findByText("沈青梧");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(tZh("breadcrumb.menu.judgment"));
      const keys = screen.getByTestId("queue-shortcuts");
      for (const k of ["↑↓", "Enter", "C", "S", "R"]) expect(within(keys).getByText(k)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /已结案/ }));
      expect(screen.queryByTestId("queue-shortcuts")).toBeNull();
    });

    it("↓ / ↑ 移焦点,与 J / K 同一条路", async () => {
      renderPage();
      await screen.findByText("陆晚晴");
      fireEvent.keyDown(document.body, { key: "ArrowDown" });
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "沈青梧" }));
      fireEvent.keyDown(document.body, { key: "ArrowDown" });
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "Marguerite Vey" }));
      fireEvent.keyDown(document.body, { key: "ArrowUp" });
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "沈青梧" }));
    });

    it("C 在我认领的行上是取消认领,在他人认领的行上什么都不做", async () => {
      judgmentApi.release.mockResolvedValue({ data: {} });
      renderPage();
      await screen.findByText("陆晚晴");
      fireEvent.keyDown(document.body, { key: "j" }); // 沈青梧,我认领的
      fireEvent.keyDown(document.body, { key: "c" });
      await waitFor(() => expect(judgmentApi.release).toHaveBeenCalledWith("a"));
      expect(judgmentApi.claim).not.toHaveBeenCalled();
      await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("judgment.claim.done_release"), "success"));

      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "j" }); // 陆晚晴,他人认领
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "陆晚晴" }));
      fireEvent.keyDown(document.body, { key: "c" });
      expect(judgmentApi.release).toHaveBeenCalledTimes(1);
      expect(judgmentApi.claim).not.toHaveBeenCalled();
    });

    it("S 把焦点行延后到本次会话末:排到本组最后、延后一格写「本次会话」,不发请求;R 先确认再全部放回", async () => {
      GROUP_ROWS.unclaimed = [GROUP_ROWS.unclaimed[0], row("d", "顾长庚")];
      try {
        renderPage();
        await screen.findByText("顾长庚");
        const names = () => within(screen.getByTestId("queue-group-unclaimed")).getAllByRole("link").map((a) => a.textContent);
        expect(names()).toEqual(["Marguerite Vey", "顾长庚"]);

        fireEvent.keyDown(document.body, { key: "j" });
        fireEvent.keyDown(document.body, { key: "j" }); // Marguerite Vey
        fireEvent.keyDown(document.body, { key: "s" });
        expect(names()).toEqual(["顾长庚", "Marguerite Vey"]);
        expect(within(rowOf("Marguerite Vey")).getByTestId("deferred-cell")).toHaveTextContent(tZh("judgment.claim.deferred_session"));
        expect(within(rowOf("顾长庚")).getByTestId("deferred-cell")).toHaveTextContent("");
        expect(judgmentApi.batch).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith(tZh("judgment.claim.done_session_defer"), "success");
        expect(JSON.parse(window.sessionStorage.getItem("soulledger-queue-session-deferred") ?? "[]")).toEqual(["b"]);

        // R:先问,取消就什么都不变。
        fireEvent.keyDown(document.body, { key: "r" });
        let dialog = await screen.findByRole("alertdialog");
        fireEvent.click(within(dialog).getByRole("button", { name: tZh("common.cancel") }));
        await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
        expect(names()).toEqual(["顾长庚", "Marguerite Vey"]);

        fireEvent.keyDown(document.body, { key: "r" });
        dialog = await screen.findByRole("alertdialog");
        fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.queue.restore_all") }));
        await waitFor(() => expect(names()).toEqual(["Marguerite Vey", "顾长庚"]));
        expect(within(rowOf("Marguerite Vey")).getByTestId("deferred-cell")).toHaveTextContent("");
        expect(mockShowToast).toHaveBeenCalledWith(tZh("judgment.claim.done_restore", { n: "1" }), "success");
      } finally {
        GROUP_ROWS.unclaimed = GROUP_ROWS.unclaimed.slice(0, 1);
      }
    });

    it("没有本次会话延后的件时,R 不弹确认", async () => {
      renderPage();
      await screen.findByText("沈青梧");
      fireEvent.keyDown(document.body, { key: "r" });
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("「我认领的」只留我认领一组;「全部案卷」四组都回来", async () => {
      renderPage();
      await screen.findByText("陆晚晴");
      const scope = screen.getByTestId("queue-scope");
      const all = within(scope).getByRole("button", { name: tZh("judgment.claim.filter_all") });
      const mine = within(scope).getByRole("button", { name: tZh("judgment.claim.filter_mine") });
      expect(all).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(mine);
      expect(mine).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("queue-group-mine")).toBeInTheDocument();
      for (const g of ["unclaimed", "others", "deferred"]) expect(screen.queryByTestId(`queue-group-${g}`)).toBeNull();
      expect(screen.queryByText("陆晚晴")).toBeNull();
      fireEvent.click(all);
      expect(await screen.findByText("陆晚晴")).toBeInTheDocument();
    });

    it("草拟判决是字形 + 文字,原始值进 title;没拟过的写「未拟」;种类走 DomainEnum", async () => {
      GROUP_ROWS.others = [row("c", "陆晚晴", { claimed_by: 2, claimed_by_name: "秦广", draft_verdict: "RETRY", kind: "AMENDMENT" })];
      try {
        renderPage();
        await screen.findByText("陆晚晴");
        const drafted = within(rowOf("陆晚晴")).getByTestId("draft-cell");
        expect(drafted).toHaveTextContent(`↺ ${tZh("judgment.verdicts.retry")}`);
        expect(drafted.querySelector("[title]")).toHaveAttribute("title", "RETRY");
        expect(within(rowOf("陆晚晴")).getByText(tZh("judgment.claim.kinds.AMENDMENT"))).toHaveAttribute("title", "AMENDMENT");
        expect(within(rowOf("沈青梧")).getByTestId("draft-cell")).toHaveTextContent(tZh("judgment.claim.draft_none"));
        expect(within(rowOf("沈青梧")).getByTestId("draft-cell")).not.toHaveTextContent("↺");
      } finally {
        GROUP_ROWS.others = [row("c", "陆晚晴", { claimed_by: 2, claimed_by_name: "秦广" })];
      }
    });

    it("工具条「改派…」没勾选时作用于焦点行;什么都没选时不可按;没有改派权限时不出现", async () => {
      mockUser = { ...mockUser, role: "MODERATOR", permissions: ["judgment.read", "judgment.execute", "judgment.assign"] };
      renderPage();
      await screen.findByText("陆晚晴");
      const toolbarReassign = () => screen.getAllByRole("button", { name: tZh("judgment.claim.reassign") })[0];
      expect(toolbarReassign()).toBeDisabled();
      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "j" }); // 陆晚晴
      expect(toolbarReassign()).toBeEnabled();
      fireEvent.click(toolbarReassign());
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(judgmentApi.assignableOfficers).toHaveBeenCalledWith(["c"]));
      fireEvent.click(await within(dialog).findByRole("radio", { name: /秦广王/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.claim.reassign_confirm") }));
      await waitFor(() => expect(judgmentApi.batch).toHaveBeenCalledWith({ operation: "reassign", ids: ["c"], to: 7 }));
    });

    it("JUDGE(没有 judgment.assign)的工具条上没有「改派…」", async () => {
      renderPage();
      await screen.findByText("陆晚晴");
      expect(screen.queryByRole("button", { name: tZh("judgment.claim.reassign") })).toBeNull();
    });

    const openRowMenu = async (name: string) => {
      fireEvent.click(within(rowOf(name)).getByRole("button", { name: `${tZh("common.row_actions")} · ${name}` }));
      return (await screen.findByRole("menu")).querySelectorAll<HTMLElement>("[role=menuitem]");
    };
    const labels = (items: NodeListOf<HTMLElement>) => [...items].map((el) => el.textContent);

    it("「⋯」菜单按权限:我认领的给取消认领 + 延后,未认领的给认领 + 延后,他人认领的只给延后;JUDGE 没有改派", async () => {
      renderPage();
      await screen.findByText("陆晚晴");
      expect(labels(await openRowMenu("沈青梧"))).toEqual([tZh("judgment.claim.release"), tZh("judgment.queue.defer")]);
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      expect(labels(await openRowMenu("Marguerite Vey"))).toEqual([tZh("judgment.claim.claim"), tZh("judgment.queue.defer")]);
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      expect(labels(await openRowMenu("陆晚晴"))).toEqual([tZh("judgment.queue.defer")]);
    });

    it("「⋯ → 取消认领」是 C 的鼠标路径;色标不卸载,而是反着退场(scaleY 1→0,dismiss 140ms,出场曲线)", async () => {
      judgmentApi.release.mockReturnValue(new Promise(() => {})); // 服务端还没回:退场不等往返
      renderPage();
      await screen.findByText("沈青梧");
      expect(within(rowOf("沈青梧")).getByTestId("row-mark")).toBeInTheDocument();
      const [release] = await openRowMenu("沈青梧");
      fireEvent.click(release);
      await waitFor(() => expect(judgmentApi.release).toHaveBeenCalledWith("a"));
      const mine = rowOf("沈青梧");
      expect(within(mine).queryByTestId("row-mark")).toBeNull();
      expect(within(mine).queryByText(tZh("judgment.row_mark.mine"))).toBeNull();
      const cls = within(mine).getByTestId("row-mark-off").className.split(/\s+/);
      expect(cls).toEqual(expect.arrayContaining(["scale-y-0", "duration-dismiss", "ease-exit"]));
      expect(cls).not.toContain("starting:scale-y-0");
    });

    it("「⋯ → 认领」认领那一行;「⋯ → 延后」与 S 同一件事", async () => {
      renderPage();
      await screen.findByText("Marguerite Vey");
      fireEvent.click((await openRowMenu("Marguerite Vey"))[0]);
      await waitFor(() => expect(judgmentApi.claim).toHaveBeenCalledWith("b"));
      fireEvent.click((await openRowMenu("陆晚晴"))[0]);
      expect(within(rowOf("陆晚晴")).getByTestId("deferred-cell")).toHaveTextContent(tZh("judgment.claim.deferred_session"));
      expect(judgmentApi.batch).not.toHaveBeenCalled();
    });

    it("「⋯ → 改派…」只作用于那一行,不管勾选了什么;改派后勾选还在", async () => {
      mockUser = { ...mockUser, role: "MODERATOR", permissions: ["judgment.read", "judgment.execute", "judgment.assign"] };
      renderPage();
      await screen.findByText("陆晚晴");
      fireEvent.click(within(rowOf("沈青梧")).getByRole("checkbox"));
      const items = await openRowMenu("陆晚晴");
      expect(labels(items)).toEqual([tZh("judgment.queue.defer"), tZh("judgment.claim.reassign")]);
      fireEvent.click(items[1]);
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(judgmentApi.assignableOfficers).toHaveBeenCalledWith(["c"]));
      fireEvent.click(await within(dialog).findByRole("radio", { name: /秦广王/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.claim.reassign_confirm") }));
      await waitFor(() => expect(judgmentApi.batch).toHaveBeenCalledWith({ operation: "reassign", ids: ["c"], to: 7 }));
      expect(screen.getByTestId("batch-bar")).toBeInTheDocument();
    });

    it("改派层是 v3 的 390 宽、手机上从底部升起 78% 高(Drawer 的 layer)", async () => {
      mockUser = { ...mockUser, role: "MODERATOR", permissions: ["judgment.read", "judgment.execute", "judgment.assign"] };
      renderPage();
      await screen.findByText("陆晚晴");
      fireEvent.click((await openRowMenu("陆晚晴"))[1]);
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveAttribute("data-variant", "layer");
      expect(dialog.className.split(/\s+/)).toEqual(expect.arrayContaining(["sm:w-[390px]", "h-[78%]", "bottom-0", "data-starting-style:translate-y-3"]));
      expect(dialog.className).not.toContain("sm:w-[480px]");
    });

    it("批量条吸在工具条下沿,出现时 translateY(8→0) + 淡入", async () => {
      renderPage();
      await screen.findByText("沈青梧");
      fireEvent.click(within(rowOf("沈青梧")).getByRole("checkbox"));
      const cls = (await screen.findByTestId("batch-bar")).className.split(/\s+/);
      expect(cls).toEqual(expect.arrayContaining(["sticky", "top-(--below-band)", "duration-fast", "starting:translate-y-2", "starting:opacity-0"]));
      // 身份带是 sticky 的(v3/band):吸在 52 的工具条下沿会被身份带盖住。
      expect(cls).not.toContain("top-13");
    });
  });
});

describe("审判队列 · 世次 / 种类", () => {
  it("cycle 0 是第 1 世;世次在上、种类在下", async () => {
    renderPage();
    await screen.findByText("Marguerite Vey");
    const first = within(rowOf("Marguerite Vey")).getByTestId("cycle-kind-cell");
    expect(first).toHaveTextContent(tZh("souls.detail.life_number", { n: "1" }));
    expect(first).toHaveTextContent(tZh("judgment.claim.kinds.ORIGINAL"));
    const fourth = within(rowOf("沈青梧")).getByTestId("cycle-kind-cell");
    expect(fourth).toHaveTextContent(tZh("souls.detail.life_number", { n: "4" }));
    expect(fourth).not.toHaveTextContent(tZh("souls.detail.life_number", { n: "3" }));
    expect(screen.getByRole("columnheader", { name: tZh("judgment.claim.col_cycle_kind") })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: tZh("judgment.claim.col_merit_demerit") })).toBeInTheDocument();
  });

  it("VIEWER 拿不到功过两个字段:写「未记录」,不写 0", async () => {
    GROUP_ROWS.mine = [row("a", "沈青梧", { claimed_by: 1, claimed_by_name: "阎罗", merit_score: undefined, demerit_score: undefined })];
    try {
      renderPage();
      await screen.findByText("沈青梧");
      const cell = within(rowOf("沈青梧")).getByTestId("merit-demerit-cell");
      expect(cell.querySelectorAll('[data-missing="unrecorded"]')).toHaveLength(2);
      expect(cell).not.toHaveTextContent("0");
    } finally {
      GROUP_ROWS.mine = [row("a", "沈青梧", { claimed_by: 1, claimed_by_name: "阎罗" })];
    }
  });
});
