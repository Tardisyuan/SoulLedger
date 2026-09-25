/**
 * 审判台(/judgment/[id],规范 v1 第三类 A·01)新接的几条线:裁决键 1–4、⌘⏎ 落判、
 * 引用签的撤回、律条检索的引用、卷栏的功过与前世、队列进度条。
 *
 * 真页面、真 QueryClient,只桩 HTTP 层。每条行为都断了反面:打字时按 2 不改裁决、
 * 没有 judgment.execute 时 ⌘⏎ 不落判、案子不在队列头时不画进度条。
 *
 * 后端接上之后的四条:丙 证据采信(空格切换焦点行,不采信要理由,采信后余额读服务端)、
 * 丁 判词自动保存(去抖、带版本号;409 停下并摆出对方的版本,绝不静默覆盖)、据 · 先例、
 * 进度条上的 S 暂缓(理由必填)。
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
    ruleEvidence: jest.fn(),
    saveDraft: jest.fn(),
    precedents: jest.fn(),
    defer: jest.fn(),
    destinations: jest.fn(),
    previous: jest.fn(),
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

const realm = (id: string, name: string, occupancy: number, capacity: number | null, is_eternal = false) => ({
  id, name, realm_code: id, kind: "HALL", capacity, occupancy, is_eternal,
});
const DESTINATIONS = [
  realm("r-5", "第五殿", 3, 10),
  realm("r-7", "第七殿", 10, 10),
  realm("r-9", "第九殿", 10, 12),
  realm("r-a", "阿鼻", 1, null, true),
];
const NOT_APPLICABLE = [realm("r-h", "天堂", 0, null)];

const radio = (value: string) =>
  screen.getAllByRole("radio").find((r) => (r as HTMLInputElement).value === value) as HTMLInputElement;
const notesBox = () => screen.getByLabelText(tZh("judgment.detail.notes")) as HTMLTextAreaElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 2, username: "op", role: "JUDGE", permissions: ["judgment.read", "judgment.execute"], tenant: { code: "CN_DIYU" } };
  judgmentApi.get.mockResolvedValue({ data: judgment() });
  judgmentApi.conclude.mockResolvedValue({ data: judgment({ is_final: true, verdict: "PURGATORY" }) });
  // `at` (进度条) 答本案;`after` (J 下一件) 默认答「后面没有了」。
  judgmentApi.next.mockImplementation((params?: { after?: string }) =>
    Promise.resolve({
      data: params?.after
        ? { total: 12, remaining: 12, skipped: 0, position: null, judgment: null, soul: null, ledger: null, prior_cycles: [], realm_options: [] }
        : { total: 12, remaining: 12, skipped: 0, position: 3, judgment: { id: ID }, soul: null, ledger: null, prior_cycles: [], realm_options: [] },
    })
  );
  judgmentApi.statutes.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [statute("st-7", "口業 · 七")] } });
  judgmentApi.cite.mockResolvedValue({ data: {} });
  judgmentApi.uncite.mockResolvedValue({ data: {} });
  judgmentApi.ruleEvidence.mockResolvedValue({ data: {} });
  judgmentApi.saveDraft.mockResolvedValue({ data: {} });
  judgmentApi.precedents.mockResolvedValue({ data: [] });
  judgmentApi.defer.mockResolvedValue({ data: {} });
  judgmentApi.destinations.mockImplementation((_id: string, verdict: string) =>
    Promise.resolve({
      data: { verdict, default_realm_id: "r-5", default_term_years: null, options: DESTINATIONS, not_applicable: NOT_APPLICABLE },
    })
  );
  judgmentApi.previous.mockResolvedValue({
    data: { total: 12, remaining: 12, skipped: 0, position: null, judgment: null, soul: null, ledger: null, prior_cycles: [], realm_options: [] },
  });
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

  it("勾上审批流,落判按钮就写成「落判并发起」;取消勾选再改回", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    const button = () => screen.getByRole("button", { name: new RegExp(tZh("judgment.detail.conclude")) });
    expect(button()).not.toHaveTextContent(tZh("judgment.detail.conclude_with_workflow"));
    const box = screen.getByRole("checkbox", { name: new RegExp(tZh("judgment.detail.create_workflow")) });
    fireEvent.click(box);
    expect(screen.getByRole("button", { name: new RegExp(tZh("judgment.detail.conclude_with_workflow")) })).toBeInTheDocument();
    fireEvent.click(box);
    expect(button()).not.toHaveTextContent(tZh("judgment.detail.conclude_with_workflow"));
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

// ── 丙 · 证据采信 ─────────────────────────────────────────────────────────

const record = (id: string, type: string, description: string, weight: number) => ({
  id, type, category: "CHARITY", description, original_weight: weight, effective_weight: weight, years_elapsed: 0,
  decay_factor: 1, civilization: "CHINESE", recorded_at: "2026-06-02T00:00:00Z", event_date: null, is_milestone: false,
});
const RECORDS = [
  record("r1", "MERIT", "救溺 · 胥江", 120),
  record("r2", "MERIT", "布施米粮(疑重复登记)", 40),
  record("r3", "DEMERIT", "詈骂邻人", 25),
  record("r4", "MILESTONE", "立户", 0),
];
const withEvidence = (over: Record<string, unknown> = {}) =>
  judgment({
    evidence_admissions: [{ id: "ea-1", record: "r2", admitted: false, reason: "与上条同日同事", created_at: "", update_time: "" }],
    admitted_balance: { reading_kind: "BALANCE", balance: 307, not_admitted_count: 1, not_admitted_net: 40, reason_code: null },
    ...over,
  });
const evidenceRow = (text: string) =>
  screen.getAllByTestId("evidence-row").find((r) => r.textContent?.includes(text)) as HTMLElement;

describe("丙 · 证据采信", () => {
  beforeEach(() => {
    judgmentApi.get.mockResolvedValue({ data: withEvidence() });
    soulsApi.karma.mockResolvedValue({
      data: {
        soul_id: "s-1", soul_name: "沈青梧", merit_score: 1284, demerit_score: 937, karmic_balance: 347,
        record_count: 4, records: RECORDS, reading: { kind: "BALANCE", civilization: "CHINESE", merit: 1284, demerit: 937, balance: 347 },
      },
    });
  });

  it("只列功与过两类;采信计数、不采信的理由、采信后余额都读服务端", async () => {
    renderPage();
    await screen.findAllByTestId("evidence-row");
    expect(screen.getAllByTestId("evidence-row")).toHaveLength(3);
    expect(screen.queryByText("立户")).toBeNull();
    const section = screen.getByTestId("evidence-admission");
    expect(within(section).getByText("2 / 3")).toBeInTheDocument();
    expect(evidenceRow("布施米粮")).toHaveAttribute("data-admitted", "false");
    expect(within(evidenceRow("布施米粮")).getByText(tZh("judgment.admission.reason_shown", { reason: "与上条同日同事" }))).toBeInTheDocument();
    const balance = screen.getByTestId("admitted-balance");
    expect(balance).toHaveTextContent(tZh("judgment.admission.balance_label") + tZh("judgment.admission.not_admitted_net", { n: "1", net: "+40" }));
    expect(within(balance).getByText("+307")).toBeInTheDocument();
  });

  it("采信 → 不采信要理由,空理由不发;不采信 → 采信直接发", async () => {
    renderPage();
    await screen.findAllByTestId("evidence-row");
    fireEvent.click(within(evidenceRow("救溺")).getByRole("checkbox"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.admission.confirm_not_admit") }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(judgmentApi.ruleEvidence).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "无旁证" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.admission.confirm_not_admit") }));
    await waitFor(() => expect(judgmentApi.ruleEvidence).toHaveBeenCalledWith(ID, "r1", { admitted: false, reason: "无旁证" }));

    fireEvent.click(within(evidenceRow("布施米粮")).getByRole("checkbox"));
    await waitFor(() => expect(judgmentApi.ruleEvidence).toHaveBeenCalledWith(ID, "r2", { admitted: true }));
  });

  it("空格切换的是获焦的那一行:焦点目标是行里的原生按钮,行本身不挂键盘监听;打字时的空格不裁定", async () => {
    renderPage();
    await screen.findAllByTestId("evidence-row");
    for (const row of screen.getAllByTestId("evidence-row")) {
      const toggle = within(row).getByRole("checkbox");
      // 一个 <button>:空格是它的原生激活,所以不需要、也不许再有一层监听去切第二次。
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle).toHaveAttribute("aria-checked", row.getAttribute("data-admitted"));
      expect(row).not.toHaveAttribute("tabindex");
    }
    fireEvent.keyDown(notesBox(), { key: " " });
    fireEvent.keyDown(evidenceRow("救溺"), { key: " " });
    await act(async () => {});
    expect(judgmentApi.ruleEvidence).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("案子不在这一世:不列证据,说为什么;已结案:没有开关", async () => {
    judgmentApi.get.mockResolvedValue({
      data: withEvidence({ admitted_balance: { reading_kind: null, balance: null, not_admitted_count: 0, not_admitted_net: null, reason_code: "NOT_CURRENT_LIFE" } }),
    });
    const a = renderPage();
    expect(await screen.findByText(tZh("judgment.admission.not_current_life"))).toBeInTheDocument();
    expect(screen.queryAllByTestId("evidence-row")).toHaveLength(0);
    a.unmount();

    judgmentApi.get.mockResolvedValue({ data: withEvidence({ is_final: true, verdict: "PURGATORY" }) });
    renderPage();
    await screen.findAllByTestId("evidence-row");
    expect(within(screen.getByTestId("evidence-admission")).queryAllByRole("checkbox")).toHaveLength(0);
  });
});

describe("乙 · 功过:结案时的余额快照", () => {
  beforeEach(() => {
    soulsApi.karma.mockResolvedValue({
      data: {
        soul_id: "s-1", soul_name: "沈青梧", merit_score: 1284, demerit_score: 937, karmic_balance: 347,
        record_count: 4, records: RECORDS, reading: { kind: "BALANCE", civilization: "CHINESE", merit: 1284, demerit: 937, balance: 347 },
      },
    });
  });
  const concluded = (current: number | null) =>
    withEvidence({
      is_final: true, verdict: "PURGATORY", concluded_at: "2026-06-01T08:00:00Z",
      admitted_balance: { reading_kind: "BALANCE", balance: 307, current_balance: current, not_admitted_count: 1, not_admitted_net: 40, reason_code: null },
    });

  it("快照在上、双线收住;现值在下;其后登记的功过条数与差额(里程碑不算)", async () => {
    judgmentApi.get.mockResolvedValue({ data: concluded(352) });
    renderPage();
    const box = await screen.findByTestId("concluded-balance");
    const rows = within(box).getAllByRole("term").map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(rows).toEqual([
      [tZh("judgment.desk.balance_at_conclusion"), "+307"],
      [tZh("judgment.desk.balance_now"), "+352"],
      [tZh("judgment.desk.recorded_after", { n: "3" }), "+45"],
    ]);
    expect(within(box).getAllByRole("term")[0].parentElement?.className).toMatch(/border-double/);
    expect(screen.getByText(tZh("judgment.desk.concluded_on", { date: "06-01" }))).toBeInTheDocument();
  });

  it("两值相同只写一行「余额」,不出现「现值」", async () => {
    judgmentApi.get.mockResolvedValue({ data: concluded(307) });
    renderPage();
    const box = await screen.findByTestId("concluded-balance");
    expect(box).toHaveTextContent(`${tZh("judgment.desk.balance_single")}+307`);
    expect(screen.queryByText(tZh("judgment.desk.balance_now"))).toBeNull();
    expect(screen.queryByText(tZh("judgment.desk.balance_at_conclusion"))).toBeNull();
  });

  it("未结案不画快照", async () => {
    judgmentApi.get.mockResolvedValue({ data: withEvidence() });
    renderPage();
    await screen.findAllByTestId("evidence-row");
    expect(screen.queryByTestId("concluded-balance")).toBeNull();
  });
});

// ── 丁 · 判词自动保存 ─────────────────────────────────────────────────────

const WAIT = { timeout: 4000 };

describe("丁 · 判词自动保存", () => {
  beforeEach(() => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ notes: "", draft_version: 4, draft_saved_at: null, draft_verdict: null }) });
  });

  it("不动不存;动过之后停手才存,带版本号与所选裁决,并显示服务端的保存时间", async () => {
    judgmentApi.saveDraft.mockResolvedValue({
      data: { notes: "功过相抵", draft_verdict: "PURGATORY", draft_version: 5, draft_saved_at: "2026-09-25T10:15:00Z" },
    });
    renderPage();
    await screen.findAllByRole("radio");
    await new Promise((r) => setTimeout(r, 1500));
    expect(judgmentApi.saveDraft).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "3" });
    fireEvent.change(notesBox(), { target: { value: "功过相抵" } });
    expect(judgmentApi.saveDraft).not.toHaveBeenCalled(); // 去抖:不是每个字一次
    await waitFor(() => expect(judgmentApi.saveDraft).toHaveBeenCalledTimes(1), WAIT);
    expect(judgmentApi.saveDraft).toHaveBeenCalledWith(ID, { version: 4, notes: "功过相抵", draft_verdict: "PURGATORY" });
    expect(await screen.findByText(tZh("judgment.draft.saved_at", { time: "2026-09-25T10:15:00Z" }))).toBeInTheDocument();

    // 下一次以服务端回来的版本为底。
    fireEvent.change(notesBox(), { target: { value: "功过相抵,暂入救济门" } });
    await waitFor(() => expect(judgmentApi.saveDraft).toHaveBeenCalledTimes(2), WAIT);
    expect(judgmentApi.saveDraft).toHaveBeenLastCalledWith(ID, { version: 5, notes: "功过相抵,暂入救济门", draft_verdict: "PURGATORY" });
  }, 15000);

  const CONFLICT = {
    response: {
      status: 409,
      data: {
        error: "draft conflict", code: "draft_conflict",
        current: { notes: "他人的判词", draft_verdict: "PASSED", draft_version: 9, draft_saved_at: "2026-09-25T10:20:00Z" },
      },
    },
  };

  it("409:停下、摆出对方的版本;不覆盖我正在写的字,之后的改动也不再自动存", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ notes: "", draft_version: 4, draft_saved_at: "2026-09-25T10:00:00Z", draft_verdict: null }) });
    judgmentApi.saveDraft.mockRejectedValue(CONFLICT);
    renderPage();
    await screen.findAllByRole("radio");
    expect(await screen.findByTestId("draft-status")).toBeInTheDocument();
    fireEvent.change(notesBox(), { target: { value: "我的判词" } });
    const banner = await screen.findByTestId("draft-conflict", {}, WAIT);
    expect(within(banner).getByText("他人的判词")).toBeInTheDocument();
    expect(notesBox().value).toBe("我的判词");
    // 冲突时不显示「已自动保存」:那个时间属于对方的版本,不属于框里这段字。
    expect(screen.queryByTestId("draft-status")).toBeNull();

    fireEvent.change(notesBox(), { target: { value: "我的判词,续写" } });
    await new Promise((r) => setTimeout(r, 1500));
    expect(judgmentApi.saveDraft).toHaveBeenCalledTimes(1);
  }, 15000);

  it("409 之后「保留我的」是一次看见对方之后的显式覆盖:以对方的版本号再存", async () => {
    judgmentApi.saveDraft.mockRejectedValueOnce(CONFLICT).mockResolvedValue({
      data: { notes: "我的判词", draft_verdict: null, draft_version: 10, draft_saved_at: "2026-09-25T10:21:00Z" },
    });
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.change(notesBox(), { target: { value: "我的判词" } });
    const banner = await screen.findByTestId("draft-conflict", {}, WAIT);
    fireEvent.click(within(banner).getByRole("button", { name: tZh("judgment.draft.keep_mine") }));
    await waitFor(() => expect(judgmentApi.saveDraft).toHaveBeenCalledTimes(2), WAIT);
    expect(judgmentApi.saveDraft).toHaveBeenLastCalledWith(ID, { version: 9, notes: "我的判词", draft_verdict: null });
    await waitFor(() => expect(screen.queryByTestId("draft-conflict")).toBeNull());
  }, 15000);

  it("409 之后「改用对方的」:判词与裁决换成对方的,不再存", async () => {
    judgmentApi.saveDraft.mockRejectedValue(CONFLICT);
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.change(notesBox(), { target: { value: "我的判词" } });
    const banner = await screen.findByTestId("draft-conflict", {}, WAIT);
    fireEvent.click(within(banner).getByRole("button", { name: tZh("judgment.draft.use_server") }));
    expect(notesBox().value).toBe("他人的判词");
    expect(radio("PASSED").checked).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect(judgmentApi.saveDraft).toHaveBeenCalledTimes(1);
  }, 15000);

  it("存过的裁决草稿在打开时选中;已结案不存", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ draft_verdict: "RETRY", draft_version: 2 }) });
    const a = renderPage();
    await waitFor(() => expect(radio("RETRY").checked).toBe(true));
    a.unmount();

    judgmentApi.get.mockResolvedValue({ data: judgment({ is_final: true, verdict: "PASSED", notes: "定" }) });
    renderPage();
    await screen.findByText(tZh("judgment.detail.final"));
    fireEvent.keyDown(document.body, { key: "2" });
    await new Promise((r) => setTimeout(r, 1500));
    expect(judgmentApi.saveDraft).not.toHaveBeenCalled();
  }, 15000);
});

// ── 据 · 先例 与 D 暂缓 ────────────────────────────────────────────────────

describe("据 · 先例", () => {
  it("照服务端的顺序列出:名字链到那件审判,裁决带字形,同殿标出", async () => {
    judgmentApi.precedents.mockResolvedValue({
      data: [
        { id: "p-1", soul: "s-9", name: "周慕云", verdict: "PURGATORY", court: "第五殿", concluded_at: null, balance: 298, realm_code: "JIUJI_17", realm_name: "救濟門 · 十七", same_court: true, shared_statutes: 2 },
        { id: "p-2", soul: "s-8", name: "陆晚晴", verdict: "PASSED", court: "第一殿", concluded_at: null, balance: 410, realm_code: null, realm_name: null, same_court: false, shared_statutes: 0 },
      ],
    });
    renderPage();
    const panel = await screen.findByTestId("precedents");
    const first = await within(panel).findByRole("link", { name: "周慕云" });
    expect(first).toHaveAttribute("href", "/judgment/p-1");
    const items = within(panel).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("◇");
    expect(items[0]).toHaveTextContent(tZh("judgment.precedents.same_court"));
    expect(items[1]).toHaveTextContent("✓");
    expect(items[1]).not.toHaveTextContent(tZh("judgment.precedents.same_court"));
  });

  it("没有先例时说没有,不画空框", async () => {
    renderPage();
    expect(await screen.findByText(tZh("judgment.precedents.empty"))).toBeInTheDocument();
  });
});

describe("进度条上的 S 暂缓", () => {
  it("S 开理由框,理由必填,写了才发;在判词框里按 S 是写字;D 不再接", async () => {
    renderPage();
    await screen.findByTestId("queue-bar");
    fireEvent.keyDown(notesBox(), { key: "s" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "d" });
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(document.body, { key: "s" });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.claim.defer") }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(judgmentApi.defer).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "待补证" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.claim.defer") }));
    await waitFor(() => expect(judgmentApi.defer).toHaveBeenCalledWith(ID, "待补证"));
  });

  it("没有 judgment.execute:进度条上没有暂缓,S 也不接", async () => {
    mockUser = { ...mockUser, permissions: ["judgment.read"] };
    renderPage();
    const bar = await screen.findByTestId("queue-bar");
    expect(within(bar).queryByRole("button", { name: /暂缓/ })).toBeNull();
    fireEvent.keyDown(document.body, { key: "s" });
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("已暂缓的案子在判栏顶上写出理由", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ deferred_at: "2026-09-20T00:00:00Z", defer_reason: "待补证" }) });
    renderPage();
    expect(await screen.findByTestId("deferred-note")).toHaveTextContent(tZh("judgment.desk.deferred_note", { reason: "待补证" }));
  });
});

describe("戊 · 发落", () => {
  const destinationBox = () => screen.getByLabelText(tZh("judgment.placement.destination")) as HTMLSelectElement;
  const termBox = () => screen.getByLabelText(tZh("judgment.placement.term")) as HTMLInputElement;
  const conclude = () => fireEvent.click(screen.getByRole("button", { name: new RegExp(tZh("judgment.detail.conclude")) }));

  it("先选裁决;目的地只取这个裁决的候选,标出占用与已满,默认项是自动分派", async () => {
    renderPage();
    expect(await screen.findByText(tZh("judgment.placement.pick_verdict"))).toBeInTheDocument();
    expect(judgmentApi.destinations).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    expect(judgmentApi.destinations).toHaveBeenCalledWith(ID, "FAILED");
    // 一张平铺的名单:已满的与不适用的照样列出、禁用、写明原因(第三类 F 组 2.5)。
    const rows = Array.from(destinationBox().options).map((o) => [o.textContent, o.disabled]);
    expect(rows).toEqual([
      [tZh("judgment.placement.auto", { name: "第五殿" }), false],
      ["第五殿 · 3 / 10", false],
      [`第七殿 · 10 / 10 · ${tZh("judgment.placement.full")}`, true],
      ["第九殿 · 10 / 12", false],
      ["阿鼻 · 1", false],
      [`天堂 · ${tZh("judgment.placement.not_applicable", { verdict: tZh("judgment.verdicts.failed") })}`, true],
    ]);
    expect(screen.getByText(tZh("judgment.placement.filtered_by", { verdict: tZh("judgment.verdicts.failed") }))).toBeInTheDocument();
  });

  it("选了发落、还没落判,标题行挂「草稿 · 未提交」;什么都没选就不挂", async () => {
    renderPage();
    fireEvent.keyDown(await screen.findByText(tZh("judgment.placement.pick_verdict")), { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    expect(screen.queryByTestId("placement-draft")).toBeNull();
    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    expect(screen.getByTestId("placement-draft")).toHaveTextContent(tZh("judgment.placement.draft"));
    fireEvent.change(destinationBox(), { target: { value: "" } });
    expect(screen.queryByTestId("placement-draft")).toBeNull();
  });

  it("选了目的地与刑期就随结案发出;什么都不选,请求里没有这三个字段", async () => {
    renderPage();
    fireEvent.keyDown(await screen.findByText(tZh("judgment.placement.pick_verdict")), { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    conclude();
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(1));
    expect(judgmentApi.conclude.mock.calls[0][1]).toEqual({ verdict: "FAILED", notes: "", create_workflow: false });

    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    fireEvent.change(termBox(), { target: { value: "0x12" } }); // 非数字剥掉,前导零归掉
    expect(termBox().value).toBe("12");
    conclude();
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(2));
    expect(judgmentApi.conclude.mock.calls[1][1]).toEqual({
      verdict: "FAILED", notes: "", create_workflow: false, destination_realm_id: "r-9", term_years: 12,
    });
  });

  it("换了裁决,为旧裁决选的发落就不再随请求发出", async () => {
    renderPage();
    fireEvent.keyDown(await screen.findByText(tZh("judgment.placement.pick_verdict")), { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    fireEvent.keyDown(document.body, { key: "3" });
    await waitFor(() => expect(judgmentApi.destinations).toHaveBeenCalledWith(ID, "PURGATORY"));
    expect(((await screen.findByLabelText(tZh("judgment.placement.destination"))) as HTMLSelectElement).value).toBe("");
    conclude();
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(1));
    expect(judgmentApi.conclude.mock.calls[0][1]).not.toHaveProperty("destination_realm_id");
  });

  it("永恒只在能收永恒的目的地出现;勾上后不带刑期", async () => {
    renderPage();
    fireEvent.keyDown(await screen.findByText(tZh("judgment.placement.pick_verdict")), { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    expect(screen.queryByLabelText(tZh("judgment.placement.eternal"))).toBeNull();

    fireEvent.change(termBox(), { target: { value: "7" } });
    fireEvent.change(destinationBox(), { target: { value: "r-a" } });
    fireEvent.click(screen.getByLabelText(tZh("judgment.placement.eternal")));
    expect(termBox()).toBeDisabled();
    conclude();
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(1));
    expect(judgmentApi.conclude.mock.calls[0][1]).toEqual({
      verdict: "FAILED", notes: "", create_workflow: false, destination_realm_id: "r-a", eternal: true,
    });
  });

  it("realm_full:在这一节写「! 执行失败：目的地已满」,不弹通用 toast,并重取占用", async () => {
    judgmentApi.conclude.mockRejectedValue({ response: { status: 409, data: { error: "R9 is full (10/10)", code: "realm_full" } } });
    renderPage();
    fireEvent.keyDown(await screen.findByText(tZh("judgment.placement.pick_verdict")), { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    const calls = judgmentApi.destinations.mock.calls.length;
    conclude();
    const alert = await within(screen.getByTestId("placement")).findByRole("alert");
    expect(alert).toHaveTextContent(`! ${tZh("judgment.placement.errors.realm_full")}`);
    expect(mockShowToast).not.toHaveBeenCalled();
    await waitFor(() => expect(judgmentApi.destinations.mock.calls.length).toBeGreaterThan(calls));
  });

  it("加减项审判与没有 judgment.execute 的人都没有这一节", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ kind: "AMENDMENT", amends_plan_id: null }) });
    const a = renderPage();
    await screen.findAllByRole("radio");
    expect(screen.queryByTestId("placement")).toBeNull();
    a.unmount();

    judgmentApi.get.mockResolvedValue({ data: judgment() });
    mockUser = { ...mockUser, permissions: ["judgment.read"] };
    renderPage();
    await screen.findAllByRole("radio");
    expect(screen.queryByTestId("placement")).toBeNull();
  });
});

describe("J 下一件", () => {
  const withNext = () =>
    judgmentApi.next.mockImplementation((params?: { after?: string }) =>
      Promise.resolve({
        data: {
          total: 12, remaining: 12, skipped: 0, position: params?.after ? 4 : 3,
          judgment: { id: params?.after ? "j-2" : ID }, soul: null, ledger: null, prior_cycles: [], realm_options: [],
        },
      })
    );

  it("有下一件时画链接,J 打开它;在判词框里按 J 是写字", async () => {
    withNext();
    renderPage();
    const link = await screen.findByRole("link", { name: tZh("judgment.desk.next") });
    expect(link).toHaveAttribute("href", "/judgment/j-2");
    expect(judgmentApi.next).toHaveBeenCalledWith({ after: ID, skip: [] });
    const click = jest.spyOn(link, "click").mockImplementation(() => {});
    fireEvent.keyDown(notesBox(), { key: "j" });
    expect(click).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "j" });
    expect(click).toHaveBeenCalledTimes(1);
    // J 与 K 各开各的:按 J 不会点到上一件(此处也没有上一件的链接)。
    expect(screen.queryByRole("link", { name: tZh("judgment.desk.previous") })).toBeNull();
  });

  it("后面没有了:没有链接,J 什么都不做", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    await waitFor(() => expect(judgmentApi.next).toHaveBeenCalledWith({ after: ID, skip: [] }));
    await act(async () => {});
    expect(screen.queryByRole("link", { name: tZh("judgment.desk.next") })).toBeNull();
  });
});

describe("K 上一件", () => {
  it("有上一件时画链接,K 打开它;在判词框里按 K 是写字", async () => {
    judgmentApi.previous.mockResolvedValue({
      data: { total: 12, remaining: 12, skipped: 0, position: 2, judgment: { id: "j-0" }, soul: null, ledger: null, prior_cycles: [], realm_options: [] },
    });
    renderPage();
    const link = await screen.findByRole("link", { name: tZh("judgment.desk.previous") });
    expect(link).toHaveAttribute("href", "/judgment/j-0");
    expect(judgmentApi.previous).toHaveBeenCalledWith({ at: ID, skip: [] });
    const click = jest.spyOn(link, "click").mockImplementation(() => {});
    fireEvent.keyDown(notesBox(), { key: "k" });
    expect(click).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "k" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("前面没有了:没有链接,K 什么都不做", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    await waitFor(() => expect(judgmentApi.previous).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("link", { name: tZh("judgment.desk.previous") })).toBeNull();
  });
});
