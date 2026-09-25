/**
 * app/moderation/page.tsx — the officer side of the soul circle, four segments
 * (举报 / 敏感词 / 禁言 / 已处理, C 组 08 + E 组 08b / 08c / 08d).
 *
 * `RequirePermission` / `usePermissions` run for real against a stubbed
 * `useTenant` (SchedulerPage.test.tsx says why). Copy is the real zh-Hans
 * bundle, so a key the page asks for that the bundle lacks shows up as a miss.
 * The API module is the only thing stubbed.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ModerationPage from "@/app/moderation/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api/social-moderation", () => ({
  socialModerationApi: {
    reports: jest.fn(),
    resolveReport: jest.fn(),
    content: jest.fn(),
    item: jest.fn(),
    act: jest.fn(),
    words: jest.fn(),
    addWord: jest.fn(),
    removeWord: jest.fn(),
    removeWords: jest.fn(),
    updateWord: jest.fn(),
    updateWords: jest.fn(),
    handled: jest.fn(),
    mutes: jest.fn(),
    liftMute: jest.fn(),
  },
}));
const { socialModerationApi: apiMock } = jest.requireMock("@soulledger/core/api/social-moderation") as {
  socialModerationApi: Record<string, jest.Mock>;
};

let mockUser: Record<string, unknown> | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const mockI18n = { t: tZh, formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true };
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const author = { user_id: 7, display_name: "王五" };
const report = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  target_type: "POST",
  post: "p1",
  comment: null,
  target_user: author,
  status: "OPEN",
  report_count: 3,
  content_excerpt: "被举报的帖子摘录",
  content_status: "PUBLISHED",
  entries: [{ reporter: { user_id: 8, display_name: "举报人" }, reason: "ABUSE", detail: "骂人", created_at: "2026-09-18T02:00:00Z" }],
  created_at: "2026-09-18T01:00:00Z",
  last_reported_at: "2026-09-18T02:00:00Z",
  resolution: "",
  resolution_note: "",
  resolved_at: null,
  ...over,
});
const post = (over: Record<string, unknown> = {}) => ({
  id: "p9",
  author: { user_id: 9, display_name: "赵六" },
  content: "命中敏感词的帖子全文",
  moderation_status: "PENDING",
  open_report_count: 0,
  create_time: "2026-09-18T01:30:00Z",
  visibility: "PUBLIC",
  comment_count: 4,
  reaction_counts: { LIKE: 5, LOVE: 12, RESPECT: 0, SYMPATHY: 0, ETERNAL_LIGHT: 0 },
  ...over,
});
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ModerationPage />, { wrapper: Wrapper });
}

const asRole = (...permissions: string[]) =>
  (mockUser = { id: 2, username: "op", role: "MODERATOR", permissions, tenant: { code: "CN_DIYU", display_name: "中国地府" } });
const segment = (key: string) => screen.getByRole("button", { name: tZh(`social_moderation.tabs.${key}`) });
const detail = () => screen.getByRole("region", { name: tZh("social_moderation.review.detail_label") });

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.reports.mockResolvedValue(page([report()]));
  apiMock.content.mockResolvedValue(page([]));
  apiMock.item.mockResolvedValue({ data: post({ id: "p1", content: "被举报的帖子全文，比摘录长", moderation_status: "PUBLISHED", comment_count: 2 }) });
  apiMock.words.mockResolvedValue(page([]));
  apiMock.mutes.mockResolvedValue(page([]));
  apiMock.handled.mockResolvedValue(page([]));
  apiMock.resolveReport.mockResolvedValue({ data: report({ status: "RESOLVED" }) });
  apiMock.act.mockResolvedValue({ status: 200 });
});

it("refuses the page without social.moderate and asks the API nothing", () => {
  asRole("soul.read", "soul_account.read");
  renderPage();
  expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
  expect(apiMock.reports).not.toHaveBeenCalled();
});

describe("page header", () => {
  it("names the civilization scope and offers the four segments", async () => {
    asRole("social.moderate");
    renderPage();
    expect(screen.getByText("中国地府")).toBeInTheDocument();
    for (const key of ["reports", "words", "mutes", "handled"]) expect(segment(key)).toBeInTheDocument();
    // The old 「待审内容」 tab is gone: rule hits are in the 举报 queue now.
    expect(screen.queryByRole("button", { name: tZh("social_moderation.tabs.content") })).toBeNull();
    expect(segment("reports")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("举报 · the C-08 review layout", () => {
  it("a word-list hold says which word: 因敏感词「…」待审, in the list and in the detail", async () => {
    asRole("social.moderate");
    apiMock.reports.mockResolvedValue(page([]));
    apiMock.content.mockImplementation(async (kind: string) =>
      page(kind === "posts" ? [post({ moderation_reason: "sensitive_word:还阳" })] : [])
    );
    renderPage();
    const list = await screen.findByRole("list", { name: tZh("social_moderation.review.list_label") });
    const held = tZh("social_moderation.review.held_for_word", { word: "还阳" });
    expect(held).toBe("因敏感词「还阳」待审");
    expect(await within(list).findByText(held)).toBeInTheDocument();
    expect(within(list).queryByText(tZh("social_moderation.review.rule_hit"))).toBeNull();
    fireEvent.click(within(list).getByText("命中敏感词的帖子全文"));
    expect(await within(detail()).findByText(held)).toBeInTheDocument();
  });

  it("lists reports and rule hits together; the detail shows the full text in serif and translated reasons", async () => {
    asRole("social.moderate");
    apiMock.content.mockImplementation(async (kind: string) => page(kind === "posts" ? [post()] : []));
    renderPage();
    const list = await screen.findByRole("list", { name: tZh("social_moderation.review.list_label") });
    expect(within(list).getByText("被举报的帖子摘录")).toBeInTheDocument();
    expect(within(list).getByText("命中敏感词的帖子全文")).toBeInTheDocument();
    expect(within(list).getByText(tZh("social_moderation.review.rule_hit"))).toBeInTheDocument();

    // The first (newest) item is the report; its full text comes from the item endpoint.
    const body = await within(detail()).findByText("被举报的帖子全文，比摘录长");
    expect(body.className).toContain("font-serif");
    expect(apiMock.item).toHaveBeenCalledWith("posts", "p1");
    expect(within(detail()).getByText(tZh("social_moderation.reason.ABUSE"))).toBeInTheDocument();
    expect(within(detail()).queryByText("ABUSE")).toBeNull();
    // Text reactions, not emoji: 「评 N · 念 N」 with the counts the API gives. 念 is LOVE,
    // not the total (LIKE 5 would make it 17); no 「转」 — the circle has no reposts.
    const counts = detail().querySelector("[data-reaction-counts]") as HTMLElement;
    expect(counts).toHaveTextContent(/^评 2·念 12$/);
    expect(counts).not.toHaveTextContent("17");
    expect(counts).not.toHaveTextContent("转");
  });

  it("H without a reason says so and sends nothing; with one it hides through the report", async () => {
    asRole("social.moderate");
    renderPage();
    await within(await screen.findByRole("region", { name: tZh("social_moderation.review.detail_label") })).findByText(/被举报的帖子全文/);

    fireEvent.keyDown(document.body, { key: "h" });
    expect(await screen.findByText(tZh("social_moderation.review.reason_required"))).toBeInTheDocument();
    expect(apiMock.resolveReport).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(tZh("social_moderation.review.reason_label")), { target: { value: "辱骂他人" } });
    fireEvent.keyDown(document.body, { key: "h" });
    await waitFor(() => expect(apiMock.resolveReport).toHaveBeenCalledWith("r1", "HIDE", "辱骂他人", undefined));
  });

  it("W without a reason says so and sends nothing; with one it warns through the report", async () => {
    asRole("social.moderate");
    renderPage();
    await within(await screen.findByRole("region", { name: tZh("social_moderation.review.detail_label") })).findByText(/被举报的帖子全文/);

    fireEvent.keyDown(document.body, { key: "w" });
    expect(await screen.findByRole("alert")).toHaveTextContent(tZh("social_moderation.review.reason_required"));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${tZh("social_moderation.review.warn")}`) }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(apiMock.resolveReport).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(tZh("social_moderation.review.reason_label")), { target: { value: "注意言辞" } });
    fireEvent.keyDown(document.body, { key: "w" });
    await waitFor(() => expect(apiMock.resolveReport).toHaveBeenCalledWith("r1", "WARN", "注意言辞", undefined));
    expect(apiMock.resolveReport).toHaveBeenCalledTimes(1);
    expect(apiMock.act).not.toHaveBeenCalled();
  });

  it("a rule hit nobody reported has no 警告作者 — there is no report to resolve", async () => {
    asRole("social.moderate");
    apiMock.reports.mockResolvedValue(page([]));
    apiMock.content.mockImplementation(async (kind: string) => page(kind === "posts" ? [post()] : []));
    renderPage();
    await within(await screen.findByRole("region", { name: tZh("social_moderation.review.detail_label") })).findByText("命中敏感词的帖子全文");
    expect(screen.queryByRole("button", { name: new RegExp(`^${tZh("social_moderation.review.warn")}`) })).toBeNull();
    fireEvent.change(screen.getByLabelText(tZh("social_moderation.review.reason_label")), { target: { value: "x" } });
    fireEvent.keyDown(document.body, { key: "w" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(apiMock.resolveReport).not.toHaveBeenCalled();
    expect(apiMock.act).not.toHaveBeenCalled();
  });

  it("letters typed into the reason box are text, not verdicts", async () => {
    asRole("social.moderate");
    renderPage();
    await within(await screen.findByRole("region", { name: tZh("social_moderation.review.detail_label") })).findByText(/被举报的帖子全文/);
    const box = screen.getByLabelText(tZh("social_moderation.review.reason_label"));
    fireEvent.keyDown(box, { key: "a" });
    fireEvent.keyDown(box, { key: "h" });
    fireEvent.change(box, { target: { value: "w" } });
    fireEvent.keyDown(box, { key: "w" });
    // A mutation reaches the API a tick later; let it, or the absence proves nothing.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(apiMock.resolveReport).not.toHaveBeenCalled();
    expect(apiMock.act).not.toHaveBeenCalled();
  });

  it("A on a reported post that the word list also held back dismisses the report AND approves the post", async () => {
    asRole("social.moderate");
    apiMock.content.mockImplementation(async (kind: string) =>
      page(kind === "posts" ? [post({ id: "p1", content: "同一条帖子", open_report_count: 1 })] : [])
    );
    renderPage();
    const list = await screen.findByRole("list", { name: tZh("social_moderation.review.list_label") });
    // One row, not two.
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => expect(apiMock.act).toHaveBeenCalledWith("posts", "p1", "approve", undefined));
    expect(apiMock.resolveReport).toHaveBeenCalledWith("r1", "DISMISS", undefined, undefined);
  });

  it("a report against a user offers no hide or delete — there is no content to act on", async () => {
    asRole("social.moderate");
    apiMock.reports.mockResolvedValue(page([report({ target_type: "USER", post: null, content_excerpt: "", content_status: "" })]));
    renderPage();
    await screen.findByText(tZh("social_moderation.review.user_target_note"));
    expect(screen.queryByRole("button", { name: new RegExp(`^${tZh("social_moderation.actions.hide")}`) })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("social_moderation.actions.delete") })).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(`^${tZh("social_moderation.review.approve")}`) })).toBeInTheDocument();
    expect(apiMock.item).not.toHaveBeenCalled();
  });

  it("delete goes through a confirmation, and only then reaches the API", async () => {
    asRole("social.moderate");
    renderPage();
    await within(await screen.findByRole("region", { name: tZh("social_moderation.review.detail_label") })).findByText(/被举报的帖子全文/);
    fireEvent.click(screen.getByRole("button", { name: tZh("social_moderation.actions.delete") }));
    expect(apiMock.resolveReport).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("social_moderation.actions.delete") }));
    await waitFor(() => expect(apiMock.resolveReport).toHaveBeenCalledWith("r1", "DELETE", undefined, undefined));
  });

  it("a refusal says what the server's code means, not a generic failure", async () => {
    asRole("social.moderate");
    apiMock.resolveReport.mockRejectedValue(http(409, { detail: "x", code: "already_resolved" }));
    renderPage();
    await screen.findByRole("list", { name: tZh("social_moderation.review.list_label") });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${tZh("social_moderation.review.approve")}`) }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("social_moderation.errors.already_resolved"), "error")
    );
  });
});

describe("敏感词 · E-08b", () => {
  const words = [
    { id: "w1", word: "还阳", category: "INDUCEMENT", action: "REVIEW", hits_30d: 6, created_by: { user_id: 1, display_name: "崔珏" }, created_at: "t" },
    { id: "w2", word: "越狱", category: "", action: "HIDE", hits_30d: 3, created_by: null, created_at: "t" },
  ];

  it("adds from the inline row with category and action; Enter submits", async () => {
    asRole("social.moderate");
    apiMock.addWord.mockResolvedValue({ data: words[0] });
    renderPage();
    fireEvent.click(segment("words"));
    await screen.findByText(tZh("social_moderation.empty.words"));
    fireEvent.change(screen.getByLabelText(tZh("social_moderation.words.col_category")), { target: { value: "PRIVACY" } });
    fireEvent.change(screen.getByLabelText(tZh("social_moderation.words.col_action")), { target: { value: "MASK" } });
    const input = screen.getByLabelText(tZh("social_moderation.fields.word"));
    fireEvent.change(input, { target: { value: "门牌号" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(apiMock.addWord).toHaveBeenCalledWith({ word: "门牌号", category: "PRIVACY", action: "MASK" }));
  });

  it("requires a category: 添加 stays disabled and Enter sends nothing until one is chosen", async () => {
    asRole("social.moderate");
    apiMock.addWord.mockResolvedValue({ data: words[0] });
    renderPage();
    fireEvent.click(segment("words"));
    await screen.findByText(tZh("social_moderation.empty.words"));
    const select = screen.getByLabelText(tZh("social_moderation.words.col_category"));
    expect(select).toBeRequired();
    expect(select).toHaveValue("");
    // No 「未分类」 choice for a new word — that label is for words that predate the rule.
    expect(within(select).queryByRole("option", { name: tZh("social_moderation.word_category.NONE") })).toBeNull();
    const input = screen.getByLabelText(tZh("social_moderation.fields.word"));
    fireEvent.change(input, { target: { value: "门牌号" } });
    const addButton = screen.getByRole("button", { name: new RegExp(tZh("social_moderation.actions.add_word")) });
    expect(addButton).toBeDisabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(apiMock.addWord).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: "ABUSE" } });
    expect(addButton).toBeEnabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(apiMock.addWord).toHaveBeenCalledWith({ word: "门牌号", category: "ABUSE", action: "REVIEW" }));
  });

  it("rows carry no delete button; deleting is select → batch bar → confirm → batch-delete", async () => {
    asRole("social.moderate");
    apiMock.words.mockResolvedValue(page(words));
    apiMock.removeWords.mockResolvedValue({ data: { deleted: 1 } });
    renderPage();
    fireEvent.click(segment("words"));
    const row = (await screen.findByText("还阳")).closest("tr") as HTMLElement;
    expect(within(row).getByText(tZh("social_moderation.word_action.REVIEW"))).toBeInTheDocument();
    expect(within(row).getByText(tZh("social_moderation.word_category.INDUCEMENT"))).toBeInTheDocument();
    // The row's one button is the word itself (it opens the editor) — no delete at the row end.
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["还阳"]);
    // No batch bar before anything is selected.
    expect(screen.queryByRole("button", { name: tZh("social_moderation.words.delete_selected") })).toBeNull();

    fireEvent.click(within(row).getByRole("checkbox", { name: tZh("social_moderation.words.select_row", { word: "还阳" }) }));
    fireEvent.click(screen.getByRole("button", { name: tZh("social_moderation.words.delete_selected") }));
    expect(apiMock.removeWords).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("social_moderation.words.delete_selected") }));
    await waitFor(() => expect(apiMock.removeWords).toHaveBeenCalledWith(["w1"]));
    expect(apiMock.removeWord).not.toHaveBeenCalled();
  });

  it("clicking a row opens the edit drawer; an uncategorised word cannot be saved until it gets a category", async () => {
    asRole("social.moderate");
    apiMock.words.mockResolvedValue(page(words));
    apiMock.updateWord.mockResolvedValue({ data: { ...words[1], category: "ABUSE" } });
    renderPage();
    fireEvent.click(segment("words"));
    fireEvent.click(await screen.findByRole("button", { name: "越狱" }));
    const drawer = await screen.findByRole("dialog");
    const form = within(drawer).getByRole("form", { name: tZh("social_moderation.words.edit_title") });
    const save = within(form).getByRole("button", { name: tZh("common.save") });
    expect(within(form).getByLabelText(tZh("social_moderation.words.col_action"))).toHaveValue("HIDE");
    expect(save).toBeDisabled();
    fireEvent.submit(form);
    expect(apiMock.updateWord).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText(tZh("social_moderation.words.col_category")), { target: { value: "ABUSE" } });
    fireEvent.change(within(form).getByLabelText(tZh("social_moderation.words.col_action")), { target: { value: "MASK" } });
    fireEvent.change(within(form).getByLabelText(tZh("social_moderation.fields.word")), { target: { value: " 越狱术 " } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(apiMock.updateWord).toHaveBeenCalledWith("w2", { word: "越狱术", category: "ABUSE", action: "MASK" })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("改动作… changes the action of every selected word in one batch-update; a refusal is told in words", async () => {
    asRole("social.moderate");
    apiMock.words.mockResolvedValue(page(words));
    apiMock.updateWords.mockRejectedValueOnce(http(404, { detail: "x", code: "not_found", missing: ["w2"] }));
    apiMock.updateWords.mockResolvedValueOnce({ data: { updated: 2 } });
    renderPage();
    fireEvent.click(segment("words"));
    await screen.findByText("还阳");
    fireEvent.click(screen.getByRole("checkbox", { name: tZh("souls.batch.select_all") }));
    fireEvent.click(screen.getByRole("button", { name: tZh("social_moderation.words.change_action") }));
    const dialog = await screen.findByRole("dialog", { name: tZh("social_moderation.words.change_action_title", { n: "2" }) });
    expect(apiMock.updateWords).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(tZh("social_moderation.words.col_action")), { target: { value: "HIDE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("common.save") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("social_moderation.errors.not_found"), "error"));
    expect(apiMock.updateWords).toHaveBeenCalledWith(["w1", "w2"], "HIDE");
    // Refused: the dialog stays, with the choice, for another try.
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("common.save") }));
    await waitFor(() => expect(apiMock.updateWords).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(apiMock.removeWords).not.toHaveBeenCalled();
  });
});

describe("禁言 · E-08c", () => {
  it("draws the remaining term as a meter; lifting asks first; a lifted row has no button", async () => {
    asRole("social.moderate");
    const now = Date.now();
    const iso = (ms: number) => new Date(now + ms).toISOString();
    const day = 86_400_000;
    apiMock.mutes.mockResolvedValue(
      page([
        { id: "m1", user: author, until: iso(5 * day), reason: "刷屏", created_at: iso(-5 * day), created_by: null, lifted_at: null, lifted_by: null, is_active: true },
        { id: "m2", user: { user_id: 9, display_name: "赵六" }, until: iso(-day), reason: "", created_at: iso(-3 * day), created_by: null, lifted_at: iso(-2 * day), lifted_by: null, is_active: false },
      ])
    );
    apiMock.liftMute.mockResolvedValue({ data: {} });
    renderPage();
    fireEvent.click(segment("mutes"));
    const meter = await screen.findByRole("meter", { name: tZh("social_moderation.mutes.term_label", { name: "王五" }) });
    const pct = Number(meter.getAttribute("aria-valuenow"));
    expect(pct).toBeGreaterThanOrEqual(49);
    expect(pct).toBeLessThanOrEqual(51);

    const lifted = screen.getByText("赵六").closest("tr") as HTMLElement;
    expect(within(lifted).getByText(tZh("social_moderation.mute_lifted"))).toBeInTheDocument();
    expect(within(lifted).queryByRole("button")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: tZh("social_moderation.actions.lift") }));
    expect(apiMock.liftMute).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(tZh("social_moderation.mutes.confirm_body"))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("social_moderation.actions.lift") }));
    await waitFor(() => expect(apiMock.liftMute).toHaveBeenCalledWith("m1"));
  });
});

describe("已处理 · E-08d", () => {
  const handled = [
    { type: "POST", id: "h1", post: "h1", author, excerpt: "被隐藏的帖子", handling: "HIDDEN", reason: "诽谤官员", handled_by: { user_id: 1, display_name: "崔珏" }, handled_at: "t" },
    { type: "COMMENT", id: "h2", post: "p0", author, excerpt: "被删除的评论", handling: "DELETED", reason: "", handled_by: null, handled_at: "t" },
  ];

  it("a HIDDEN row opens read-only with 恢复可见; restoring calls the restore action", async () => {
    asRole("social.moderate");
    apiMock.handled.mockResolvedValue(page(handled));
    apiMock.item.mockResolvedValue({ data: post({ id: "h1", content: "被隐藏的帖子全文", moderation_status: "HIDDEN" }) });
    renderPage();
    fireEvent.click(segment("handled"));
    const row = (await screen.findByText("被隐藏的帖子")).closest("tr") as HTMLElement;
    // No row-end button: the row's one control is the opener on the author.
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(row).getByRole("button", { name: "王五" }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("被隐藏的帖子全文")).toBeInTheDocument();
    expect(within(drawer).queryByText(tZh("social_moderation.handled.in_recycle_bin"))).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: tZh("social_moderation.handled.restore") }));
    await waitFor(() => expect(apiMock.act).toHaveBeenCalledWith("posts", "h1", "restore", undefined));
  });

  it("a DELETED row says 在回收站 and links there — no second restore path", async () => {
    asRole("social.moderate");
    apiMock.handled.mockResolvedValue(page(handled));
    renderPage();
    fireEvent.click(segment("handled"));
    const row = (await screen.findByText("被删除的评论")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "王五" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(tZh("social_moderation.handled.in_recycle_bin"))).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: new RegExp(tZh("recycle_bin.manage_from_bin")) })).toHaveAttribute("href", "/recycle-bin");
    expect(within(drawer).queryByRole("button", { name: tZh("social_moderation.handled.restore") })).toBeNull();
    // A deleted item is not fetched in full: the endpoint 404s for it.
    expect(apiMock.item).not.toHaveBeenCalled();
  });
});
