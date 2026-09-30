/**
 * 「问一问」 on the officer console (canvas 「灵魂簿 官员端 · 问一问」 1a–1g),
 * rendered inside the real AppLayout with the real zh-Hans bundle. Questions go
 * out as a stream (canvas「问一问 · 流式输出」): `fetch` is replaced by a fake whose
 * body the test writes event by event, and core's real `streamAssist` reads it —
 * the real parser, timers and abort. History and delete still go through core's
 * real `api` instance with its verbs spied on.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@soulledger/core/api/client";
import { OFFICER_EMPTY_ANSWER, OFFICER_SCREENS, officerAssistScreen } from "@soulledger/core/api/officer-assist";
import { I18nProvider } from "@/src/contexts/I18nContext";
import zh from "@soulledger/core/messages/zh-Hans.json";
import { officerAssistSuggestions } from "@/src/components/assist/officerAssistSuggestions";
import { installStreamFetch, refuse, type StreamAsk, type StreamEvent, type StreamScript } from "./support/assistStreamFetch";

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

const get = jest.spyOn(api, "get");
const del = jest.spyOn(api, "delete");

type Event = StreamEvent;
type Ask = StreamAsk;
let asks: StreamAsk[];
let scripts: StreamScript[];

let answerId = 100;
const done = (content: string, interruption = ""): Event => {
  answerId += 1;
  return {
    event: "done",
    conversation_id: CONVERSATION_ID,
    answer: { id: answerId, role: "assistant", content, interruption, created_at: "2026-09-29T02:12:00Z" },
    usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0 },
  };
};
/** The whole answer at once: meta, one delta, done. */
const reply = (content: string) => (ask: Ask) =>
  ask.send({ event: "meta", conversation_id: CONVERSATION_ID }, { event: "delta", text: content }, done(content));

let reduceMotion = false;
function setWidth(wide: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("reduced-motion") ? reduceMotion : wide,
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
/** The conversation itself — the polite live region repeats a finished answer for screen readers. */
const thread = () => within(screen.getByTestId("officer-assist-panel").querySelector("ol") as HTMLElement);
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
  reduceMotion = false;
  setWidth(true);
  localStorage.clear();
  sessionStorage.clear();
  ({ asks, scripts } = installStreamFetch());
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
    scripts.push(reply("这一步的审批角色是阎罗王。"));
    renderLayout();
    fireEvent.click(entry());
    const panel = await screen.findByRole("complementary", { name: "问一问" });
    expect(within(panel).getByText("关于审批流程，常被问到的：")).toBeInTheDocument();
    expect(within(panel).queryByText("待我审批的有几件？")).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: /为什么我点不了审批？/ }));
    await waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0].body).toEqual({ question: "为什么我点不了审批？", screen: "workflow", stream: true });
  });
});

describe("the screen hint", () => {
  it("is the route's top-level segment when the backend knows it, else `other`", async () => {
    mockPath = "/sentence-requests/4";
    scripts.push(reply("有 3 件。"));
    await openAndAsk();
    await waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0].url).toMatch(/\/assist\/$/);
    expect(asks[0].body.screen).toBe("sentence-requests");
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
    scripts.push(refuse(503, { detail: "本殿尚未开通助手。", code: "assistant_not_configured" }));
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
    scripts.push(refuse(429, { detail: "提问太频繁", code: "rate_limited", retry_at: at.toISOString() }));
    await openAndAsk("回复会署谁的名？");
    expect(await screen.findByText("这一小时问得太多了。11:02 之后可以再问。")).toBeInTheDocument();
    expect(input()).toHaveValue("回复会署谁的名？");
  });

  it("③ no text in 25 s: the question stays in the box, retry sends it again", async () => {
    jest.useFakeTimers();
    await openAndAsk("这份调拨为什么还没执行？");
    expect(screen.getByTestId("officer-assist-waiting")).toBeInTheDocument();
    await act(async () => jest.advanceTimersByTime(25_000));
    expect(await screen.findByText("助手这次没有答上来（超过 25 秒）。你的问题还在。")).toBeInTheDocument();
    expect(asks[0].aborted()).toBe(true);
    expect(input()).toHaveValue("这份调拨为什么还没执行？");
    expect(screen.queryByTestId("officer-assist-waiting")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(asks).toHaveLength(2));
    expect(asks[1].body.question).toBe("这份调拨为什么还没执行？");
  });

  it("③ an error before any text (the backup failed too) is the same 「没有答上来」", async () => {
    await openAndAsk();
    await waitFor(() => expect(asks).toHaveLength(1));
    await act(async () => asks[0].send({ event: "meta", conversation_id: CONVERSATION_ID }, { event: "error", kind: "unavailable", text_sent: false, detail: "x" }));
    expect(await screen.findByText("助手这次没有答上来。你的问题还在。")).toBeInTheDocument();
    expect(screen.queryByTestId("officer-assist-interrupted")).not.toBeInTheDocument();
  });

  it("④ the fixed empty answer shows 「ask your lead」; a normal answer does not", async () => {
    scripts.push(reply(OFFICER_EMPTY_ANSWER["zh-Hans"]), reply("你的队列有 3 件。"));
    await openAndAsk();
    expect(await screen.findByTestId("officer-assist-ask-lead")).toHaveTextContent("这类问题请询问本殿殿主或管理员。");
    // No letters / inbox / help link: the console has none to offer.
    expect(within(screen.getByTestId("officer-assist-panel")).queryByRole("link")).not.toBeInTheDocument();

    fireEvent.change(input(), { target: { value: "还有几件？" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(await thread().findByText("你的队列有 3 件。")).toBeInTheDocument();
    expect(screen.getAllByTestId("officer-assist-ask-lead")).toHaveLength(1);
    // The second question continues the conversation the first answer opened.
    expect(asks[1].body.conversation_id).toBe(CONVERSATION_ID);
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
    await openAndAsk();
    await waitFor(() => expect(asks).toHaveLength(1));
    fireEvent.click(within(screen.getByTestId("officer-assist-panel")).getByRole("button", { name: "关闭" }));
    expect(screen.queryByTestId("officer-assist-unseen")).not.toBeInTheDocument();
    await act(async () => reply("有 2 件。")(asks[0]));
    expect(await screen.findByTestId("officer-assist-unseen")).toBeInTheDocument();
    fireEvent.click(entry());
    expect(await thread().findByText("有 2 件。")).toBeInTheDocument();
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

describe("streaming (canvas「问一问 · 流式输出」)", () => {
  const panel = () => screen.getByTestId("officer-assist-panel");
  const announced = () => panel().querySelector("[aria-live='polite']")?.textContent ?? "";

  async function streaming(question = "我的队列有多少？") {
    await openAndAsk(question);
    await waitFor(() => expect(asks).toHaveLength(1));
    return asks[0];
  }

  it("A1: dots and the waiting line; at 20 s the line reads 「还在查……」 — never seconds", async () => {
    jest.useFakeTimers();
    await openAndAsk();
    expect(screen.getByTestId("assist-dots")).toBeInTheDocument();
    expect(screen.getByTestId("officer-assist-waiting-text")).toHaveTextContent("正在查说明与你的队列");
    await act(async () => jest.advanceTimersByTime(19_999));
    expect(screen.getByTestId("officer-assist-waiting-text")).toHaveTextContent("正在查说明与你的队列");
    await act(async () => jest.advanceTimersByTime(1));
    expect(screen.getByTestId("officer-assist-waiting-text")).toHaveTextContent("还在查……");
    expect(screen.getByTestId("officer-assist-waiting")).not.toHaveTextContent(/\d/);
  });

  it("A2/A10: text appears as it arrives under aria-busy with the ▍ cursor; done drops both and announces the whole answer", async () => {
    const ask = await streaming();
    await act(async () => ask.send({ event: "meta", conversation_id: CONVERSATION_ID }, { event: "delta", text: "你的队列" }));
    const live = await screen.findByTestId("officer-assist-streaming");
    expect(live).toHaveAttribute("aria-busy", "true");
    expect(live).toHaveTextContent("你的队列");
    expect(within(live).getByTestId("assist-cursor")).toHaveTextContent("▍");
    expect(announced()).toBe("正在回答");
    await act(async () => ask.send({ event: "delta", text: "有 3 件。" }));
    expect(live).toHaveTextContent("你的队列有 3 件。");
    // Fragments are not announced one by one.
    expect(announced()).toBe("正在回答");
    await act(async () => ask.send(done("你的队列有 3 件。")));
    await waitFor(() => expect(screen.queryByTestId("officer-assist-streaming")).not.toBeInTheDocument());
    expect(thread().getByText("你的队列有 3 件。")).toBeInTheDocument();
    expect(screen.queryByTestId("assist-cursor")).not.toBeInTheDocument();
    expect(panel().querySelector("[aria-busy='true']")).toBeNull();
    expect(announced()).toBe("你的队列有 3 件。");
  });

  it("A3: bold is formatted once closed; half-written bold shows as typed", async () => {
    const ask = await streaming();
    await act(async () => ask.send({ event: "delta", text: "先**提交**再**等" }));
    const live = await screen.findByTestId("officer-assist-streaming");
    expect(within(live).getByText("提交").tagName).toBe("STRONG");
    expect(live).toHaveTextContent("再**等");
    expect(live.querySelectorAll("strong")).toHaveLength(1);
  });

  it("A5/A6: send turns into 「■ 停止」; stopping keeps the text with 已停止 and no retry", async () => {
    const ask = await streaming();
    expect(screen.queryByRole("button", { name: "问" })).not.toBeInTheDocument();
    const stop = screen.getByRole("button", { name: "停止回答" });
    expect(stop).toHaveTextContent("■停止");
    // The box stays open for the next question while the answer is written.
    expect(input()).not.toBeDisabled();
    await act(async () => ask.send({ event: "delta", text: "可以申诉" }));
    await screen.findByTestId("officer-assist-streaming");
    fireEvent.click(stop);
    await waitFor(() => expect(ask.aborted()).toBe(true));
    expect(await screen.findByTestId("officer-assist-stopped")).toHaveTextContent("已停止");
    expect(thread().getByText("可以申诉")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("officer-assist-interrupted")).not.toBeInTheDocument();
    expect(announced()).toBe("已停止 可以申诉");
    expect(screen.getByRole("button", { name: "问" })).toBeInTheDocument();
  });

  it("A5: stop works before the first text too", async () => {
    const ask = await streaming();
    fireEvent.click(screen.getByRole("button", { name: "停止回答" }));
    await waitFor(() => expect(ask.aborted()).toBe(true));
    expect(await screen.findByTestId("officer-assist-stopped")).toBeInTheDocument();
    expect(screen.queryByTestId("officer-assist-waiting")).not.toBeInTheDocument();
  });

  it("A5: Esc stops the answer (pushed panel) and does not close the panel", async () => {
    const ask = await streaming();
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() => expect(ask.aborted()).toBe(true));
    expect(await screen.findByTestId("officer-assist-stopped")).toBeInTheDocument();
    expect(screen.getByTestId("officer-assist-panel")).toBeInTheDocument();
    // With nothing being written, Esc closes as before.
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("officer-assist-panel")).not.toBeInTheDocument());
  });

  it("A5: Esc stops the answer in the drawer too, without closing it", async () => {
    setWidth(false);
    const ask = await streaming();
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() => expect(ask.aborted()).toBe(true));
    expect(await screen.findByTestId("officer-assist-stopped")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "问一问" })).toBeInTheDocument();
  });

  it("A7: interrupted keeps the text with 「! 回答中断」 and 重试; retry re-asks and replaces it", async () => {
    const ask = await streaming("能申诉吗？");
    await act(async () =>
      ask.send(
        { event: "meta", conversation_id: CONVERSATION_ID },
        { event: "delta", text: "可以，" },
        { event: "error", kind: "interrupted", text_sent: true, detail: "x", conversation_id: CONVERSATION_ID, message_id: 55 }
      )
    );
    const marker = await screen.findByTestId("officer-assist-interrupted");
    expect(marker).toHaveTextContent("! 回答中断");
    expect(marker.className).toContain("--color-warning");
    expect(thread().getByText("可以，")).toBeInTheDocument();
    expect(announced()).toBe("回答中断 可以，");
    scripts.push(reply("可以，在三十天内。"));
    fireEvent.click(within(marker).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(asks).toHaveLength(2));
    expect(asks[1].body).toMatchObject({ question: "能申诉吗？", conversation_id: CONVERSATION_ID });
    expect(await thread().findByText("可以，在三十天内。")).toBeInTheDocument();
    expect(thread().queryByText("可以，")).not.toBeInTheDocument();
    expect(screen.queryByTestId("officer-assist-interrupted")).not.toBeInTheDocument();
    expect(thread().getAllByText("能申诉吗？")).toHaveLength(1);
  });

  it("A7: a connection lost after text is interrupted too, not a failure", async () => {
    const ask = await streaming();
    await act(async () => ask.send({ event: "delta", text: "一半" }));
    await screen.findByTestId("officer-assist-streaming");
    await act(async () => ask.close());
    expect(await screen.findByTestId("officer-assist-interrupted")).toBeInTheDocument();
    expect(screen.queryByText("助手这次没有答上来。你的问题还在。")).not.toBeInTheDocument();
  });

  it("A9: history keeps the markers but offers no retry", async () => {
    get.mockResolvedValue({
      data: [
        {
          id: CONVERSATION_ID,
          screen: "judgment",
          created_at: "2026-09-27T08:05:00Z",
          last_active_at: "2026-09-27T08:05:00Z",
          first_question: "能申诉吗？",
          messages: [
            { id: 1, role: "user", content: "能申诉吗？", interruption: "", created_at: "2026-09-27T08:05:00Z" },
            { id: 2, role: "assistant", content: "可以，", interruption: "interrupted", created_at: "2026-09-27T08:05:00Z" },
            { id: 3, role: "user", content: "要多久？", interruption: "", created_at: "2026-09-27T08:06:00Z" },
            { id: 4, role: "assistant", content: "三十", interruption: "stopped", created_at: "2026-09-27T08:06:00Z" },
          ],
        },
      ],
    });
    renderLayout();
    fireEvent.click(entry());
    fireEvent.click(await screen.findByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByText("能申诉吗？"));
    expect(await screen.findByTestId("officer-assist-interrupted")).toHaveTextContent("! 回答中断");
    expect(screen.getByTestId("officer-assist-stopped")).toHaveTextContent("已停止");
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("A4: scrolled up while streaming shows 「↓ 最新」; clicking it goes back down and follows again", async () => {
    const ask = await streaming();
    await act(async () => ask.send({ event: "delta", text: "第一段" }));
    const live = await screen.findByTestId("officer-assist-streaming");
    const scroller = live.closest("[class*='overflow-y-auto']") as HTMLDivElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 300 });
    expect(screen.queryByTestId("officer-assist-jump")).not.toBeInTheDocument();
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    const jump = await screen.findByTestId("officer-assist-jump");
    expect(jump).toHaveTextContent("↓ 最新");
    // Not following: new text does not move the reader.
    await act(async () => ask.send({ event: "delta", text: "第二段" }));
    expect(scroller.scrollTop).toBe(100);
    fireEvent.click(jump);
    expect(scroller.scrollTop).toBe(1000);
    await waitFor(() => expect(screen.queryByTestId("officer-assist-jump")).not.toBeInTheDocument());
  });

  it("A11 reduced motion: no cursor, and text arrives a whole paragraph at a time", async () => {
    reduceMotion = true;
    const ask = await streaming();
    await act(async () => ask.send({ event: "delta", text: "第一段正在写" }));
    const live = await screen.findByTestId("officer-assist-streaming");
    expect(live).not.toHaveTextContent("第一段正在写");
    await act(async () => ask.send({ event: "delta", text: "完。\n\n第二段" }));
    expect(live).toHaveTextContent("第一段正在写完。");
    expect(live).not.toHaveTextContent("第二段");
    expect(screen.queryByTestId("assist-cursor")).not.toBeInTheDocument();
  });
});
