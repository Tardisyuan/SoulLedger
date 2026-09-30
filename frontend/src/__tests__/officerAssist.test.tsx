/**
 * 「问一问」 on the officer console (canvas 「灵魂簿 官员端 · 问一问」 1a–1g),
 * rendered inside the real AppLayout with the real zh-Hans bundle. The transport
 * is core's real `api` instance with its three verbs spied on, so the real
 * error helpers read real axios-shaped errors.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AxiosError, AxiosHeaders } from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@soulledger/core/api/client";
import { OFFICER_EMPTY_ANSWER, OFFICER_SCREENS, officerAssistScreen } from "@soulledger/core/api/officer-assist";
import { I18nProvider } from "@/src/contexts/I18nContext";
import zh from "@soulledger/core/messages/zh-Hans.json";
import { officerAssistSuggestions } from "@/src/components/assist/officerAssistSuggestions";

jest.mock("@/src/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

const mockTenant = {
  user: { id: 7, username: "baozheng", display_name: "包拯", role: "JUDGE", tenant: null, permissions: [] },
  tenantCode: "CN",
  logout: jest.fn(),
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

let mockPath = "/judgment";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock("@soulledger/core/api", () => ({
  notificationsApi: { list: jest.fn().mockResolvedValue({ data: { count: 0, results: [] } }) },
  authApi: { logout: jest.fn().mockResolvedValue({}) },
}));

jest.mock("@/src/components/connection-status", () => ({
  ConnectionStatus: () => null,
  ConnectionBanner: () => null,
  useConnectionBannerShown: () => mockBannerShown,
}));
let mockBannerShown = false;

jest.mock("@/src/hooks/useSidebarMenus", () => ({
  ...jest.requireActual("@/src/hooks/useSidebarMenus"),
  useSidebarMenus: () => ({ data: [] }),
}));

import { AppLayout } from "@/src/components/layout/AppLayout";

const ROOT = path.join(__dirname, "..", "..", "..");
const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";

const post = jest.spyOn(api, "post");
const get = jest.spyOn(api, "get");
const del = jest.spyOn(api, "delete");

let answerId = 100;
function answer(content: string) {
  answerId += 1;
  return {
    data: {
      conversation_id: CONVERSATION_ID,
      answer: { id: answerId, role: "assistant", content, created_at: "2026-09-29T02:12:00Z" },
    },
  };
}

function refusal(status: number, data: Record<string, string>) {
  const response = { status, data, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } };
  return new AxiosError("refused", "ERR_BAD_RESPONSE", undefined, undefined, response as never);
}

function setWidth(wide: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: wide,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="zh-Hans">{children}</I18nProvider>
    </QueryClientProvider>
  );
  return render(<AppLayout>page body</AppLayout>, { wrapper: Wrapper });
}

const entry = () => screen.getByTestId("officer-assist-entry");
const input = () => screen.getByRole("textbox", { name: "问一个关于这套后台的问题" });

async function openAndAsk(question = "我的队列有多少？") {
  renderLayout();
  fireEvent.click(entry());
  await waitFor(() => expect(get).toHaveBeenCalled());
  fireEvent.change(input(), { target: { value: question } });
  fireEvent.keyDown(input(), { key: "Enter" });
}

beforeEach(() => {
  mockPath = "/judgment";
  mockTenant.user.role = "JUDGE";
  setWidth(true);
  localStorage.clear();
  sessionStorage.clear();
  post.mockReset();
  get.mockReset().mockResolvedValue({ data: [] });
  del.mockReset().mockResolvedValue({ data: undefined });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the entry and the keyboard (1a 三, 1b)", () => {
  it("⌘J opens the panel with focus in the box; Ctrl+J closes it and focus returns to the entry", async () => {
    renderLayout();
    expect(screen.queryByTestId("officer-assist-panel")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "j", metaKey: true });
    const panel = await screen.findByRole("complementary", { name: "问一问" });
    await waitFor(() => expect(input()).toHaveFocus());
    expect(entry()).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "J", ctrlKey: true });
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    expect(entry()).toHaveFocus();
  });

  it("Esc inside the panel closes it and returns focus to the entry", async () => {
    renderLayout();
    fireEvent.click(entry());
    fireEvent.keyDown(await screen.findByRole("textbox", { name: "问一个关于这套后台的问题" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("officer-assist-panel")).not.toBeInTheDocument());
    expect(entry()).toHaveFocus();
  });

  it("F6 moves focus from the panel to the page and back", async () => {
    renderLayout();
    fireEvent.click(entry());
    await waitFor(() => expect(input()).toHaveFocus());
    fireEvent.keyDown(document, { key: "F6" });
    expect(screen.getByTestId("app-content")).toHaveFocus();
    fireEvent.keyDown(document, { key: "F6" });
    expect(input()).toHaveFocus();
  });

  it("sits before notifications in the masthead", () => {
    renderLayout();
    const bell = screen.getByRole("button", { name: zh.notifications.title });
    expect(entry().compareDocumentPosition(bell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("pushed beside the page, or a drawer (1a 一, 1g)", () => {
  it("≥ 1024: a complementary region, the page gives up 420 px, no dialog", async () => {
    renderLayout();
    fireEvent.click(entry());
    await screen.findByRole("complementary", { name: "问一问" });
    expect(screen.getByTestId("app-content").className).toContain("pr-[420px]");
    expect(screen.getByTestId("app-content")).toHaveAttribute("data-assist-pushed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("< 1024: a modal dialog, and the page is not pushed", async () => {
    setWidth(false);
    renderLayout();
    fireEvent.click(entry());
    const drawer = await screen.findByRole("dialog", { name: "问一问" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(screen.queryByRole("complementary", { name: "问一问" })).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content").className).not.toContain("pr-[420px]");
  });
});

/**
 * Design E 组. The main column is measured (ResizeObserver on <main>), so these stub one
 * that reports a fixed width: jsdom has none, and without it the hook reads as roomy.
 */
function setMainWidth(width: number) {
  class FixedWidthObserver {
    private readonly cb: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.cb = callback;
    }
    observe() {
      this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { configurable: true, writable: true, value: FixedWidthObserver });
}

describe("Design E 组: the panel's head, its room, and the connection bar", () => {
  afterEach(() => {
    delete (window as { ResizeObserver?: unknown }).ResizeObserver;
    mockBannerShown = false;
  });

  it("the head is a fixed 48 px on a 1px ink rule, with no pattern band", async () => {
    renderLayout();
    fireEvent.click(entry());
    const panel = await screen.findByRole("complementary", { name: "问一问" });
    const head = within(panel).getByTestId("officer-assist-head");
    expect(head.className).toMatch(/(^|\s)h-12(\s|$)/);
    expect(head.className).toContain("border-b border-[oklch(var(--color-ink))]");
    // Absence: not the old 40 px / block rule, and no plaque band anywhere in the panel.
    expect(head.className).not.toMatch(/(^|\s)h-10(\s|$)/);
    expect(head.className).not.toContain("--color-block");
    expect(panel.querySelector(".plaque-band, .plaque-tex, [data-testid='plaque-band']")).toBeNull();
  });

  it("main column 1140 (720 left beside 420): pushed", async () => {
    setMainWidth(1140);
    renderLayout();
    fireEvent.click(entry());
    const panel = await screen.findByRole("complementary", { name: "问一问" });
    expect(panel).toHaveAttribute("data-assist-mode", "pushed");
    expect(screen.getByTestId("app-content")).toHaveAttribute("data-assist-pushed");
  });

  it("main column 1139 on a wide viewport: the panel covers the page over a scrim instead of pushing it", async () => {
    setMainWidth(1139);
    renderLayout();
    fireEvent.click(entry());
    const drawer = await screen.findByRole("dialog", { name: "问一问" });
    expect(drawer).toHaveAttribute("data-assist-mode", "overlay");
    expect(screen.queryByRole("complementary", { name: "问一问" })).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).not.toHaveAttribute("data-assist-pushed");
    expect(screen.getByTestId("app-content").className).not.toContain("pr-[420px]");
    // The scrim token, not a hand-mixed black.
    expect(document.querySelector("[class*='--color-scrim']")).not.toBeNull();
  });

  it("with the connection bar up, the panel starts below it (top-7), pushed or overlaid", async () => {
    mockBannerShown = true;
    renderLayout();
    fireEvent.click(entry());
    const panel = await screen.findByRole("complementary", { name: "问一问" });
    expect(panel.className).toMatch(/(^|\s)top-7(\s|$)/);
    expect(panel.className).not.toMatch(/(^|\s)(top-0|inset-y-0)(\s|$)/);
  });

  it("with no connection bar, the panel runs from the very top", async () => {
    renderLayout();
    fireEvent.click(entry());
    const panel = await screen.findByRole("complementary", { name: "问一问" });
    expect(panel.className).toMatch(/(^|\s)top-0(\s|$)/);
    expect(panel.className).not.toMatch(/(^|\s)top-7(\s|$)/);
  });
});

describe("suggested questions, role × page (1a)", () => {
  const all = (locale: "zh-Hans" | "en") =>
    ["ADMIN", "MODERATOR", "JUDGE", "GUARDIAN", "VIEWER"].flatMap((role) =>
      OFFICER_SCREENS.flatMap((s) => officerAssistSuggestions(role, s, locale))
    );

  it("VIEWER gets only the page-purpose pair, on every page", () => {
    for (const s of OFFICER_SCREENS) {
      expect(officerAssistSuggestions("VIEWER", s, "zh-Hans")).toEqual(["这一页是做什么的？", "这些状态是什么意思？"]);
    }
  });

  it("a custom role is treated as VIEWER", () => {
    expect(officerAssistSuggestions("AUDITOR", "judgment", "zh-Hans")).toEqual(officerAssistSuggestions("VIEWER", "judgment", "zh-Hans"));
  });

  it("GUARDIAN has no hall-inbox questions; ADMIN alone has scheduler ones", () => {
    const inbox = ["ADMIN", "MODERATOR", "JUDGE"].flatMap((r) => officerAssistSuggestions(r, "soul-inbox", "zh-Hans"));
    const guardian = officerAssistSuggestions("GUARDIAN", "soul-inbox", "zh-Hans");
    expect(guardian).toEqual(officerAssistSuggestions("GUARDIAN", "users", "zh-Hans"));
    for (const q of inbox) expect(guardian).not.toContain(q);
    expect(officerAssistSuggestions("ADMIN", "scheduler", "zh-Hans")).toContain("哪些任务连续失败？");
    expect(officerAssistSuggestions("JUDGE", "scheduler", "zh-Hans")).not.toContain("哪些任务连续失败？");
  });

  it("MODERATOR asks why approving is closed and about escalating; JUDGE does not ask to escalate", () => {
    expect(officerAssistSuggestions("MODERATOR", "workflow", "zh-Hans")).toEqual(["为什么我点不了审批？", "卡住的流程我能越级推进吗？"]);
    expect(officerAssistSuggestions("JUDGE", "workflow", "zh-Hans")).not.toContain("卡住的流程我能越级推进吗？");
  });

  it("zh UI asks in Chinese; en and egy ask in English, the server's answer language", () => {
    expect(officerAssistSuggestions("JUDGE", "judgment", "en")).toEqual(officerAssistSuggestions("JUDGE", "judgment", "egy"));
    expect(all("en").every((q) => !/[一-鿿]/.test(q))).toBe(true);
    expect(all("zh-Hans").every((q) => /[一-鿿]/.test(q))).toBe(true);
  });

  it("the empty panel shows the signed-in role's pair for this page, and a suggestion is sent verbatim", async () => {
    mockTenant.user.role = "MODERATOR";
    mockPath = "/workflow/12";
    post.mockResolvedValue(answer("这一步的审批角色是阎罗王。"));
    renderLayout();
    fireEvent.click(entry());
    const panel = await screen.findByRole("complementary", { name: "问一问" });
    expect(within(panel).getByText("关于审批流程，常被问到的：")).toBeInTheDocument();
    expect(within(panel).queryByText("待我审批的有几件？")).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: /为什么我点不了审批？/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toEqual({ question: "为什么我点不了审批？", screen: "workflow", conversation_id: undefined });
  });
});

describe("the screen hint", () => {
  it("is the route's top-level segment when the backend knows it, else `other`", async () => {
    mockPath = "/sentence-requests/4";
    post.mockResolvedValue(answer("有 3 件。"));
    await openAndAsk();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe("/assist/");
    expect((post.mock.calls[0][1] as { screen: string }).screen).toBe("sentence-requests");
    // 关于 / 致谢页曾被归到 other(后端测试里的具名例外 NO_SCREEN);2026-09-30 起有自己的页面 id。
    expect(officerAssistScreen("/about")).toBe("about");
    expect(officerAssistScreen("/")).toBe("other");
    expect(officerAssistScreen("/no-such-page/1")).toBe("other");
  });

  it("OFFICER_SCREENS is the backend's tuple, member for member", () => {
    const models = readFileSync(path.join(ROOT, "backend", "apps", "soul_assist", "models.py"), "utf8");
    const block = /OFFICER_SCREENS = \(([\s\S]*?)\n\)/.exec(models)?.[1] ?? "";
    const backend = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(backend.length).toBeGreaterThan(20);
    expect([...OFFICER_SCREENS].sort()).toEqual([...backend].sort());
  });
});

describe("the four notices (1f)", () => {
  it("① not configured: the notice, and closing hides the entry for the session", async () => {
    post.mockRejectedValue(refusal(503, { detail: "本殿尚未开通助手。", code: "assistant_not_configured" }));
    await openAndAsk();
    expect(await screen.findByText("本殿还没有开通问一问")).toBeInTheDocument();
    expect(screen.getByText(/询问本殿殿主或管理员/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("officer-assist-panel")).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByTestId("officer-assist-entry")).not.toBeInTheDocument());
    // ⌘J does not bring it back either.
    fireEvent.keyDown(document, { key: "j", metaKey: true });
    expect(screen.queryByTestId("officer-assist-panel")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("soulledger.officer_assist.off.7")).toBe("1");
  });

  it("② rate limited: says when asking opens again, and keeps the question", async () => {
    const at = new Date(2026, 8, 29, 11, 2);
    post.mockRejectedValue(refusal(429, { detail: "提问太频繁", code: "rate_limited", retry_at: at.toISOString() }));
    await openAndAsk("回复会署谁的名？");
    expect(await screen.findByText("这一小时问得太多了。11:02 之后可以再问。")).toBeInTheDocument();
    expect(input()).toHaveValue("回复会署谁的名？");
  });

  it("③ timeout at 25 s: the question stays in the box, retry sends it again", async () => {
    jest.useFakeTimers();
    post.mockImplementation(() => new Promise(() => {}));
    await openAndAsk("这份调拨为什么还没执行？");
    expect(screen.getByTestId("officer-assist-waiting")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(6_000));
    expect(screen.getByText("还在查，通常不超过 20 秒")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(19_000));
    expect(await screen.findByText("助手这次没有答上来（超过 25 秒）。你的问题还在。")).toBeInTheDocument();
    expect(input()).toHaveValue("这份调拨为什么还没执行？");
    expect(screen.queryByTestId("officer-assist-waiting")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(post).toHaveBeenCalledTimes(2);
    expect((post.mock.calls[1][1] as { question: string }).question).toBe("这份调拨为什么还没执行？");
  });

  it("④ the fixed empty answer shows 「ask your lead」; a normal answer does not", async () => {
    post.mockResolvedValueOnce(answer(OFFICER_EMPTY_ANSWER["zh-Hans"]));
    await openAndAsk();
    expect(await screen.findByTestId("officer-assist-ask-lead")).toHaveTextContent("这类问题请询问本殿殿主或管理员。");
    // No letters / inbox / help link: the console has none to offer.
    expect(within(screen.getByTestId("officer-assist-panel")).queryByRole("link")).not.toBeInTheDocument();

    post.mockResolvedValueOnce(answer("你的队列有 3 件。"));
    fireEvent.change(input(), { target: { value: "还有几件？" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(await screen.findByText("你的队列有 3 件。")).toBeInTheDocument();
    expect(screen.getAllByTestId("officer-assist-ask-lead")).toHaveLength(1);
    // The second question continues the conversation the first answer opened.
    expect((post.mock.calls[1][1] as { conversation_id: string }).conversation_id).toBe(CONVERSATION_ID);
  });

  it("the fixed empty answer the console recognizes is the backend's OFFICER_EMPTY_ANSWER, word for word", () => {
    const service = readFileSync(path.join(ROOT, "backend", "apps", "soul_assist", "service.py"), "utf8");
    const block = /OFFICER_EMPTY_ANSWER = \{([\s\S]*?)\n\}/.exec(service)?.[1] ?? "";
    const backend = Object.fromEntries([...block.matchAll(/"([^"]+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
    expect(backend).toEqual(OFFICER_EMPTY_ANSWER);
  });
});

describe("waiting while the panel is closed (1d)", () => {
  it("the answer still lands, and the entry shows a dot until the panel is opened", async () => {
    let resolve: (_v: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((r) => (resolve = r)));
    await openAndAsk();
    fireEvent.click(within(screen.getByTestId("officer-assist-panel")).getByRole("button", { name: "关闭" }));
    expect(screen.queryByTestId("officer-assist-unseen")).not.toBeInTheDocument();
    await act(async () => resolve(answer("有 2 件。")));
    expect(await screen.findByTestId("officer-assist-unseen")).toBeInTheDocument();
    fireEvent.click(entry());
    expect(await screen.findByText("有 2 件。")).toBeInTheDocument();
    expect(screen.queryByTestId("officer-assist-unseen")).not.toBeInTheDocument();
  });
});

describe("history and delete (1e)", () => {
  it("delete asks first, then calls DELETE for that conversation", async () => {
    get.mockResolvedValue({
      data: [
        {
          id: CONVERSATION_ID,
          screen: "workflow",
          created_at: "2026-09-27T08:05:00Z",
          last_active_at: "2026-09-27T08:05:00Z",
          first_question: "这份调拨走到哪一步了？",
          messages: [],
        },
      ],
    });
    renderLayout();
    fireEvent.click(entry());
    fireEvent.click(await screen.findByRole("button", { name: "历史" }));
    expect(await screen.findByText("这份调拨走到哪一步了？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除这段会话" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("从「审批流程」开始的这段会话会立即删除，不能恢复。");
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(`/assist/conversations/${CONVERSATION_ID}/`));
  });
});
