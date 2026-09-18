/**
 * app/moderation/page.tsx — the officer side of the soul circle.
 *
 * `RequirePermission` / `usePermissions` run for real against a stubbed
 * `useTenant` (SchedulerPage.test.tsx says why). Copy is the real zh-Hans
 * bundle, so a key the page asks for that the bundle lacks shows up as a miss.
 * The API module is the only thing stubbed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ModerationPage from "@/app/moderation/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api/social-moderation", () => ({
  socialModerationApi: {
    reports: jest.fn(),
    resolveReport: jest.fn(),
    content: jest.fn(),
    act: jest.fn(),
    words: jest.fn(),
    addWord: jest.fn(),
    removeWord: jest.fn(),
    mutes: jest.fn(),
    liftMute: jest.fn(),
  },
}));
const { socialModerationApi: apiMock } = jest.requireMock("@soulledger/core/api/social-moderation") as {
  socialModerationApi: Record<string, jest.Mock>;
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

const author = { user_id: 7, display_name: "王五" };
const report = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  target_type: "POST",
  post: "p1",
  comment: null,
  target_user: author,
  status: "OPEN",
  report_count: 3,
  content_excerpt: "被举报的帖子",
  content_status: "PUBLISHED",
  entries: [{ reporter: { user_id: 8, display_name: "举报人" }, reason: "ABUSE", detail: "骂人", created_at: "t" }],
  created_at: "t",
  last_reported_at: "t",
  resolution: "",
  resolution_note: "",
  resolved_at: null,
  ...over,
});
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ModerationPage />, { wrapper: Wrapper });
}

const asRole = (...permissions: string[]) => (mockUser = { id: 2, username: "op", role: "MODERATOR", permissions });
const tab = (key: string) => screen.getByRole("button", { name: tZh(`social_moderation.tabs.${key}`) });

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.reports.mockResolvedValue(page([report()]));
  apiMock.content.mockResolvedValue(page([]));
  apiMock.words.mockResolvedValue(page([]));
  apiMock.mutes.mockResolvedValue(page([]));
  apiMock.resolveReport.mockResolvedValue({ data: report({ status: "RESOLVED" }) });
});

it("refuses the page without social.moderate and asks the API nothing", () => {
  asRole("soul.read", "soul_account.read");
  renderPage();
  expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
  expect(apiMock.reports).not.toHaveBeenCalled();
});

it("shows a report with its count, reasons and translated enums — not the raw members", async () => {
  asRole("social.moderate");
  renderPage();
  const row = (await screen.findByText(/被举报的帖子/)).closest("li[data-report-id]") as HTMLElement;
  expect(within(row).getByText(tZh("social_moderation.report_count", { n: "3" }))).toBeInTheDocument();
  expect(within(row).getByText(tZh("social_moderation.reason.ABUSE"))).toBeInTheDocument();
  expect(within(row).getByText(tZh("social_moderation.target_type.POST"))).toBeInTheDocument();
  expect(within(row).queryByText("ABUSE")).toBeNull();
  expect(within(row).queryByText("POST")).toBeNull();
});

it("mutes with the chosen number of days", async () => {
  asRole("social.moderate");
  renderPage();
  const row = (await screen.findByText(/被举报的帖子/)).closest("li[data-report-id]") as HTMLElement;
  fireEvent.change(screen.getByLabelText(tZh("social_moderation.mute_days")), { target: { value: "30" } });
  fireEvent.click(within(row).getByRole("button", { name: new RegExp(tZh("social_moderation.actions.mute")) }));
  await waitFor(() => expect(apiMock.resolveReport).toHaveBeenCalledWith("r1", "MUTE", undefined, 30));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("social_moderation.done"), "success"));
});

it("a report against a user offers no hide or delete — there is no content to act on", async () => {
  asRole("social.moderate");
  apiMock.reports.mockResolvedValue(page([report({ target_type: "USER", post: null, content_excerpt: "", content_status: "" })]));
  renderPage();
  await screen.findByText(tZh("social_moderation.target_type.USER"));
  expect(screen.queryByRole("button", { name: tZh("social_moderation.actions.hide") })).toBeNull();
  expect(screen.queryByRole("button", { name: tZh("social_moderation.actions.delete") })).toBeNull();
  expect(screen.getByRole("button", { name: tZh("social_moderation.actions.dismiss") })).toBeInTheDocument();
});

it("delete goes through a confirmation, and only then reaches the API", async () => {
  asRole("social.moderate");
  renderPage();
  await screen.findByText(/被举报的帖子/);
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
  await screen.findByText(/被举报的帖子/);
  fireEvent.click(screen.getByRole("button", { name: tZh("social_moderation.actions.dismiss") }));
  await waitFor(() =>
    expect(mockShowToast).toHaveBeenCalledWith(tZh("social_moderation.errors.already_resolved"), "error")
  );
});

it("pending content: approve on a PENDING post; the HIDDEN filter asks for HIDDEN", async () => {
  asRole("social.moderate");
  apiMock.content.mockResolvedValue(
    page([{ id: "p9", author, content: "命中敏感词", moderation_status: "PENDING", open_report_count: 0, create_time: "t", visibility: "PUBLIC", comment_count: 0 }])
  );
  apiMock.act.mockResolvedValue({ status: 200 });
  renderPage();
  fireEvent.click(tab("content"));
  await screen.findByText("命中敏感词");
  expect(apiMock.content).toHaveBeenLastCalledWith("posts", { moderation_status: "PENDING" });
  expect(screen.queryByRole("button", { name: tZh("social_moderation.actions.restore") })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: tZh("social_moderation.actions.approve") }));
  await waitFor(() => expect(apiMock.act).toHaveBeenCalledWith("posts", "p9", "approve", undefined));

  fireEvent.click(screen.getByRole("button", { name: tZh("social_moderation.status_filter.HIDDEN") }));
  await waitFor(() => expect(apiMock.content).toHaveBeenLastCalledWith("posts", { moderation_status: "HIDDEN" }));
});

it("word list: adds the typed word", async () => {
  asRole("social.moderate");
  apiMock.addWord.mockResolvedValue({ data: { id: "w1", word: "违禁词", created_by: null, created_at: "t" } });
  renderPage();
  fireEvent.click(tab("words"));
  await screen.findByText(tZh("social_moderation.empty.words"));
  fireEvent.change(screen.getByLabelText(tZh("social_moderation.fields.word")), { target: { value: "违禁词" } });
  fireEvent.click(screen.getByRole("button", { name: tZh("social_moderation.actions.add_word") }));
  await waitFor(() => expect(apiMock.addWord).toHaveBeenCalledWith("违禁词"));
});

it("mutes: an active mute can be lifted; a lifted one says so and cannot", async () => {
  asRole("social.moderate");
  apiMock.mutes.mockResolvedValue(
    page([
      { id: "m1", user: author, until: "u", reason: "", created_at: "t", lifted_at: null, is_active: true },
      { id: "m2", user: { user_id: 9, display_name: "赵六" }, until: "u", reason: "", created_at: "t", lifted_at: "t", is_active: false },
    ])
  );
  apiMock.liftMute.mockResolvedValue({ data: {} });
  renderPage();
  fireEvent.click(tab("mutes"));
  const lifted = (await screen.findByText("赵六")).closest("li") as HTMLElement;
  expect(within(lifted).getByText(tZh("social_moderation.mute_lifted"))).toBeInTheDocument();
  expect(within(lifted).queryByRole("button")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: tZh("social_moderation.actions.lift") }));
  await waitFor(() => expect(apiMock.liftMute).toHaveBeenCalledWith("m1"));
});
