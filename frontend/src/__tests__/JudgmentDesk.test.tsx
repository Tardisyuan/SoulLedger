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

// 「插入审判台」落点读 `?cite=`;默认没有。
let mockSearch = "";
jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: {
    get: jest.fn(),
    conclude: jest.fn(),
    next: jest.fn(),
    statutes: jest.fn(),
    statute: jest.fn(),
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
  created_at: "2026-09-12T00:00:00Z", concluded_at: null, kind: "ORIGINAL", amends_plan_id: null,
  case_number: "CN-2026-0042", ...over,
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
/** v3:引用签、律条检索、先例在资料舱的「律条引用」标签里;默认打开的是功过记录。 */
const openLawTab = async () => fireEvent.click(await screen.findByRole("tab", { name: tZh("judgment.desk.tab_law") }));
const toConfirm = () => screen.getByRole("button", { name: tZh("judgment.desk.to_confirm") });
/** v3 落判两步:主按钮进盖印确认层,层里「盖印并结案」才发 conclude/。 */
const concludeViaLayer = async () => {
  fireEvent.click(toConfirm());
  fireEvent.click(await screen.findByRole("button", { name: tZh("judgment.desk.stamp") }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = "";
  localStorage.clear();
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

  it("⌘⏎ 第一下进盖印确认层(不落判),层里再一下才落判,带上判词与所选裁决 —— 在判词框里也接", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "3" });
    fireEvent.change(notesBox(), { target: { value: "功过相抵,暂入救济门" } });
    fireEvent.keyDown(notesBox(), { key: "Enter", metaKey: true });
    const layer = await screen.findByTestId("confirm-layer");
    expect(layer).toHaveTextContent(tZh("judgment.desk.confirm_body", { verdict: tZh("judgment.verdicts.purgatory") }));
    await act(async () => {});
    expect(judgmentApi.conclude).not.toHaveBeenCalled();
    // 层开着时 1–4 不改裁决:层上写着的就是要落的那一个。
    // (层是模态的,页面在它下面对读屏不可见,所以这里直接读那个 input。)
    fireEvent.keyDown(document.body, { key: "1" });
    const chosen = document.querySelector<HTMLInputElement>('input[name="verdict"]:checked');
    expect(chosen?.value).toBe("PURGATORY");
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(1));
    expect(judgmentApi.conclude.mock.calls[0]).toEqual([
      ID,
      { verdict: "PURGATORY", notes: "功过相抵,暂入救济门", create_workflow: false },
    ]);
  });

  it("勾上审批流,确认层里的落判键写成「落判并发起」;不勾是「盖印并结案」", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "1" });
    fireEvent.click(toConfirm());
    let layer = await screen.findByTestId("confirm-layer");
    expect(within(layer).getByRole("button", { name: tZh("judgment.desk.stamp") })).toBeInTheDocument();
    expect(within(layer).queryByRole("button", { name: tZh("judgment.detail.conclude_with_workflow") })).toBeNull();
    fireEvent.click(within(layer).getByRole("button", { name: tZh("judgment.desk.back_to_check") }));
    await waitFor(() => expect(screen.queryByTestId("confirm-layer")).toBeNull());

    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(tZh("judgment.detail.create_workflow")) }));
    fireEvent.click(toConfirm());
    layer = await screen.findByTestId("confirm-layer");
    expect(within(layer).getByRole("button", { name: tZh("judgment.detail.conclude_with_workflow") })).toBeInTheDocument();
    expect(within(layer).queryByRole("button", { name: tZh("judgment.desk.stamp") })).toBeNull();
  });

  it("⌘⏎ 与落判按钮同一道门:没有 judgment.execute 就不落判", async () => {
    // (「未选裁决」这一半已不存在:没选过的案子预选待定,见「v3 · 当前这一判」。)
    mockUser = { ...mockUser, permissions: ["judgment.read"] };
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    // 按钮本身也不在(RequirePermission),键不能是一条绕过它的路:层也不开。
    expect(screen.queryByRole("button", { name: tZh("judgment.desk.to_confirm") })).toBeNull();
    expect(screen.queryByTestId("confirm-layer")).toBeNull();
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
    await openLawTab();
    const chips = await screen.findByRole("list", { name: tZh("judgment.grounds.title") });
    fireEvent.click(within(chips).getByRole("button", { name: tZh("judgment.desk.uncite", { code: "口業 · 三" }) }));
    await waitFor(() => expect(judgmentApi.uncite).toHaveBeenCalledWith(ID, "st-1"));
  });

  it("检索按本文明发请求,引用未引过的一条", async () => {
    renderPage();
    await openLawTab();
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
    await openLawTab();
    const chips = await screen.findByRole("list", { name: tZh("judgment.grounds.title") });
    expect(within(chips).getByText("口業 · 三")).toBeInTheDocument();
    expect(within(chips).queryByRole("button")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(tZh("judgment.desk.statute_search")), { target: { value: "口业" } });
    await screen.findByText("条文 口業 · 七");
    expect(screen.queryByRole("button", { name: tZh("judgment.desk.cite") })).toBeNull();
  });
});

describe("甲 · 灵魂栏的所在界域、审判方式、世次 / 种类", () => {
  const meta = (label: string) =>
    within(screen.getByRole("region", { name: tZh("judgment.queue.case") }))
      .getByText(label, { selector: "dt" })
      .nextElementSibling as HTMLElement;

  it("读 realm_name / judgment_method / cycle + kind;方式是译名,原始成员在 title", async () => {
    judgmentApi.get.mockResolvedValue({
      data: judgment({ realm_name: "第七殿 · 泰山王司", judgment_method: "HEART_WEIGHING", cycle: 3, kind: "AMENDMENT" }),
    });
    renderPage();
    await screen.findByText("第七殿 · 泰山王司");
    expect(meta(tZh("judgment.detail.current_realm"))).toHaveTextContent(/^第七殿 · 泰山王司$/);
    const method = meta(tZh("judgment.detail.method"));
    expect(method).toHaveTextContent(tZh("judgment.methods.HEART_WEIGHING"));
    expect(method.querySelector('[title="HEART_WEIGHING"]')).not.toBeNull();
    expect(method).not.toHaveTextContent(tZh("judgment.methods.STANDARD"));
    expect(screen.getByTestId("desk-life-kind")).toHaveTextContent(
      `${tZh("souls.detail.life_number", { n: "4" })} / ${tZh("judgment.claim.kinds.AMENDMENT")}`
    );
  });

  it("案号:只交给身份带的 caseNumber 槽,页头不再重复(用户 2026-10-02;CASE_NUMBER_POLICY)", async () => {
    const { PlaqueProvider } = await import("@/src/components/plaque/Plaque");
    const plaque = jest.fn();
    judgmentApi.get.mockResolvedValue({ data: judgment() });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PlaqueProvider value={plaque}>
          <JudgmentDetailPage params={Promise.resolve({ id: ID })} />
        </PlaqueProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(plaque).toHaveBeenLastCalledWith(expect.objectContaining({ caseNumber: "CN-2026-0042" })));
    expect(plaque).toHaveBeenLastCalledWith(expect.objectContaining({ meta: undefined }));
    // 页面本身(这里没有壳,身份带不在)一个案号也不画:可复制的那一个只在身份带右栏。
    expect(screen.queryByText(/CN-2026-0042/)).toBeNull();
    expect(document.querySelector("[data-case-number]")).toBeNull();
  });

  it("案子没挂界域:写「未记录」,不拿殿名充数", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ realm_name: null, judgment_method: "STANDARD", cycle: 0 }) });
    renderPage();
    await screen.findByTestId("desk-life-kind");
    const realmCell = meta(tZh("judgment.detail.current_realm"));
    expect(realmCell.querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    expect(realmCell).not.toHaveTextContent("第五殿");
    expect(screen.getByTestId("desk-life-kind")).toHaveTextContent(tZh("souls.detail.life_number", { n: "1" }));
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

  it("左栏窄(220–240 px)时功过账不在字中间断:按容器宽度退成两列,数字与单位不换行,标签不在字中间断", async () => {
    // jsdom 量不了宽度,所以断的是「防止断字的那套结构」:2026-10-01 1024 截图里「功/德」「权/重」一字一行,
    // 因为四列账挤在 220 px 里、数字格可以换行。
    renderPage();
    const ledger = await screen.findByTestId("balance-ledger");
    // 容器查询:看的是栏宽,不是视口(同一个面板在灵魂账页的宽卡片里仍是四列)。
    expect(ledger.parentElement).toHaveClass("@container");
    expect(ledger.className).toMatch(/(^| )grid-cols-\[minmax\(0,1fr\)_auto\]( |$)/);
    expect(ledger.className).toContain("@xs:grid-cols-[1fr_auto_auto_auto]");
    expect(ledger.className).not.toMatch(/(^| )grid-cols-\[1fr_auto_auto_auto\]( |$)/);
    const cells = Array.from(ledger.children) as HTMLElement[];
    // 四列账专有的格子(表头 4 + 每行两个空格子 × 3)在窄处不画。
    expect(cells.filter((c) => c.classList.contains("hidden") && c.classList.contains("@xs:block"))).toHaveLength(10);
    // 两列时剩下的 6 格:标签 3(break-keep)、数字 3(whitespace-nowrap,单位「权重」跟着不拆)。
    const shown = cells.filter((c) => !c.classList.contains("hidden"));
    expect(shown).toHaveLength(6);
    for (const name of [tZh("souls.detail.merit"), tZh("souls.detail.demerit"), tZh("souls.detail.balance")]) {
      expect(shown.find((c) => c.textContent === name)).toHaveClass("break-keep");
    }
    const figures = shown.filter((c) => /\d/.test(c.textContent ?? ""));
    expect(figures).toHaveLength(3);
    for (const f of figures) expect(f).toHaveClass("whitespace-nowrap", "text-right");
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

const record = (id: string, type: string, description: string, weight: number, over: Record<string, unknown> = {}) => ({
  id, type, category: "CHARITY", description, original_weight: weight, effective_weight: weight, years_elapsed: 0,
  decay_factor: 1, civilization: "CHINESE", recorded_at: "2026-06-02T00:00:00Z", event_date: null, is_milestone: false,
  statute_clause: "", occurrence_count: null, ...over,
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

  it("每行写条款、发生次数与重要节点;没记的不补(不当 1 次,条款写未记录)", async () => {
    soulsApi.karma.mockResolvedValue({
      data: {
        soul_id: "s-1", soul_name: "沈青梧", merit_score: 1284, demerit_score: 937, karmic_balance: 347, record_count: 2,
        records: [
          record("r1", "MERIT", "救溺 · 胥江", 120, { statute_clause: "救濟門#7:賑濟窮民百錢", occurrence_count: 12, is_milestone: true }),
          record("r3", "DEMERIT", "詈骂邻人", 25),
        ],
        reading: { kind: "BALANCE", civilization: "CHINESE", merit: 1284, demerit: 937, balance: 347 },
      },
    });
    renderPage();
    await screen.findAllByTestId("evidence-row");
    const cited = evidenceRow("救溺");
    const clause = within(cited).getByTestId("evidence-clause");
    expect(clause).toHaveTextContent("救濟門#7");
    expect(clause).not.toHaveTextContent("賑濟窮民百錢");
    expect(clause).toHaveAttribute("title", "救濟門#7:賑濟窮民百錢");
    // The clause opens its article in the corpus — the column and the narrow-width fold alike.
    const links = within(cited).getAllByRole("link", { name: "救濟門#7" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/corpus?code=%E6%95%91%E6%BF%9F%E9%96%80%237");
      expect(link).toHaveAttribute("title", "救濟門#7:賑濟窮民百錢");
    }
    expect(cited).toHaveTextContent(`${tZh("ledger.book.occurrences", { n: "12" })} · ◆ ${tZh("ledger.book.milestone")}`);

    const bare = evidenceRow("詈骂邻人");
    expect(within(bare).getByTestId("evidence-clause").querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    expect(within(bare).queryByRole("link")).toBeNull();
    expect(bare).not.toHaveTextContent(tZh("ledger.book.occurrences", { n: "1" }));
    expect(bare).not.toHaveTextContent("◆");
    expect(bare.querySelector("[data-record-facts]")).toBeNull();
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

/** 没选发落时,草稿里的发落三字段。 */
const NO_PLACEMENT = { draft_destination_realm_id: null, draft_term_years: null, draft_eternal: false };

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
    expect(judgmentApi.saveDraft).toHaveBeenCalledWith(ID, { version: 4, notes: "功过相抵", draft_verdict: "PURGATORY", ...NO_PLACEMENT });
    expect(await screen.findByText(tZh("judgment.draft.saved_at", { time: "2026-09-25T10:15:00Z" }))).toBeInTheDocument();

    // 下一次以服务端回来的版本为底。
    fireEvent.change(notesBox(), { target: { value: "功过相抵,暂入救济门" } });
    await waitFor(() => expect(judgmentApi.saveDraft).toHaveBeenCalledTimes(2), WAIT);
    expect(judgmentApi.saveDraft).toHaveBeenLastCalledWith(ID, { version: 5, notes: "功过相抵,暂入救济门", draft_verdict: "PURGATORY", ...NO_PLACEMENT });
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
    // 草稿带上的是页面上的裁决 —— 预选的待定。
    expect(judgmentApi.saveDraft).toHaveBeenLastCalledWith(ID, { version: 9, notes: "我的判词", draft_verdict: "PURGATORY", ...NO_PLACEMENT });
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
    await openLawTab();
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
  const conclude = concludeViaLayer;

  it("目的地只取所选裁决的候选(进来是预选的待定),标出占用与已满,默认项是自动分派", async () => {
    renderPage();
    await waitFor(() => expect(judgmentApi.destinations).toHaveBeenCalledWith(ID, "PURGATORY"));
    expect(judgmentApi.destinations).not.toHaveBeenCalledWith(ID, "FAILED");

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
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    expect(screen.queryByTestId("placement-draft")).toBeNull();
    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    expect(screen.getByTestId("placement-draft")).toHaveTextContent(tZh("judgment.placement.draft"));
    fireEvent.change(destinationBox(), { target: { value: "" } });
    expect(screen.queryByTestId("placement-draft")).toBeNull();
  });

  it("选了目的地与刑期就随结案发出;什么都不选,请求里没有这三个字段", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    await conclude();
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(1));
    expect(judgmentApi.conclude.mock.calls[0][1]).toEqual({ verdict: "FAILED", notes: "", create_workflow: false });
    // 落定后确认层翻成「已写入记录」;「完成」关层,回到页面上。
    fireEvent.click(await screen.findByRole("button", { name: tZh("judgment.desk.done") }));

    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    fireEvent.change(termBox(), { target: { value: "0x12" } }); // 非数字剥掉,前导零归掉
    expect(termBox().value).toBe("12");
    await conclude();
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(2));
    expect(judgmentApi.conclude.mock.calls[1][1]).toEqual({
      verdict: "FAILED", notes: "", create_workflow: false, destination_realm_id: "r-9", term_years: 12,
    });
  });

  it("换了裁决,为旧裁决选的发落就不再随请求发出", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    fireEvent.keyDown(document.body, { key: "3" });
    await waitFor(() => expect(judgmentApi.destinations).toHaveBeenCalledWith(ID, "PURGATORY"));
    expect(((await screen.findByLabelText(tZh("judgment.placement.destination"))) as HTMLSelectElement).value).toBe("");
    await conclude();
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(1));
    expect(judgmentApi.conclude.mock.calls[0][1]).not.toHaveProperty("destination_realm_id");
  });

  it("永恒只在能收永恒的目的地出现;勾上后不带刑期", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    expect(screen.queryByLabelText(tZh("judgment.placement.eternal"))).toBeNull();

    fireEvent.change(termBox(), { target: { value: "7" } });
    fireEvent.change(destinationBox(), { target: { value: "r-a" } });
    fireEvent.click(screen.getByLabelText(tZh("judgment.placement.eternal")));
    expect(termBox()).toBeDisabled();
    await conclude();
    await waitFor(() => expect(judgmentApi.conclude).toHaveBeenCalledTimes(1));
    expect(judgmentApi.conclude.mock.calls[0][1]).toEqual({
      verdict: "FAILED", notes: "", create_workflow: false, destination_realm_id: "r-a", eternal: true,
    });
  });

  it("realm_full:在这一节写「! 执行失败：目的地已满」,不弹通用 toast,并重取占用", async () => {
    judgmentApi.conclude.mockRejectedValue({ response: { status: 409, data: { error: "R9 is full (10/10)", code: "realm_full" } } });
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    const calls = judgmentApi.destinations.mock.calls.length;
    await conclude();
    const alert = await within(screen.getByTestId("placement")).findByRole("alert");
    expect(alert).toHaveTextContent(`! ${tZh("judgment.placement.errors.realm_full")}`);
    // 拒绝写在 戊 里,所以确认层收起 —— 盖着的话那条拒绝没人看得见。
    await waitFor(() => expect(screen.queryByTestId("confirm-layer")).toBeNull());
    expect(mockShowToast).not.toHaveBeenCalled();
    await waitFor(() => expect(judgmentApi.destinations.mock.calls.length).toBeGreaterThan(calls));
  });

  it("发落随判词草稿自动保存:同一个请求、同一个版本号;标题行写「已自动保存 HH:MM」", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ notes: "", draft_version: 4, draft_saved_at: null, draft_verdict: null }) });
    judgmentApi.saveDraft.mockResolvedValue({
      data: {
        notes: "", draft_verdict: "FAILED", draft_destination_realm_id: "r-9", draft_term_years: 12, draft_eternal: false,
        draft_version: 5, draft_saved_at: "2026-09-25T14:02:00Z",
      },
    });
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    fireEvent.change(termBox(), { target: { value: "12" } });
    await waitFor(() => expect(judgmentApi.saveDraft).toHaveBeenCalled(), WAIT);
    expect(judgmentApi.saveDraft).toHaveBeenLastCalledWith(ID, {
      version: 4, notes: "", draft_verdict: "FAILED", draft_destination_realm_id: "r-9", draft_term_years: 12, draft_eternal: false,
    });
    expect(await within(screen.getByTestId("placement")).findByTestId("placement-saved")).toHaveTextContent(
      tZh("judgment.draft.saved_at", { time: "2026-09-25T14:02:00Z" })
    );
  }, 15000);

  it("重开页面时还原存下的发落,挂「草稿」与保存时间", async () => {
    judgmentApi.get.mockResolvedValue({
      data: judgment({
        draft_verdict: "FAILED", draft_destination_realm_id: "r-9", draft_term_years: 12, draft_eternal: false,
        draft_version: 3, draft_saved_at: "2026-09-25T14:02:00Z",
      }),
    });
    renderPage();
    await waitFor(() => expect(destinationBox().value).toBe("r-9"));
    expect(termBox().value).toBe("12");
    expect(screen.getByTestId("placement-draft")).toBeInTheDocument();
    expect(screen.getByTestId("placement-saved")).toHaveTextContent(tZh("judgment.draft.saved_at", { time: "2026-09-25T14:02:00Z" }));
    // 还原不是编辑:不存。
    await new Promise((r) => setTimeout(r, 1500));
    expect(judgmentApi.saveDraft).not.toHaveBeenCalled();
  }, 15000);

  it("发落的 409 与判词一样:停下、冲突条;「改用对方的」连发落一起换成对方的", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ notes: "", draft_version: 4, draft_verdict: null }) });
    judgmentApi.saveDraft.mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: "draft conflict", code: "draft_conflict",
          current: {
            notes: "他人的判词", draft_verdict: "FAILED", draft_destination_realm_id: "r-7", draft_term_years: 30,
            draft_eternal: false, draft_version: 9, draft_saved_at: "2026-09-25T10:20:00Z",
          },
        },
      },
    });
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    await screen.findByLabelText(tZh("judgment.placement.destination"));
    fireEvent.change(destinationBox(), { target: { value: "r-9" } });
    const banner = await screen.findByTestId("draft-conflict", {}, WAIT);
    expect(screen.queryByTestId("placement-saved")).toBeNull();
    fireEvent.click(within(banner).getByRole("button", { name: tZh("judgment.draft.use_server") }));
    await waitFor(() => expect(termBox().value).toBe("30"));
    expect(destinationBox().value).toBe("r-7");
    await new Promise((r) => setTimeout(r, 1500));
    expect(judgmentApi.saveDraft).toHaveBeenCalledTimes(1);
  }, 15000);

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

/** 功過格 一条:救濟門 第六条。节号「救濟門 · 六」,规范引用〔太微仙君功過格 · 救濟門 · 六〕。 */
const JIUJI = {
  ...statute("st-9", "CN-GGG-J-06"),
  ordinal: 42,
  payload_json: { gate: "救濟門", gate_ordinal: 6 },
};
const JIUJI_CITE = `〔${tZh("judgment.statute_corpus.GONGGUOGE")} · 救濟門 · 六〕`;

describe("律条检索认得规范引用与裸节号", () => {
  beforeEach(() => {
    judgmentApi.statutes.mockImplementation((params: Record<string, string>) =>
      Promise.resolve({
        data: params.search
          ? { count: 0, next: null, previous: null, results: [] }
          : { count: 2, next: null, previous: null, results: [statute("st-7", "口業 · 七"), JIUJI] },
      })
    );
  });

  it.each([
    ["the corpus page's copied bracket", JIUJI_CITE],
    ["a bare sigil", "救濟門 · 六"],
    ["a bare sigil, spaced differently", "救濟門六"],
  ])("resolves %s to the article and cites it", async (_label, pasted) => {
    renderPage();
    await openLawTab();
    const box = await screen.findByPlaceholderText(tZh("judgment.desk.statute_search"));
    fireEvent.change(box, { target: { value: pasted } });
    await screen.findByText("条文 CN-GGG-J-06");
    // Only the resolved article — not the rest of the corpus, and no "no match".
    expect(screen.queryByText("条文 口業 · 七")).toBeNull();
    expect(screen.queryByText(tZh("judgment.desk.statute_search_empty"))).toBeNull();
    // A sigil is not a column: the server search is not asked.
    expect(judgmentApi.statutes).not.toHaveBeenCalledWith(expect.objectContaining({ search: pasted.trim() }));
    fireEvent.click(screen.getByRole("button", { name: tZh("judgment.desk.cite") }));
    await waitFor(() => expect(judgmentApi.cite).toHaveBeenCalledWith(ID, "st-9"));
  });

  it("an unknown bracket falls through to the server search and says nothing matched", async () => {
    renderPage();
    const box = await screen.findByPlaceholderText(tZh("judgment.desk.statute_search"));
    fireEvent.change(box, { target: { value: "〔不存在 · 九十九〕" } });
    await screen.findByText(tZh("judgment.desk.statute_search_empty"));
    expect(judgmentApi.cite).not.toHaveBeenCalled();
  });
});

describe("插入审判台的落点(?cite=)", () => {
  beforeEach(() => {
    judgmentApi.statute.mockResolvedValue({ data: JIUJI });
  });

  it("asks 引用〔…〕到 <魂> 的审判？ and cites only on confirm", async () => {
    mockSearch = "cite=st-9";
    renderPage();
    const message = tZh("judgment.desk.cite_from_corpus_confirm", { cite: JIUJI_CITE, soul: "沈青梧" });
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(judgmentApi.cite).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("judgment.desk.cite") }));
    await waitFor(() => expect(judgmentApi.cite).toHaveBeenCalledWith(ID, "st-9"));
    await waitFor(() => expect(screen.queryByText(message)).toBeNull());
  });

  it("cancel cites nothing", async () => {
    mockSearch = "cite=st-9";
    renderPage();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(judgmentApi.cite).not.toHaveBeenCalled();
  });

  it("a concluded case says it can no longer cite, and asks nothing", async () => {
    mockSearch = "cite=st-9";
    judgmentApi.get.mockResolvedValue({ data: judgment({ is_final: true, verdict: "PASSED" }) });
    renderPage();
    expect(await screen.findByTestId("cite-from-corpus-closed")).toHaveTextContent(
      tZh("judgment.desk.cite_from_corpus_closed")
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(judgmentApi.statute).not.toHaveBeenCalled();
  });

  it("without judgment.execute there is no prompt at all", async () => {
    mockSearch = "cite=st-9";
    mockUser = { ...mockUser, permissions: ["judgment.read"] };
    renderPage();
    await screen.findAllByRole("radio");
    await act(async () => {});
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(judgmentApi.statute).not.toHaveBeenCalled();
  });

  it("remembers the last opened OPEN case per user, and forgets it once concluded", async () => {
    const a = renderPage();
    await screen.findAllByRole("radio");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("soulledger_last_open_case:2") ?? "null")).toEqual({ id: ID, soul_name: "沈青梧" })
    );
    a.unmount();
    judgmentApi.get.mockResolvedValue({ data: judgment({ is_final: true, verdict: "PASSED" }) });
    renderPage();
    await waitFor(() => expect(localStorage.getItem("soulledger_last_open_case:2")).toBeNull());
  });
});

// ── v3 版式:当前这一判 / 资料舱 / 全案 / 盖印确认层 ─────────────────────────────

describe("v3 · 当前这一判", () => {
  it("没选过、没存过草稿的案子预选「◇ 待定」(v3),以展示字号写在中轴;预选不算动过,不自动保存", async () => {
    renderPage();
    const ruling = await screen.findByTestId("current-ruling");
    expect(ruling).toHaveClass("text-display-lg");
    await waitFor(() => expect(radio("PURGATORY").checked).toBe(true));
    expect(ruling).toHaveTextContent(`◇${tZh("judgment.verdicts.purgatory")}`);
    expect(ruling).not.toHaveTextContent(tZh("judgment.detail.select_verdict"));
    for (const v of ["PASSED", "FAILED", "RETRY"]) {
      expect(radio(v).checked).toBe(false);
      expect(ruling).not.toHaveTextContent(tZh(`judgment.verdicts.${v.toLowerCase()}`));
    }
    // 主按钮可用:预选的就是一个能落的判。
    expect(toConfirm()).toBeEnabled();

    fireEvent.keyDown(document.body, { key: "1" });
    expect(ruling).toHaveTextContent(`✓${tZh("judgment.verdicts.passed")}`);
    expect(ruling).not.toHaveTextContent(tZh("judgment.verdicts.purgatory"));
  });

  it("预选不触发自动保存;存过的草稿裁决优先于预选", async () => {
    const a = renderPage();
    await waitFor(() => expect(radio("PURGATORY").checked).toBe(true));
    await new Promise((r) => setTimeout(r, 1500));
    expect(judgmentApi.saveDraft).not.toHaveBeenCalled();
    a.unmount();

    judgmentApi.get.mockResolvedValue({ data: judgment({ draft_verdict: "RETRY", draft_version: 2 }) });
    renderPage();
    await waitFor(() => expect(radio("RETRY").checked).toBe(true));
    expect(radio("PURGATORY").checked).toBe(false);
  }, 15000);

  it("选中是墨底反白,不是颜色:只有选中的那一个键有墨底", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    const tile = (v: string) => radio(v).closest("label") as HTMLElement;
    expect(tile("FAILED").className).toContain("bg-[oklch(var(--color-ink))]");
    for (const v of ["PASSED", "PURGATORY", "RETRY"]) expect(tile(v).className).not.toContain("bg-[oklch(var(--color-ink))]");
    // 判决不靠颜色:任何一个键都不读判决色或文明色。
    for (const v of ["PASSED", "FAILED", "PURGATORY", "RETRY"]) expect(tile(v).className).not.toMatch(/--color-(verdict|main|civ)/);
  });

  it("键是 v3 的约 74 px(min-h-18.5);选中的那一个上移 6px 带 raised 阴影,别的不动;全案单列(52px)不上移", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    const tile = (v: string) => (radio(v).closest("label") as HTMLElement).className.split(/\s+/);
    for (const v of ["PASSED", "FAILED", "PURGATORY", "RETRY"]) expect(tile(v)).toContain("min-h-18.5");
    expect(tile("FAILED")).toEqual(expect.arrayContaining(["-translate-y-1.5", "shadow-raised", "duration-fast"]));
    for (const v of ["PASSED", "PURGATORY", "RETRY"]) {
      expect(tile(v)).not.toContain("-translate-y-1.5");
      expect(tile(v)).not.toContain("shadow-raised");
    }

    fireEvent.keyDown(document.body, { key: "f" });
    expect(screen.getByTestId("judgment-desk")).toHaveAttribute("data-view", "case");
    expect(tile("FAILED")).toContain("min-h-13");
    expect(tile("FAILED")).not.toContain("-translate-y-1.5");
  });
});

describe("v3 · 资料舱", () => {
  it("三个标签,默认功过记录;另两块挂着但 hidden,点哪个显示哪个,←/→ 走标签", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ confession: "吾一生未尝欺人" }) });
    renderPage();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      tZh("judgment.detail.confession"),
      tZh("judgment.desk.tab_evidence"),
      tZh("judgment.desk.tab_law"),
    ]);
    const panel = (m: string) => document.querySelector(`[data-material="${m}"]`) as HTMLElement;
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(panel("evidence")).not.toHaveAttribute("hidden");
    expect(panel("confession")).toHaveAttribute("hidden");
    expect(panel("law")).toHaveAttribute("hidden");

    fireEvent.click(tabs[0]);
    expect(panel("confession")).not.toHaveAttribute("hidden");
    expect(panel("evidence")).toHaveAttribute("hidden");
    expect(screen.getByText("吾一生未尝欺人")).toHaveClass("font-serif");

    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: tZh("judgment.desk.tab_law") })).toHaveAttribute("aria-selected", "true");
    expect(panel("law")).not.toHaveAttribute("hidden");
    expect(panel("confession")).toHaveAttribute("hidden");
  });
});

describe("v3 · 全案(F)", () => {
  const desk = () => screen.getByTestId("judgment-desk");
  const panel = (m: string) => document.querySelector(`[data-material="${m}"]`) as HTMLElement;

  it("F 展开:三块并置、标签条不画、灵魂与草稿收起;Esc 回聚焦;判词框里按 F 是写字", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(notesBox(), { key: "f" });
    expect(desk()).toHaveAttribute("data-view", "focus");

    fireEvent.keyDown(document.body, { key: "f" });
    expect(desk()).toHaveAttribute("data-view", "case");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    for (const m of ["confession", "evidence", "law"]) expect(panel(m)).not.toHaveAttribute("hidden");
    expect(document.getElementById("desk-draft")).toHaveClass("hidden");
    expect(document.getElementById("desk-soul")).toHaveClass("hidden");
    // 1–4 在全案里照样选判。
    fireEvent.keyDown(document.body, { key: "4" });
    expect(radio("RETRY").checked).toBe(true);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(desk()).toHaveAttribute("data-view", "focus");
    expect(document.getElementById("desk-draft")).not.toHaveClass("hidden");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    // 裁决还在:全案只是换栏,不卸载。
    expect(radio("RETRY").checked).toBe(true);
  });

  it("单栏(<768)不响应 F", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
    try {
      renderPage();
      await screen.findAllByRole("radio");
      fireEvent.keyDown(document.body, { key: "f" });
      expect(desk()).toHaveAttribute("data-view", "focus");
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("v3 · 盖印确认层", () => {
  it("写明所选裁决、签署殿司、不可撤回;Esc 关层、什么都不发,裁决还在", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "2" });
    fireEvent.click(toConfirm());
    const layer = await screen.findByTestId("confirm-layer");
    expect(layer).toHaveTextContent(tZh("judgment.desk.confirm_title"));
    // 句子里是译名,不是枚举键(第一版把 `judgment.verdicts.FAILED` 原样印了出来)。
    expect(layer).toHaveTextContent(tZh("judgment.desk.confirm_body", { verdict: tZh("judgment.verdicts.failed") }));
    expect(layer).not.toHaveTextContent("FAILED");
    expect(layer).toHaveTextContent(`✕${tZh("judgment.verdicts.failed")}`);
    expect(layer).not.toHaveTextContent(tZh("judgment.verdicts.passed"));
    expect(layer).toHaveTextContent(tZh("judgment.desk.signing_court"));
    expect(layer).toHaveTextContent("第五殿");
    expect(layer).toHaveTextContent(tZh("judgment.desk.irreversible"));

    fireEvent.keyDown(within(layer).getByRole("button", { name: tZh("judgment.desk.stamp") }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("confirm-layer")).toBeNull());
    expect(judgmentApi.conclude).not.toHaveBeenCalled();
    expect(radio("FAILED").checked).toBe(true);
  });

  it("盖印并结案 → 同一层翻成「已写入记录」并落印;「完成」关层", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    fireEvent.keyDown(document.body, { key: "1" });
    await concludeViaLayer();
    const layer = await screen.findByTestId("confirm-layer");
    expect(await within(layer).findByText(tZh("judgment.desk.recorded"))).toBeInTheDocument();
    expect(within(layer).getByRole("img", { name: tZh("seal.aria", { court: "第五殿" }) })).toBeInTheDocument();
    expect(within(layer).queryByRole("button", { name: tZh("judgment.desk.stamp") })).toBeNull();
    fireEvent.click(within(layer).getByRole("button", { name: tZh("judgment.desk.done") }));
    await waitFor(() => expect(screen.queryByTestId("confirm-layer")).toBeNull());
  });
});

describe("v3 · 草稿与批注开关(768–1279)", () => {
  const draftSection = () => document.getElementById("desk-draft") as HTMLElement;
  const toggle = () => screen.getByTestId("draft-toggle");
  const CONFLICT = {
    response: {
      status: 409,
      data: {
        error: "draft conflict", code: "draft_conflict",
        current: { notes: "他人的判词", draft_verdict: "PASSED", draft_version: 9, draft_saved_at: "2026-09-25T10:20:00Z" },
      },
    },
  };

  it("默认收起(md:max-xl:hidden),点开排到资料舱上面;收起时判词框仍挂着,打的字不丢", async () => {
    renderPage();
    await screen.findAllByRole("radio");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveAttribute("aria-controls", "desk-draft");
    expect(draftSection()).toHaveClass("md:max-xl:hidden");
    // 收着也挂着:判词框在 DOM 里,能写,写了会存。
    fireEvent.change(notesBox(), { target: { value: "收着写" } });

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(draftSection()).not.toHaveClass("md:max-xl:hidden");
    expect(draftSection()).toHaveClass("md:order-3");
    expect(notesBox().value).toBe("收着写");

    fireEvent.click(toggle());
    expect(draftSection()).toHaveClass("md:max-xl:hidden");
    expect(notesBox().value).toBe("收着写");
  });

  it("有没存上的改动挂 ◐,存上后摘掉;409 冲突挂 !", async () => {
    let resolveSave: (_v: unknown) => void = () => {};
    judgmentApi.saveDraft.mockImplementationOnce(() => new Promise((r) => { resolveSave = r; }));
    renderPage();
    await screen.findAllByRole("radio");
    expect(screen.queryByTestId("draft-toggle-mark")).toBeNull();

    fireEvent.change(notesBox(), { target: { value: "改了" } });
    expect(screen.getByTestId("draft-toggle-mark")).toHaveTextContent("◐");
    expect(screen.getByTestId("draft-toggle-mark")).toHaveTextContent(tZh("judgment.desk.draft_unsaved"));
    await waitFor(() => expect(judgmentApi.saveDraft).toHaveBeenCalledTimes(1), WAIT);
    expect(screen.getByTestId("draft-toggle-mark")).toHaveTextContent("◐"); // 正在存,还没存上
    await act(async () => resolveSave({ data: { notes: "改了", draft_verdict: "PURGATORY", draft_version: 1, draft_saved_at: "2026-09-25T10:21:00Z" } }));
    await waitFor(() => expect(screen.queryByTestId("draft-toggle-mark")).toBeNull());

    judgmentApi.saveDraft.mockRejectedValueOnce(CONFLICT);
    fireEvent.change(notesBox(), { target: { value: "又改了" } });
    await screen.findByTestId("draft-conflict", {}, WAIT);
    expect(screen.getByTestId("draft-toggle-mark")).toHaveTextContent("!");
    expect(screen.getByTestId("draft-toggle-mark")).toHaveTextContent(tZh("judgment.desk.draft_conflict"));
  }, 15000);

  it("已结案没有开关,判词照常摊开", async () => {
    judgmentApi.get.mockResolvedValue({ data: judgment({ is_final: true, verdict: "PASSED", notes: "定" }) });
    renderPage();
    await screen.findByText(tZh("judgment.detail.final"));
    expect(screen.queryByTestId("draft-toggle")).toBeNull();
    expect(draftSection()).not.toHaveClass("md:max-xl:hidden");
  });

  it("realm_full 被拒:确认层收起,草稿栏自己展开(拒绝写在 戊 里)", async () => {
    judgmentApi.conclude.mockRejectedValue({ response: { status: 409, data: { error: "full", code: "realm_full" } } });
    renderPage();
    await screen.findAllByRole("radio");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    await concludeViaLayer();
    await waitFor(() => expect(screen.queryByTestId("confirm-layer")).toBeNull());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(draftSection()).not.toHaveClass("md:max-xl:hidden");
  });
});
