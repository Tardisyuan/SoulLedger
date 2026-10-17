/**
 * 问一问 (Design batch 39, O-13a–c): the entry on every tab's top bar, the sheet's conversation
 * held above the tabs, suggestions by the tab's page, history in the same sheet (today / earlier,
 * delete confirmed in the sheet, a resumed one's strip), and never a silent resume — every
 * question carries the conversation it continues, or `new: true`.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { WEB_PAGE_KEYS, pageNameOf } from "../assist";
import { translate } from "../shared";
import { Shell } from "../shell";
import { renderOfficer } from "./harness";

const mockAsk = jest.fn();
const mockConversations = jest.fn();
const mockDelete = jest.fn();
jest.mock("@soulledger/core/api/officer-assist", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-assist"),
  officerAssistApi: {
    ask: (...a: unknown[]) => mockAsk(...a),
    conversations: (...a: unknown[]) => mockConversations(...a),
    deleteConversation: (...a: unknown[]) => mockDelete(...a),
  },
}));
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: {
    todo: jest.fn(async () => ({ data: { approvals: { count: 0, items: [] }, reassignments: { count: 0, items: [] }, cooldowns: { count: 0, items: [] }, rebirths: { count: 0, items: [] } } })),
    registerPush: jest.fn(),
    unregisterPush: jest.fn(),
  },
}));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));
jest.mock("@soulledger/core/api/judgment", () => ({
  judgmentApi: { list: jest.fn(async () => ({ data: { results: [] } })), claim: jest.fn(), queueCounts: jest.fn(async () => ({ data: { mine: 0, unclaimed: 0, others: 0, deferred: 0 } })) },
}));
jest.mock("@soulledger/core/api/notifications", () => ({
  notificationsApi: { list: jest.fn(async () => ({ data: { results: [] } })), markRead: jest.fn(async () => ({})), markAllRead: jest.fn(async () => ({})) },
}));

const answer = (content: string, id = "c-new") => ({ conversation_id: id, answer: { id: 1, role: "assistant", content, interruption: "", created_at: new Date().toISOString() } });
const message = (role: "user" | "assistant", content: string) => ({ id: Math.random(), role, content, interruption: "", created_at: new Date().toISOString() });

const NOW = new Date();
const TODAY_AT = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 0, 5).toISOString();
// A year back, so it is never "today" whenever this runs.
const OLD_AT = new Date(NOW.getFullYear() - 1, 9, 15, 17, 40).toISOString();
const TODAY = { id: "c-today", screen: "workflow", created_at: TODAY_AT, last_active_at: TODAY_AT, first_question: "会签和加签有什么区别？", messages: [message("user", "会签和加签有什么区别？"), message("assistant", "会签要每个人都批。")] };
const OLD = { id: "c-old", screen: "souls", created_at: OLD_AT, last_active_at: OLD_AT, first_question: "暂居的灵魂我能看到哪些字段？", messages: [message("user", "暂居的灵魂我能看到哪些字段？"), message("assistant", "姓名、状态、文明。")] };

beforeEach(() => {
  jest.clearAllMocks();
  mockConversations.mockResolvedValue([TODAY, OLD]);
  mockDelete.mockResolvedValue(undefined);
});

async function openSheet() {
  await act(async () => {}); // the tab's own loads land first
  fireEvent.press(await screen.findByTestId("assist-entry"));
  return screen.findByTestId("assist-sheet");
}
async function toTab(tab: string) {
  fireEvent.press(screen.getByTestId(`tab-${tab}`));
  await act(async () => {}); // the tab's own loads land
}

describe("the entry", () => {
  it("is on all five tabs' top bars, labelled with the tab, and 查询 has no switch any more", async () => {
    renderOfficer(<Shell />);
    const names: Record<string, string> = { todo: "待办", queue: "审判", search: "查询", notices: "通知", me: "我的" };
    for (const [tab, name] of Object.entries(names)) {
      await toTab(tab);
      expect(screen.getByTestId("assist-entry").props.accessibilityLabel).toBe(`问一问 · 关于${name}`);
    }
    await toTab("search");
    expect(screen.queryByTestId("search-mode")).toBeNull();
    expect(screen.queryByTestId("ask-input")).toBeNull();
    expect(screen.getByTestId("soul-search")).toBeTruthy();
  });
});

describe("suggested questions", () => {
  it("come from the role × page table by the tab's page, two of them, and a tap sends it as a new conversation", async () => {
    mockAsk.mockResolvedValue(answer("你的队列有 3 件。"));
    renderOfficer(<Shell />);
    await toTab("queue");
    await openSheet();
    expect(screen.getByText("关于审判，常被问到的：")).toBeTruthy();
    // JUDGE on judgment.
    expect(screen.getByTestId("assist-suggestion-0")).toHaveTextContent("我的队列有多少？");
    expect(screen.getByTestId("assist-suggestion-1")).toHaveTextContent("为什么我不能结案？");
    expect(screen.queryByTestId("assist-suggestion-2")).toBeNull();
    fireEvent.press(screen.getByTestId("assist-suggestion-0"));
    expect(await screen.findByText("你的队列有 3 件。")).toBeTruthy();
    expect(mockAsk).toHaveBeenCalledWith({ question: "我的队列有多少？", screen: "judgment", new: true });
    expect(screen.queryByTestId("assist-suggestions")).toBeNull();
  });

  it("待办 asks as the workflow page, 查询 as souls (JUDGE's other-page pair)", async () => {
    renderOfficer(<Shell />);
    await openSheet();
    expect(screen.getByTestId("assist-suggestion-0")).toHaveTextContent("待我审批的有几件？");
    fireEvent.press(screen.getByTestId("assist-close"));
    await toTab("search");
    await openSheet();
    expect(screen.getByTestId("assist-suggestion-0")).toHaveTextContent("这一页是做什么的？");
  });
});

describe("the conversation lives above the tabs", () => {
  it("survives closing the sheet and switching tabs, and the next question continues it by id", async () => {
    mockAsk.mockResolvedValueOnce(answer("有 2 件。")).mockResolvedValueOnce(answer("下一步是终审。"));
    renderOfficer(<Shell />);
    await openSheet();
    fireEvent.changeText(screen.getByTestId("ask-input"), "待我审批的有几件？");
    fireEvent.press(screen.getByTestId("ask-send"));
    expect(await screen.findByText("有 2 件。")).toBeTruthy();

    fireEvent.press(screen.getByTestId("assist-close"));
    expect(screen.queryByTestId("assist-sheet")).toBeNull();
    await toTab("notices");
    await openSheet();
    expect(screen.getByText("有 2 件。")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("ask-input"), "下一步呢？");
    fireEvent.press(screen.getByTestId("ask-send"));
    expect(await screen.findByText("下一步是终审。")).toBeTruthy();
    // The page it was first asked on, the conversation it continues, and no `new`.
    expect(mockAsk).toHaveBeenLastCalledWith({ question: "下一步呢？", screen: "workflow", conversation_id: "c-new" });
  });

  it("新会话 shows only once there is something, and the question after it is `new` again", async () => {
    mockAsk.mockResolvedValue(answer("有。"));
    renderOfficer(<Shell />);
    await openSheet();
    expect(screen.queryByTestId("assist-new")).toBeNull();
    fireEvent.press(screen.getByTestId("assist-suggestion-0"));
    await screen.findByText("有。");
    fireEvent.press(screen.getByTestId("assist-new"));
    expect(screen.getByTestId("assist-suggestions")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assist-suggestion-1"));
    await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(2));
    expect(mockAsk.mock.calls[1][0]).toMatchObject({ new: true });
    expect(mockAsk.mock.calls[1][0].conversation_id).toBeUndefined();
  });
});

describe("history, in the same sheet", () => {
  it("groups today and earlier, with the retention line on top and the end line at the bottom", async () => {
    renderOfficer(<Shell />);
    await openSheet();
    fireEvent.press(screen.getByTestId("assist-history"));
    const today = await screen.findByTestId("assist-group-today");
    expect(within(today).getByText("今天")).toBeTruthy();
    expect(within(today).getByText("待办 · 今天 00:05")).toBeTruthy();
    const earlier = screen.getByTestId("assist-group-earlier");
    expect(within(earlier).getByText("更早")).toBeTruthy();
    expect(within(earlier).getByText("查询 · 10-15 17:40")).toBeTruthy();
    expect(within(earlier).queryByText(/会签/)).toBeNull();
    expect(screen.getByText("会话保存 30 天后自动删除。")).toBeTruthy();
    expect(screen.getByTestId("assist-history-end")).toBeTruthy();
    // 新会话 is always in the history's head.
    expect(screen.getByTestId("assist-new")).toBeTruthy();
  });

  it("asks before deleting, in the sheet, and only deletes on confirm", async () => {
    renderOfficer(<Shell />);
    await openSheet();
    fireEvent.press(screen.getByTestId("assist-history"));
    fireEvent.press(await screen.findByTestId("assist-delete-c-today"));
    const confirm = screen.getByTestId("assist-delete-confirm");
    expect(within(confirm).getByText(/从「待办」开始的这段会话会立即删除/)).toBeTruthy();
    fireEvent.press(screen.getByTestId("assist-delete-cancel"));
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("assist-row-c-today")).toBeTruthy();

    fireEvent.press(screen.getByTestId("assist-delete-c-today"));
    fireEvent.press(screen.getByTestId("assist-delete-ok"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("c-today"));
    await waitFor(() => expect(screen.queryByTestId("assist-row-c-today")).toBeNull());
  });

  it("a failed delete says so and keeps the row", async () => {
    mockDelete.mockRejectedValue(new Error("x"));
    renderOfficer(<Shell />);
    await openSheet();
    fireEvent.press(screen.getByTestId("assist-history"));
    fireEvent.press(await screen.findByTestId("assist-delete-c-old"));
    fireEvent.press(screen.getByTestId("assist-delete-ok"));
    expect(await screen.findByText("删除失败，请重试。")).toBeTruthy();
    expect(screen.getByTestId("assist-row-c-old")).toBeTruthy();
  });

  it("an empty history and a failed one use the web's words", async () => {
    mockConversations.mockResolvedValueOnce([]);
    renderOfficer(<Shell />);
    await openSheet();
    fireEvent.press(screen.getByTestId("assist-history"));
    expect(await screen.findByTestId("assist-history-empty")).toBeTruthy();
    expect(screen.queryByTestId("assist-history-end")).toBeNull();

    mockConversations.mockRejectedValueOnce(new Error("x"));
    fireEvent.press(screen.getByTestId("assist-back"));
    fireEvent.press(screen.getByTestId("assist-history"));
    expect(await screen.findByText("历史会话加载失败，请重试。")).toBeTruthy();
  });
});

describe("a conversation opened from history", () => {
  it("an earlier one shows its date and page, no suggestions, 接着问…, and continues on its own page from any tab", async () => {
    mockAsk.mockResolvedValue(answer("审判和功过要到原属殿查看。", "c-old"));
    renderOfficer(<Shell />);
    await toTab("queue");
    await openSheet();
    fireEvent.press(screen.getByTestId("assist-history"));
    fireEvent.press(await screen.findByText("暂居的灵魂我能看到哪些字段？"));
    expect(await screen.findByTestId("assist-resumed")).toHaveTextContent("10-15 的会话 · 在「查询」问的");
    expect(screen.getByText("姓名、状态、文明。")).toBeTruthy();
    expect(screen.queryByTestId("assist-suggestions")).toBeNull();
    expect(screen.getByTestId("ask-input").props.placeholder).toBe("接着问…");
    // Read again on open, not taken from the list already on screen.
    expect(mockConversations).toHaveBeenCalledTimes(2);

    fireEvent.changeText(screen.getByTestId("ask-input"), "那审判记录呢？");
    fireEvent.press(screen.getByTestId("ask-send"));
    await screen.findByText("审判和功过要到原属殿查看。");
    // On the 审判 tab, still asked as 查询's page.
    expect(mockAsk).toHaveBeenCalledWith({ question: "那审判记录呢？", screen: "souls", conversation_id: "c-old" });
  });

  it("today's one has no strip; ‹ goes back to history", async () => {
    renderOfficer(<Shell />);
    await openSheet();
    fireEvent.press(screen.getByTestId("assist-history"));
    fireEvent.press(await screen.findByText("会签和加签有什么区别？"));
    expect(await screen.findByText("会签要每个人都批。")).toBeTruthy();
    expect(screen.queryByTestId("assist-resumed")).toBeNull();
    fireEvent.press(screen.getByTestId("assist-back-history"));
    expect(await screen.findByTestId("assist-group-today")).toBeTruthy();
  });

  it("one that cannot be read again (gone, or the request failed) is 「没能打开」, and the current one is kept", async () => {
    renderOfficer(<Shell />);
    await openSheet();
    fireEvent.press(screen.getByTestId("assist-history"));
    await screen.findByTestId("assist-row-c-old");
    mockConversations.mockResolvedValueOnce([TODAY]);
    fireEvent.press(screen.getByText("暂居的灵魂我能看到哪些字段？"));
    expect(await screen.findByText("这段会话没能打开，请重试")).toBeTruthy();
    expect(screen.queryByTestId("assist-row-c-old")).toBeNull();

    mockConversations.mockRejectedValueOnce(new Error("x"));
    fireEvent.press(screen.getByText("会签和加签有什么区别？"));
    expect(await screen.findByText("这段会话没能打开，请重试")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assist-back"));
    expect(screen.getByTestId("assist-suggestions")).toBeTruthy();
  });
});

// ── Design 第四十批 第四节 1 / 7 ─────────────────────────────────────────

describe("history names a desk conversation by the desk's own page", () => {
  const zh = (key: string) => translate("zh-Hans", key);
  it("the App's five pages keep the tab names; a desk page keeps the desk sidebar's name; 其他页 only as the fallback", () => {
    expect(pageNameOf("judgment", zh)).toBe("审判");
    expect(pageNameOf("dispatch", zh)).toBe("调度管理");
    expect(pageNameOf("cross-judgments", zh)).toBe("跨域审判");
    expect(pageNameOf("rebirth-applications", zh)).toBe("转生申请");
    expect(pageNameOf("about", zh)).toBe("其他页");
    expect(pageNameOf("other", zh)).toBe("其他页");
  });

  it("every desk key it names exists in zh and en", () => {
    for (const key of Object.values(WEB_PAGE_KEYS)) {
      for (const locale of ["zh-Hans", "en"] as const) expect(translate(locale, key!)).not.toBe(key);
    }
  });
});

describe("the ask box's label is for screen readers only", () => {
  it("carries 问一问 as its accessibility label and shows no label of its own", async () => {
    renderOfficer(<Shell />);
    await openSheet();
    const input = await screen.findByTestId("ask-input");
    expect(input.props.accessibilityLabel).toBe("问一问");
  });
});
