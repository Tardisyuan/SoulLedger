/**
 * app/soul-inbox/page.tsx — the hall inbox (officer side of soul chat).
 *
 * Same harness as ModerationPage.test.tsx: `RequirePermission` / `usePermissions`
 * run for real against a stubbed `useTenant`, copy is the real zh-Hans bundle,
 * the API module is the only thing stubbed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulInboxPage from "@/app/soul-inbox/page";
import { tZh } from "./support/zhBundle";

// 只换掉网络那一层;`renderTemplate` 与占位符表用真的 —— 模板替换正是被测的行为。
jest.mock("@soulledger/core/api/soul-inbox", () => ({
  ...jest.requireActual("@soulledger/core/api/soul-inbox"),
  soulInboxApi: {
    list: jest.fn(), folders: jest.fn(), messages: jest.fn(), reply: jest.fn(), markRead: jest.fn(),
    archive: jest.fn(), unarchive: jest.fn(), draft: jest.fn(), saveDraft: jest.fn(), clearDraft: jest.fn(),
    assign: jest.fn(), unassign: jest.fn(), assignable: jest.fn(),
  },
  inboxTemplatesApi: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
}));
const { soulInboxApi: apiMock, inboxTemplatesApi: templatesMock } = jest.requireMock("@soulledger/core/api/soul-inbox") as {
  soulInboxApi: Record<string, jest.Mock>;
  inboxTemplatesApi: Record<string, jest.Mock>;
};
// 回复框的 `/` 律条检索走 judgmentApi.statutes;其余照旧用真模块。
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  judgmentApi: { statutes: jest.fn() },
}));
const { judgmentApi: judgmentMock } = jest.requireMock("@soulledger/core/api") as {
  judgmentApi: Record<string, jest.Mock>;
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const mockI18n = { t: tZh, formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true };
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const conversation = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  soul: "s1",
  soul_name: "张三",
  soul_code: "ABCDEFGHJK",
  tenant: 1,
  tenant_name: "中国地府",
  hall_names: { "zh-Hans": "第五殿", en: "The Fifth Court", egy: "Yanluo Qedi" },
  last_message_at: "2026-09-18T01:00:00Z",
  last_soul_message_at: "2026-09-18T00:30:00Z",
  last_from: "hall",
  unread: false,
  has_draft: false,
  archived: false,
  assignee: null,
  assigned_at: null,
  created_at: "2026-09-18T00:00:00Z",
  closed_at: null,
  ...over,
});
const COUNTS = {
  all: 1, awaiting_reply: 0, replied: 1, drafts: 0, archived: 0, assigned_to_me: 0, unread: 0, open: 1, closed: 0,
  halls: [{ tenant: 1, hall_names: { "zh-Hans": "第五殿", en: "The Fifth Court", egy: "Yanluo Qedi" }, count: 1 }],
};
const noDraft = { data: { last_read_at: null, archived_at: null, draft: "", draft_saved_at: null } };
// 接口新的在前。
const MESSAGES = [
  { event_id: "$2", from_officer: true, sender_name: "崔珏", officer_title: "判官", body: "已收到", timestamp: 2000 },
  { event_id: "$1", from_officer: false, sender_name: "张三", officer_title: "", body: "我想申诉", timestamp: 1000 },
];
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<SoulInboxPage />, { wrapper: Wrapper });
}

const asRole = (...permissions: string[]) => (mockUser = { id: 2, username: "op", role: "MODERATOR", permissions });

async function openThread() {
  fireEvent.click(await screen.findByRole("button", { name: /张三/ }));
  return (await screen.findByRole("region", { name: tZh("soul_inbox.thread_label", { name: "张三" }) })) as HTMLElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.list.mockResolvedValue(page([conversation()]));
  apiMock.messages.mockResolvedValue({ data: MESSAGES });
  apiMock.reply.mockResolvedValue({ data: { event_id: "$3" } });
  apiMock.folders.mockResolvedValue({ data: COUNTS });
  apiMock.markRead.mockResolvedValue(noDraft);
  apiMock.archive.mockResolvedValue(noDraft);
  apiMock.unarchive.mockResolvedValue(noDraft);
  apiMock.draft.mockResolvedValue(noDraft);
  apiMock.saveDraft.mockImplementation((_id: string, body: string) =>
    Promise.resolve({ data: { ...noDraft.data, draft: body.trim() ? body : "", draft_saved_at: "2026-09-18T03:00:00Z" } })
  );
  templatesMock.list.mockResolvedValue({ data: [] });
});

it("refuses the page without soul_inbox.read and asks the API nothing", () => {
  asRole("soul.read", "social.moderate");
  renderPage();
  expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
  expect(apiMock.list).not.toHaveBeenCalled();
});

it("reads a thread oldest first, marking the hall's replies", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply");
  renderPage();
  const thread = await openThread();
  expect(apiMock.messages).toHaveBeenCalledWith("c1");
  const items = await within(thread).findAllByRole("listitem");
  expect(items.map((li) => li.getAttribute("data-event-id"))).toEqual(["$1", "$2"]);
  // 署名:殿司展示名(不是租户管理名)· 职位 · 官员。灵魂的信没有这一行。
  expect(within(items[1]).getByText(/第五殿 · 判官 崔珏/)).toBeInTheDocument();
  expect(within(items[0]).queryByText(/第五殿 ·/)).toBeNull();
  expect(screen.queryByText(/中国地府/)).toBeNull();
});

it("replies with the typed text", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply");
  renderPage();
  const thread = await openThread();
  fireEvent.change(within(thread).getByLabelText(tZh("soul_inbox.reply_label")), { target: { value: "已受理" } });
  fireEvent.click(within(thread).getByRole("button", { name: tZh("soul_inbox.send") }));
  await waitFor(() => expect(apiMock.reply).toHaveBeenCalledWith("c1", "已受理"));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_inbox.sent"), "success"));
});

it("read without reply: the thread shows, the reply box does not", async () => {
  asRole("soul_inbox.read");
  renderPage();
  const thread = await openThread();
  await within(thread).findByText("我想申诉");
  expect(within(thread).queryByLabelText(tZh("soul_inbox.reply_label"))).toBeNull();
});

it("a closed conversation (the soul was reborn) is read-only and says so", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply");
  apiMock.list.mockResolvedValue(page([conversation({ closed_at: "2026-09-18T02:00:00Z" })]));
  renderPage();
  const thread = await openThread();
  await within(thread).findByText("我想申诉");
  expect(within(thread).getByText(tZh("soul_inbox.closed"))).toBeInTheDocument();
  expect(within(thread).queryByLabelText(tZh("soul_inbox.reply_label"))).toBeNull();
});

it("a refusal says what the server's code means", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply");
  apiMock.reply.mockRejectedValue(http(503, { detail: "x", code: "chat_unavailable" }));
  renderPage();
  const thread = await openThread();
  fireEvent.change(within(thread).getByLabelText(tZh("soul_inbox.reply_label")), { target: { value: "x" } });
  fireEvent.click(within(thread).getByRole("button", { name: tZh("soul_inbox.send") }));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_inbox.errors.chat_unavailable"), "error"));
});

it("an empty inbox says so and asks for no thread", async () => {
  asRole("soul_inbox.read");
  apiMock.list.mockResolvedValue(page([]));
  apiMock.folders.mockResolvedValue({ data: { ...COUNTS, all: 0, replied: 0, open: 0, halls: [] } });
  renderPage();
  expect(await screen.findByText(tZh("soul_inbox.empty"))).toBeInTheDocument();
  expect(apiMock.messages).not.toHaveBeenCalled();
});

// ── 设计稿 C · 09:三栏、文件夹、待回复、收起、`/` 援引 ──

it("folder counts are the server's totals, and a folder asks the server for its rows", async () => {
  asRole("soul_inbox.read");
  // 第一页只回一行,计数却是 5 / 12:计数来自 `folders/`,不是数这一页。
  apiMock.folders.mockResolvedValue({ data: { ...COUNTS, all: 12, awaiting_reply: 5, drafts: 1, closed: 2 } });
  renderPage();
  const folders = await screen.findByRole("navigation", { name: tZh("soul_inbox.folders") });
  const button = (key: string) => within(folders).getByRole("button", { name: new RegExp(`^${tZh(key)}`) });
  await waitFor(() => expect(button("soul_inbox.folder.awaiting_reply")).toHaveTextContent("5"));
  expect(button("soul_inbox.folder.all")).toHaveTextContent("12");
  expect(button("soul_inbox.folder.drafts")).toHaveTextContent("1");
  expect(button("soul_inbox.folder.closed")).toHaveTextContent("2");
  expect(apiMock.list).toHaveBeenLastCalledWith({ page: 1, folder: "all" });

  fireEvent.click(button("soul_inbox.folder.awaiting_reply"));
  await waitFor(() => expect(apiMock.list).toHaveBeenLastCalledWith({ page: 1, folder: "awaiting_reply" }));
  expect(screen.getByText(tZh("soul_inbox.oldest_first"))).toBeInTheDocument();
  expect(screen.queryByText(tZh("soul_inbox.newest_first"))).toBeNull();

  fireEvent.click(button("soul_inbox.folder.closed"));
  await waitFor(() => expect(apiMock.list).toHaveBeenLastCalledWith({ page: 1, folder: "all", status: "closed" }));
  fireEvent.click(within(folders).getByRole("button", { name: /^第五殿/ }));
  await waitFor(() => expect(apiMock.list).toHaveBeenLastCalledWith({ page: 1, folder: "all", hall: 1 }));
});

it("an unread row is bold with a marker; opening it marks it read and the marker goes", async () => {
  asRole("soul_inbox.read");
  apiMock.list.mockResolvedValue(
    page([conversation({ unread: true }), conversation({ id: "c2", soul_name: "李四", unread: false })])
  );
  renderPage();
  const unreadRow = await screen.findByRole("button", { name: /张三/ });
  expect(unreadRow).toHaveAttribute("data-unread", "true");
  expect(within(unreadRow).getByText(tZh("soul_inbox.unread"))).toBeInTheDocument();
  expect(within(unreadRow).getByText("张三")).toHaveClass("font-semibold");
  // 缺席:读过的那一行没有标记、不加粗。
  const readRow = screen.getByRole("button", { name: /李四/ });
  expect(readRow).not.toHaveAttribute("data-unread");
  expect(within(readRow).queryByText(tZh("soul_inbox.unread"))).toBeNull();
  expect(within(readRow).getByText("李四")).not.toHaveClass("font-semibold");

  apiMock.list.mockResolvedValue(page([conversation({ unread: false }), conversation({ id: "c2", soul_name: "李四" })]));
  const thread = await openThread();
  await within(thread).findByText("我想申诉");
  await waitFor(() => expect(apiMock.markRead).toHaveBeenCalledWith("c1"));
  expect(apiMock.markRead).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole("button", { name: /张三/ })).not.toHaveAttribute("data-unread"));
  expect(within(screen.getByRole("button", { name: /张三/ })).queryByText(tZh("soul_inbox.unread"))).toBeNull();
});

it("opening a thread that is already read does not mark it again", async () => {
  asRole("soul_inbox.read");
  renderPage();
  const thread = await openThread();
  await within(thread).findByText("我想申诉");
  expect(apiMock.markRead).not.toHaveBeenCalled();
});

it("the draft is restored from the server after a reload", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply");
  apiMock.draft.mockResolvedValue({ data: { ...noDraft.data, draft: "上次没写完", draft_saved_at: "2026-09-18T02:00:00Z" } });
  const first = renderPage();
  let thread = await openThread();
  const box = () => within(thread).getByLabelText(tZh("soul_inbox.reply_label")) as HTMLTextAreaElement;
  await waitFor(() => expect(box().value).toBe("上次没写完"));
  first.unmount();

  renderPage(); // 新的 QueryClient = 重新加载页面
  thread = await openThread();
  await waitFor(() => expect(box().value).toBe("上次没写完"));
  expect(within(thread).getByText(tZh("soul_inbox.draft_saved", { time: "dt(2026-09-18T02:00:00Z)" }))).toBeInTheDocument();
  // 恢复不是一次保存。
  expect(apiMock.saveDraft).not.toHaveBeenCalled();
});

it("typing saves the draft after a pause, and blur saves at once", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply");
  renderPage();
  const thread = await openThread();
  await waitFor(() => expect(apiMock.draft).toHaveBeenCalledWith("c1"));
  const box = within(thread).getByLabelText(tZh("soul_inbox.reply_label"));
  fireEvent.change(box, { target: { value: "来信收悉" } });
  expect(apiMock.saveDraft).not.toHaveBeenCalled();
  await waitFor(() => expect(apiMock.saveDraft).toHaveBeenCalledWith("c1", "来信收悉"), { timeout: 2500 });
  expect(apiMock.saveDraft).toHaveBeenCalledTimes(1);

  fireEvent.change(box, { target: { value: "来信收悉,依律" } });
  fireEvent.focusOut(box); // React 的 onBlur 听的是 focusout
  // 失焦立即存,不等 1 秒:超时比防抖短,于是这里绿只能是失焦存的。
  await waitFor(() => expect(apiMock.saveDraft).toHaveBeenLastCalledWith("c1", "来信收悉,依律"), { timeout: 500 });
  await within(thread).findByText(tZh("soul_inbox.draft_saved", { time: "dt(2026-09-18T03:00:00Z)" }));
});

it("a closed thread asks for no draft and saves none", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply");
  apiMock.list.mockResolvedValue(page([conversation({ closed_at: "2026-09-18T02:00:00Z" })]));
  renderPage();
  const thread = await openThread();
  await within(thread).findByText("我想申诉");
  expect(apiMock.draft).not.toHaveBeenCalled();
  expect(templatesMock.list).not.toHaveBeenCalled();
  expect(within(thread).queryByRole("button", { name: tZh("soul_inbox.save_draft") })).toBeNull();
});

it("a template is filled with the soul's and the hall's name and inserted", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply");
  templatesMock.list.mockResolvedValue({
    data: [{ id: "t1", title: "收悉", body: "{{soul_name}}:{{ hall_name }}已收悉。", created_at: "", updated_at: "" }],
  });
  renderPage();
  const thread = await openThread();
  const picker = await within(thread).findByRole("combobox", { name: tZh("soul_inbox.template.pick") });
  await within(picker).findByRole("option", { name: "收悉" });
  fireEvent.change(picker, { target: { value: "t1" } });
  const box = within(thread).getByLabelText(tZh("soul_inbox.reply_label")) as HTMLTextAreaElement;
  expect(box.value).toBe("张三:第五殿已收悉。");
  expect(box.value).not.toMatch(/\{\{/);
  expect(apiMock.reply).not.toHaveBeenCalled();
});

it("archive and move back call the endpoints for this thread", async () => {
  asRole("soul_inbox.read");
  renderPage();
  const thread = await openThread();
  fireEvent.click(within(thread).getByRole("button", { name: tZh("soul_inbox.archive") }));
  await waitFor(() => expect(apiMock.archive).toHaveBeenCalledWith("c1"));
  expect(apiMock.unarchive).not.toHaveBeenCalled();
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_inbox.archived_done"), "success"));
});

it("an archived thread offers to move it back", async () => {
  asRole("soul_inbox.read");
  apiMock.list.mockResolvedValue(page([conversation({ archived: true })]));
  renderPage();
  const thread = await openThread();
  fireEvent.click(within(thread).getByRole("button", { name: tZh("soul_inbox.unarchive") }));
  await waitFor(() => expect(apiMock.unarchive).toHaveBeenCalledWith("c1"));
  expect(apiMock.archive).not.toHaveBeenCalled();
});

it("pages through the server's pages", async () => {
  asRole("soul_inbox.read");
  apiMock.list.mockResolvedValue({ data: { count: 45, next: "p2", previous: null, results: [conversation()] } });
  renderPage();
  await screen.findByRole("button", { name: /张三/ });
  expect(screen.getByText(tZh("pagination.info", { page: "1", total: "3", count: "45" }))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: new RegExp(tZh("common.next")) }));
  await waitFor(() => expect(apiMock.list).toHaveBeenLastCalledWith({ page: 2, folder: "all" }));
});

it("one page of rows draws no pager", async () => {
  asRole("soul_inbox.read");
  renderPage();
  await screen.findByRole("button", { name: /张三/ });
  expect(screen.queryByRole("button", { name: new RegExp(tZh("common.next")) })).toBeNull();
});

it("a thread whose last letter is the soul's says it awaits a reply; one the hall answered last does not", async () => {
  asRole("soul_inbox.read");
  apiMock.messages.mockResolvedValue({ data: [...MESSAGES].reverse() });
  renderPage();
  const thread = await openThread();
  await within(thread).findByText("我想申诉");
  expect(within(thread).getByText(/^待回复 · \d+ 天$/)).toBeInTheDocument();
});

it("the hall's reply being last leaves no awaiting badge", async () => {
  asRole("soul_inbox.read");
  renderPage();
  const thread = await openThread();
  await within(thread).findByText("我想申诉");
  expect(within(thread).queryByText(/^待回复 · /)).toBeNull();
});

it("letters before the previous one are folded behind a count", async () => {
  asRole("soul_inbox.read");
  apiMock.messages.mockResolvedValue({
    data: [
      { event_id: "$3", from_officer: false, sender_name: "张三", officer_title: "", body: "第三封", timestamp: 3000 },
      ...MESSAGES,
    ],
  });
  renderPage();
  const thread = await openThread();
  await within(thread).findByText("第三封");
  expect(within(thread).getAllByRole("listitem").map((li) => li.getAttribute("data-event-id"))).toEqual(["$2", "$3"]);
  fireEvent.click(within(thread).getByRole("button", { name: tZh("soul_inbox.earlier", { n: "1" }) }));
  expect(within(thread).getAllByRole("listitem").map((li) => li.getAttribute("data-event-id"))).toEqual(["$1", "$2", "$3"]);
});

it("`/` in the reply searches statutes and Enter writes the citation into the text", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply", "judgment.read");
  judgmentMock.statutes.mockResolvedValue({
    data: {
      results: [
        {
          id: "st1",
          code: "GGX-17",
          civilization: "CHINESE",
          corpus: "GONGGUOGE",
          ordinal: 17,
          payload_json: { gate: "救濟門", gate_ordinal: 17 },
          display_title: "救濟門 · 十七",
          display_text: "",
        },
      ],
    },
  });
  renderPage();
  const thread = await openThread();
  const box = within(thread).getByLabelText(tZh("soul_inbox.reply_label")) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: "依 /救濟" } });
  await within(thread).findByRole("option", { name: /GGX-17/ });
  expect(judgmentMock.statutes).toHaveBeenCalledWith({ search: "救濟" });
  fireEvent.keyDown(box, { key: "Enter" });
  // The canonical 〔文献 · 条号〕 bracket — the corpus page's — not 〔code · title〕.
  expect(box.value).toBe(`依 〔${tZh("judgment.statute_corpus.GONGGUOGE")} · 救濟門 · 十七〕`);
  expect(box.value).not.toContain("GGX-17");
  expect(apiMock.reply).not.toHaveBeenCalled();
});

it("without judgment.read, `/` is only a character: no search, no hint", async () => {
  asRole("soul_inbox.read", "soul_inbox.reply");
  renderPage();
  const thread = await openThread();
  fireEvent.change(within(thread).getByLabelText(tZh("soul_inbox.reply_label")), { target: { value: "/救濟" } });
  expect(within(thread).queryByRole("listbox")).toBeNull();
  expect(within(thread).queryByText(tZh("soul_inbox.cite_hint"))).toBeNull();
  expect(judgmentMock.statutes).not.toHaveBeenCalled();
});

describe("标给同僚", () => {
  const OFFICERS = [
    { user_id: 2, display_name: "我自己" },
    { user_id: 7, display_name: "钟馗" },
  ];

  it("hands the thread to the picked colleague and shows the assignee in the header", async () => {
    asRole("soul_inbox.read", "soul_inbox.reply");
    apiMock.assignable.mockResolvedValue({ data: OFFICERS });
    apiMock.assign.mockResolvedValue({ data: conversation({ assignee: { user_id: 7, display_name: "钟馗" } }) });
    renderPage();
    const thread = await openThread();
    expect(within(thread).queryByTestId("thread-assignee")).toBeNull();
    fireEvent.click(within(thread).getByRole("button", { name: tZh("soul_inbox.assign.action") }));
    const dialog = await screen.findByRole("dialog", { name: tZh("soul_inbox.assign.title") });
    await waitFor(() => expect(apiMock.assignable).toHaveBeenCalledWith("c1"));
    const select = await within(dialog).findByRole("combobox", { name: tZh("soul_inbox.assign.to") });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(select, { target: { value: "7" } });
    apiMock.list.mockResolvedValue(page([conversation({ assignee: { user_id: 7, display_name: "钟馗" } })]));
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_inbox.assign.confirm") }));
    await waitFor(() => expect(apiMock.assign).toHaveBeenCalledWith("c1", 7));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_inbox.assign.done", { name: "钟馗" }), "success")
    );
    expect(await within(thread).findByTestId("thread-assignee")).toHaveTextContent(
      tZh("soul_inbox.assign.assignee", { name: "钟馗" })
    );
  });

  it("an invalid assignee is told in words, not as a raw code", async () => {
    asRole("soul_inbox.read", "soul_inbox.reply");
    apiMock.assignable.mockResolvedValue({ data: OFFICERS });
    apiMock.assign.mockRejectedValue(http(400, { detail: "x", code: "invalid_assignee" }));
    renderPage();
    const thread = await openThread();
    fireEvent.click(within(thread).getByRole("button", { name: tZh("soul_inbox.assign.action") }));
    const dialog = await screen.findByRole("dialog", { name: tZh("soul_inbox.assign.title") });
    await within(dialog).findByRole("combobox", { name: tZh("soul_inbox.assign.to") });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_inbox.assign.confirm") }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_inbox.errors.invalid_assignee"), "error")
    );
  });

  it("take back clears the assignee", async () => {
    asRole("soul_inbox.read", "soul_inbox.reply");
    apiMock.list.mockResolvedValue(page([conversation({ assignee: { user_id: 7, display_name: "钟馗" } })]));
    apiMock.unassign.mockResolvedValue({ data: conversation() });
    renderPage();
    const thread = await openThread();
    fireEvent.click(within(thread).getByRole("button", { name: tZh("soul_inbox.assign.unassign") }));
    await waitFor(() => expect(apiMock.unassign).toHaveBeenCalledWith("c1"));
  });

  it("read-only officers see the assignee but cannot hand it on", async () => {
    asRole("soul_inbox.read");
    apiMock.list.mockResolvedValue(page([conversation({ assignee: { user_id: 7, display_name: "钟馗" } })]));
    renderPage();
    const thread = await openThread();
    expect(within(thread).getByTestId("thread-assignee")).toBeInTheDocument();
    expect(within(thread).queryByRole("button", { name: tZh("soul_inbox.assign.action") })).toBeNull();
    expect(within(thread).queryByRole("button", { name: tZh("soul_inbox.assign.unassign") })).toBeNull();
  });

  it("「交给我的」 is a folder with the server's count, and asks the server for its rows", async () => {
    asRole("soul_inbox.read");
    apiMock.folders.mockResolvedValue({ data: { ...COUNTS, assigned_to_me: 3 } });
    renderPage();
    const nav = await screen.findByRole("navigation", { name: tZh("soul_inbox.folders") });
    const folder = await within(nav).findByRole("button", { name: new RegExp(tZh("soul_inbox.folder.assigned_to_me")) });
    await waitFor(() => expect(folder).toHaveTextContent("3"));
    fireEvent.click(folder);
    await waitFor(() => expect(apiMock.list).toHaveBeenLastCalledWith({ page: 1, folder: "assigned_to_me" }));
  });
});
