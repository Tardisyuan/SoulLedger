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

jest.mock("@soulledger/core/api/soul-inbox", () => ({
  soulInboxApi: { list: jest.fn(), messages: jest.fn(), reply: jest.fn() },
}));
const { soulInboxApi: apiMock } = jest.requireMock("@soulledger/core/api/soul-inbox") as {
  soulInboxApi: Record<string, jest.Mock>;
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
  created_at: "2026-09-18T00:00:00Z",
  closed_at: null,
  ...over,
});
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
  renderPage();
  expect(await screen.findByText(tZh("soul_inbox.empty"))).toBeInTheDocument();
  expect(apiMock.messages).not.toHaveBeenCalled();
});

// ── 设计稿 C · 09:三栏、文件夹、待回复、收起、`/` 援引 ──

it("folders are what the API can answer: closed ones filter to the reborn, with true counts", async () => {
  asRole("soul_inbox.read");
  apiMock.list.mockResolvedValue(
    page([conversation(), conversation({ id: "c2", soul_name: "李四", closed_at: "2026-09-18T02:00:00Z" })])
  );
  renderPage();
  const folders = await screen.findByRole("navigation", { name: tZh("soul_inbox.folders") });
  const closed = within(folders).getByRole("button", { name: new RegExp(tZh("soul_inbox.folder.closed")) });
  expect(closed).toHaveTextContent("1");
  fireEvent.click(closed);
  const list = screen.getByRole("list", { name: tZh("soul_inbox.list_label") });
  expect(within(list).getByRole("button", { name: /李四/ })).toBeInTheDocument();
  // Absence: the open one is filtered out, not merely re-ordered.
  expect(within(list).queryByRole("button", { name: /张三/ })).toBeNull();
});

it("derived counts are withheld when the first page is not the whole inbox", async () => {
  asRole("soul_inbox.read");
  apiMock.list.mockResolvedValue({ data: { count: 45, next: "p2", previous: null, results: [conversation()] } });
  renderPage();
  const folders = await screen.findByRole("navigation", { name: tZh("soul_inbox.folders") });
  expect(within(folders).getByRole("button", { name: new RegExp(tZh("soul_inbox.folder.all")) })).toHaveTextContent("45");
  expect(within(folders).getByRole("button", { name: new RegExp(tZh("soul_inbox.folder.open")) })).toHaveTextContent(
    new RegExp(`^${tZh("soul_inbox.folder.open")}$`)
  );
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
    data: { results: [{ id: "st1", code: "GGX-17", display_title: "救濟門 · 十七", display_text: "" }] },
  });
  renderPage();
  const thread = await openThread();
  const box = within(thread).getByLabelText(tZh("soul_inbox.reply_label")) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: "依 /救濟" } });
  await within(thread).findByRole("option", { name: /GGX-17/ });
  expect(judgmentMock.statutes).toHaveBeenCalledWith({ search: "救濟" });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(box.value).toBe("依 〔GGX-17 · 救濟門 · 十七〕");
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
