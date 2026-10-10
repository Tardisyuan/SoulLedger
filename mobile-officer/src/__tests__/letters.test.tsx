/**
 * 待回书信: the to-do group (present only with letters, always last), the thread (the soul's letters
 * left, the hall's right, no bubble colour), the template that is FILLED not sent, the send (once, the
 * words kept on a failure), and the quiet 503.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { TodoTab } from "../screens/todo";
import { Detail } from "../screens/detail";
import { INBOX_REPLY_MAX } from "@soulledger/core/api/soul-inbox";
import { TODO_GROUPS, noticeLanding, replyFailureKey, replyReady, withTemplate } from "../rules";
import { httpError, renderOfficer } from "./harness";

const mockTodo = jest.fn();
const mockGet = jest.fn();
const mockMessages = jest.fn();
const mockReply = jest.fn();
const mockTemplates = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: (...a: unknown[]) => mockTodo(...a), registerPush: jest.fn(), unregisterPush: jest.fn() },
}));
jest.mock("@soulledger/core/api/soul-inbox", () => ({
  ...jest.requireActual("@soulledger/core/api/soul-inbox"),
  soulInboxApi: {
    get: (...a: unknown[]) => mockGet(...a),
    messages: (...a: unknown[]) => mockMessages(...a),
    reply: (...a: unknown[]) => mockReply(...a),
  },
  inboxTemplatesApi: { list: (...a: unknown[]) => mockTemplates(...a) },
}));

const group = (items: object[]) => ({ count: items.length, items });
const row = (kind: string, id: string) => ({ kind, id, title: `t-${id}`, created_at: "2026-10-09T01:00:00Z", target: { kind, id } });
const NONE = { approvals: group([]), reassignments: group([]), cooldowns: group([]), rebirths: group([]), letters: group([]) };

const CONVO = { id: "c-1", soul_name: "李白", closed_at: null, last_from: "soul" };
// Newest first, as the server sends them.
const MESSAGES = [
  { event_id: "e2", from_officer: true, sender_name: "崔珏", officer_title: "判官", body: "已收到，容我细查。", timestamp: Date.UTC(2026, 9, 9, 3, 0) },
  { event_id: "e1", from_officer: false, sender_name: "李白", officer_title: "", body: "请问我的案子何时判？", timestamp: Date.UTC(2026, 9, 9, 2, 0) },
];
const TEMPLATE = { id: "tp-1", title: "已收到", body: "{{soul_name}}：{{hall_name}}已收到您的来信。<b>x</b>", created_at: "", updated_at: "" };

async function openThread() {
  const onSettled = jest.fn();
  renderOfficer(<Detail target={{ type: "todo", kind: "letter", id: "c-1" }} onBack={() => {}} onSettled={onSettled} />);
  await screen.findByTestId("letter-thread");
  return { onSettled };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTodo.mockResolvedValue({ data: NONE });
  mockGet.mockResolvedValue({ data: CONVO });
  mockMessages.mockResolvedValue({ data: MESSAGES });
  mockTemplates.mockResolvedValue({ data: [TEMPLATE] });
});

describe("rules", () => {
  it("待回书信 is the last group, after the four that were there", () => {
    expect(TODO_GROUPS.map((g) => g.field)).toEqual(["approvals", "reassignments", "cooldowns", "rebirths", "letters"]);
  });
  it("the assignment notification lands on the thread", () => {
    expect(noticeLanding({ related_resource: "soul_inbox", related_id: "c-1" })).toEqual({ tab: "todo", item: { kind: "letter", id: "c-1" } });
  });
  it("a blank or over-long reply is not ready; the limit is the server's", () => {
    expect(replyReady("")).toBe(false);
    expect(replyReady(" \n\t ")).toBe(false);
    expect(replyReady("好")).toBe(true);
    expect(replyReady("好".repeat(INBOX_REPLY_MAX))).toBe(true);
    expect(replyReady("好".repeat(INBOX_REPLY_MAX + 1))).toBe(false);
    expect(INBOX_REPLY_MAX).toBe(4000);
  });
  it("a template is filled as text: two names replaced, markup and unknown placeholders left as written", () => {
    const values = { soul_name: "李白", hall_name: "酆都" };
    expect(withTemplate("", "{{soul_name}}@{{hall_name}} <b>x</b> {{other}}", values)).toBe("李白@酆都 <b>x</b> {{other}}");
    expect(withTemplate("先写了", "模板", values)).toBe("先写了\n\n模板");
    expect(withTemplate("", "好".repeat(INBOX_REPLY_MAX + 50), values).length).toBe(INBOX_REPLY_MAX);
  });
  it("says why a reply failed without quoting anything", () => {
    expect(replyFailureKey(httpError(503, { code: "chat_not_configured" }))).toBe("officer_app.letter.unavailable");
    expect(replyFailureKey(httpError(409, { code: "closed" }))).toBe("soul_inbox.errors.closed");
    expect(replyFailureKey(new Error("Network Error"))).toBe("officer_app.letter.failed");
  });
});

describe("the to-do group", () => {
  it("is drawn last, titled with its count, and a row opens the thread", async () => {
    mockTodo.mockResolvedValue({ data: { ...NONE, approvals: group([row("approval", "a1")]), letters: group([row("letter", "c-1"), row("letter", "c-2")]) } });
    const onOpen = jest.fn();
    renderOfficer(<TodoTab highlight={null} onOpen={onOpen} />);
    expect(await screen.findByText("待回书信 · 2")).toBeTruthy();
    const drawn = screen.root.findAll((n) => typeof n.props.testID === "string" && /^todo-group-/.test(n.props.testID)).map((n) => n.props.testID);
    expect([...new Set(drawn)]).toEqual(["todo-group-approval", "todo-group-letter"]);
    fireEvent.press(screen.getByTestId("todo-row-letter-c-1"));
    expect(onOpen).toHaveBeenCalledWith({ kind: "letter", id: "c-1" });
  });
  it("is not drawn when it is empty, or when an older server never sent it", async () => {
    mockTodo.mockResolvedValue({ data: { ...NONE, approvals: group([row("approval", "a1")]) } });
    const { unmount } = renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    await screen.findByText("审批节点 · 1");
    expect(screen.queryByTestId("todo-group-letter")).toBeNull();
    expect(screen.queryByText(/待回书信/)).toBeNull();
    unmount();
    const { letters: _omitted, ...older } = { ...NONE, approvals: group([row("approval", "a1")]) };
    mockTodo.mockResolvedValue({ data: older });
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    await screen.findByText("审批节点 · 1");
    expect(screen.queryByTestId("todo-group-letter")).toBeNull();
  });
  it("a list of only letters is not the empty state", async () => {
    mockTodo.mockResolvedValue({ data: { ...NONE, letters: group([row("letter", "c-1")]) } });
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    expect(await screen.findByText("待回书信 · 1")).toBeTruthy();
    expect(screen.queryByText("此刻没有轮到你的事")).toBeNull();
  });
});

describe("the thread", () => {
  it("reads oldest first; the soul's letter at the left, the hall's reply at the right, neither in a coloured bubble", async () => {
    await openThread();
    await screen.findByText("请问我的案子何时判？");
    const ids = screen.root.findAll((n) => typeof n.props.testID === "string" && /^letter-(soul|hall)-/.test(n.props.testID)).map((n) => n.props.testID);
    expect([...new Set(ids)]).toEqual(["letter-soul-e1", "letter-hall-e2"]);
    const soul = StyleSheet.flatten(screen.getByTestId("letter-soul-e1").props.style);
    const hall = StyleSheet.flatten(screen.getByTestId("letter-hall-e2").props.style);
    expect(soul.alignSelf).toBe("flex-start");
    expect(hall.alignSelf).toBe("flex-end");
    expect(soul.backgroundColor).toBeUndefined();
    expect(hall.backgroundColor).toBeUndefined();
    // Author and time on one line.
    expect(screen.getByText(/^崔珏 · 判官 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeTruthy();
    expect(screen.getByText(/^李白 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeTruthy();
  });

  it("says 发出后不能撤回 above 发送, and asks nothing after it", async () => {
    mockReply.mockResolvedValue({ data: { event_id: "e3" } });
    await openThread();
    expect(screen.getByText("发出后不能撤回")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("letter-input"), "稍候回复");
    fireEvent.press(screen.getByTestId("letter-send"));
    await waitFor(() => expect(mockReply).toHaveBeenCalledTimes(1));
  });

  it("a chosen template is filled into the box and NOT sent; the officer can still edit it", async () => {
    await openThread();
    fireEvent.press(await screen.findByTestId("letter-template"));
    fireEvent.press(await screen.findByTestId("template-tp-1"));
    expect(screen.getByTestId("letter-input").props.value).toBe("李白：酆都已收到您的来信。<b>x</b>");
    expect(mockReply).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId("letter-input"), "李白：容我细查。");
    expect(screen.getByTestId("letter-input").props.value).toBe("李白：容我细查。");
    expect(mockReply).not.toHaveBeenCalled();
  });

  it("sends the trimmed words once, clears the box, and tells the list to ask again", async () => {
    mockReply.mockResolvedValue({ data: { event_id: "e3" } });
    const { onSettled } = await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "  稍候回复  ");
    fireEvent.press(screen.getByTestId("letter-send"));
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith("c-1", "稍候回复"));
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("letter-input").props.value).toBe(""));
    expect(mockMessages.mock.calls.length).toBeGreaterThan(1);
  });

  it("sends nothing for a blank box", async () => {
    await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "  \n ");
    fireEvent.press(screen.getByTestId("letter-send"));
    expect(mockReply).not.toHaveBeenCalled();
  });

  it("two quick presses make one reply", async () => {
    let finish: (v: unknown) => void = () => {};
    mockReply.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "稍候回复");
    fireEvent.press(screen.getByTestId("letter-send"));
    fireEvent.press(screen.getByTestId("letter-send"));
    expect(mockReply).toHaveBeenCalledTimes(1);
    finish({ data: { event_id: "e3" } });
    await waitFor(() => expect(screen.getByTestId("letter-input").props.value).toBe(""));
  });

  it("a failed send keeps what was typed, says so, and can be sent again", async () => {
    mockReply.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValueOnce({ data: { event_id: "e3" } });
    const { onSettled } = await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "稍候回复");
    fireEvent.press(screen.getByTestId("letter-send"));
    expect(await screen.findByTestId("letter-failed")).toBeTruthy();
    expect(screen.getByTestId("letter-input").props.value).toBe("稍候回复");
    expect(onSettled).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("letter-send"));
    await waitFor(() => expect(mockReply).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("letter-failed")).toBeNull());
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

  it("503 on the thread is said quietly: no composer, no error screen", async () => {
    mockMessages.mockRejectedValue(httpError(503, { code: "chat_not_configured" }));
    renderOfficer(<Detail target={{ type: "todo", kind: "letter", id: "c-1" }} onBack={() => {}} onSettled={() => {}} />);
    expect(await screen.findByTestId("letter-unavailable")).toBeTruthy();
    expect(screen.getByText("书信暂未开通")).toBeTruthy();
    expect(screen.queryByTestId("letter-input")).toBeNull();
    expect(screen.queryByTestId("state-error")).toBeNull();
  });

  it("a closed thread has no box to write in", async () => {
    mockGet.mockResolvedValue({ data: { ...CONVO, closed_at: "2026-10-09T05:00:00Z" } });
    await openThread();
    expect(screen.getByTestId("letter-closed")).toBeTruthy();
    expect(screen.queryByTestId("letter-input")).toBeNull();
    expect(screen.queryByTestId("letter-send")).toBeNull();
  });

  it("without the template list (no permission, service down) the row is simply absent", async () => {
    mockTemplates.mockRejectedValue(httpError(403));
    await openThread();
    await waitFor(() => expect(mockTemplates).toHaveBeenCalled());
    expect(screen.queryByTestId("letter-template")).toBeNull();
    expect(screen.getByTestId("letter-input")).toBeTruthy();
  });
});
