/**
 * The four states every tab shares (loading / empty / error / denied), the to-do list's grouping,
 * the pushed row's highlight and its absence under reduce-motion, and the locked-down parts of the
 * shell (the band shows the hall; the two-step banner stays until it is set up).
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { RefreshFailed, Row } from "../kit";
import { NoticesTab } from "../screens/notices";
import { QueueTab } from "../screens/queue";
import { SearchTab } from "../screens/search";
import { TodoTab } from "../screens/todo";
import { Shell } from "../shell";
import { OFFICER, httpError, renderOfficer } from "./harness";

const mockTodo = jest.fn();
const mockList = jest.fn();
const mockNotices = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: (...a: unknown[]) => mockTodo(...a), registerPush: jest.fn(), unregisterPush: jest.fn() },
}));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: false, required: true } })) },
}));
const mockClaim = jest.fn();
const mockCounts = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  judgmentApi: { list: (...a: unknown[]) => mockList(...a), claim: (...a: unknown[]) => mockClaim(...a), queueCounts: (...a: unknown[]) => mockCounts(...a) },
}));
const mockSouls = jest.fn();
jest.mock("@soulledger/core/api/souls", () => ({
  ...jest.requireActual("@soulledger/core/api/souls"),
  soulsApi: { list: (...a: unknown[]) => mockSouls(...a) },
}));
jest.mock("@soulledger/core/api/notifications", () => ({
  notificationsApi: { list: (...a: unknown[]) => mockNotices(...a), markRead: jest.fn(async () => ({})), markAllRead: jest.fn(async () => ({})) },
}));

const group = (items: object[]) => ({ count: items.length, items });
const ITEM = { kind: "approval", id: "wf-1", title: "转生配额审批", created_at: "2026-10-09T01:00:00Z", target: { kind: "approval", id: "wf-1" }, node_name: "终审" };
const TODO = { approvals: group([ITEM]), reassignments: group([]), cooldowns: group([]), rebirths: group([]) };
const EMPTY = { approvals: group([]), reassignments: group([]), cooldowns: group([]), rebirths: group([]) };

beforeEach(() => {
  jest.clearAllMocks();
  mockTodo.mockResolvedValue({ data: TODO });
  mockList.mockResolvedValue({ data: { results: [] } });
  mockNotices.mockResolvedValue({ data: { results: [] } });
  mockCounts.mockResolvedValue({ data: { mine: 0, unclaimed: 0, others: 0, deferred: 0 } });
});

describe("the to-do tab", () => {
  it("draws five skeleton rows, aria-busy, while loading", async () => {
    mockTodo.mockReturnValue(new Promise(() => {}));
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    expect(screen.getByTestId("state-loading").props.accessibilityState).toEqual({ busy: true });
  });

  it("groups by kind and titles each group with its count", async () => {
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    expect(await screen.findByText("审批节点 · 1")).toBeTruthy();
    expect(screen.queryByTestId("todo-group-rebirth")).toBeNull();
    expect(screen.getByText("转生配额审批")).toBeTruthy();
  });

  it("draws the groups in the fixed order, titles the dispatch group 移交, and draws only the groups that have items", async () => {
    const row = (kind: string, id: string) => ({ kind, id, title: `t-${id}`, created_at: "2026-10-09T01:00:00Z", target: { kind, id } });
    // The server's keys arrive in a scrambled order on purpose: the screen's order does not come from them.
    mockTodo.mockResolvedValue({
      data: {
        rebirths: group([row("rebirth", "r1")]),
        reassignments: group([row("reassignment", "d1"), row("reassignment", "d2")]),
        cooldowns: group([row("cooldown", "c1")]),
        approvals: group([row("approval", "a1")]),
      },
    });
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    expect(await screen.findByText("移交 · 2")).toBeTruthy();
    const drawn = screen.root.findAll((n) => typeof n.props.testID === "string" && /^todo-group-/.test(n.props.testID)).map((n) => n.props.testID);
    expect([...new Set(drawn)]).toEqual(["todo-group-approval", "todo-group-reassignment", "todo-group-cooldown", "todo-group-rebirth"]);
    expect(screen.queryByText(/改派请求/)).toBeNull();
  });

  it("a handover row opens the same detail as a push would", async () => {
    mockTodo.mockResolvedValue({
      data: { ...EMPTY, reassignments: group([{ kind: "reassignment", id: "d1", title: "李白", created_at: "2026-10-09T01:00:00Z", target: { kind: "reassignment", id: "d1" } }]) },
    });
    const onOpen = jest.fn();
    renderOfficer(<TodoTab highlight={null} onOpen={onOpen} />);
    fireEvent.press(await screen.findByTestId("todo-row-reassignment-d1"));
    expect(onOpen).toHaveBeenCalledWith({ kind: "reassignment", id: "d1" });
  });

  it("opens the item's detail", async () => {
    const onOpen = jest.fn();
    renderOfficer(<TodoTab highlight={null} onOpen={onOpen} />);
    fireEvent.press(await screen.findByTestId("todo-row-approval-wf-1"));
    expect(onOpen).toHaveBeenCalledWith({ kind: "approval", id: "wf-1" });
  });

  it("empty: a title and one sentence", async () => {
    mockTodo.mockResolvedValue({ data: EMPTY });
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    expect(await screen.findByText("此刻没有轮到你的事")).toBeTruthy();
    expect(screen.getByText("新的审批、移交和申请会推送给你。")).toBeTruthy();
  });

  it("error: ! 没取到 and a retry that asks again", async () => {
    mockTodo.mockRejectedValueOnce(httpError(500)).mockResolvedValue({ data: TODO });
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    expect(await screen.findByTestId("state-error")).toBeTruthy();
    fireEvent.press(screen.getByTestId("state-retry"));
    expect(await screen.findByText("审批节点 · 1")).toBeTruthy();
  });

  it("denied: names the role and the area, no retry", async () => {
    mockTodo.mockRejectedValue(httpError(403));
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    expect(await screen.findByText("□ 没有权限")).toBeTruthy();
    expect(screen.getByText("你的角色「JUDGE」看不到待办。需要时请找本殿管理员。")).toBeTruthy();
    expect(screen.queryByTestId("state-retry")).toBeNull();
  });
});

describe("the other tabs have the same four states", () => {
  it("judgments: empty, denied", async () => {
    renderOfficer(<QueueTab onOpen={() => {}} />);
    expect(await screen.findByText("手上没有案子")).toBeTruthy();
    mockList.mockRejectedValue(httpError(403));
    fireEvent.press(screen.getByTestId("queue-group-unclaimed"));
    expect(await screen.findByTestId("state-denied")).toBeTruthy();
  });

  it("judgments: a row waiting for a verdict says to use the desk", async () => {
    mockList.mockResolvedValue({ data: { results: [{ id: "j1", case_number: "CN-2026-0007", soul_name: "李白", court: "一殿", is_final: false }] } });
    renderOfficer(<QueueTab onOpen={() => {}} />);
    expect(await screen.findByText("◇ 待宣判 · 请在官员台")).toBeTruthy();
  });

  it("judgments: a stale row says 滞留 and why; a fresh one says nothing", async () => {
    mockList.mockResolvedValue({
      data: {
        results: [
          { id: "j1", case_number: "CN-1", soul_name: "李白", court: "一殿", is_final: false, stale_since: "2026-10-01T01:00:00Z" },
          { id: "j2", case_number: "CN-2", soul_name: "杜甫", court: "一殿", is_final: false, stale_since: null },
        ],
      },
    });
    renderOfficer(<QueueTab onOpen={() => {}} />);
    const stale = await screen.findByTestId("queue-row-j1");
    expect(within(stale).getByText("◐ 滞留 · 30 天无进展")).toBeTruthy();
    expect(within(screen.getByTestId("queue-row-j2")).queryByText(/滞留/)).toBeNull();
  });

  const UNCLAIMED = { data: { results: [{ id: "j9", case_number: "CN-9", soul_name: "王九", court: "一殿", is_final: true }] } };

  it("judgments: 认领 that someone beat us to (409) asks the list and the counts again", async () => {
    mockList.mockResolvedValue(UNCLAIMED);
    mockClaim.mockRejectedValue(httpError(409));
    renderOfficer(<QueueTab onOpen={() => {}} />);
    fireEvent.press(await screen.findByTestId("queue-group-unclaimed"));
    fireEvent.press(await screen.findByTestId("queue-claim-j9"));
    await waitFor(() => expect(mockCounts).toHaveBeenCalledTimes(2));
    expect(mockList.mock.calls.filter(([p]) => (p as { group: string }).group === "unclaimed").length).toBeGreaterThanOrEqual(2);
  });

  it("judgments: no 认领 button without judgment.execute (it would 403)", async () => {
    mockList.mockResolvedValue(UNCLAIMED);
    renderOfficer(<QueueTab onOpen={() => {}} />, { user: { ...OFFICER, permissions: ["judgment.read"] } });
    fireEvent.press(await screen.findByTestId("queue-group-unclaimed"));
    await screen.findByText("CN-9 · 王九");
    expect(screen.queryByTestId("queue-claim-j9")).toBeNull();
  });

  it("judgments: held in 枉死城 — the mark and 候至, no 认领 but 到期后可认领; past the date the button is back", async () => {
    mockList.mockResolvedValue({
      data: {
        results: [
          { id: "j7", case_number: "CN-7", soul_name: "王守仁", court: "十殿", is_final: false, untimely: true, held_until: "2999-11-03" },
          { id: "j8", case_number: "CN-8", soul_name: "严嵩", court: "十殿", is_final: false, untimely: true, held_until: "2000-01-01" },
        ],
      },
    });
    renderOfficer(<QueueTab onOpen={() => {}} />);
    fireEvent.press(await screen.findByTestId("queue-group-unclaimed"));
    const held = await screen.findByTestId("queue-row-j7");
    expect(within(held).getByText("▢ 枉死 · 候至 2999-11-03")).toBeTruthy();
    expect(screen.getByTestId("queue-held-j7")).toHaveTextContent("到期后可认领");
    expect(screen.queryByTestId("queue-claim-j7")).toBeNull();
    const past = screen.getByTestId("queue-row-j8");
    expect(within(past).getByText("▢ 枉死")).toBeTruthy();
    expect(screen.getByTestId("queue-claim-j8")).toBeTruthy();
  });

  it("「加载更多」 that fails says so under the list, and 重试 asks again", async () => {
    let fail = true;
    mockList.mockImplementation(async (params: { page?: string }) => {
      if (params.page === "2") {
        if (fail) throw new Error("Network Error");
        return { data: { results: [], next: null } };
      }
      return { data: { results: UNCLAIMED.data.results, next: "http://x/?page=2" } };
    });
    renderOfficer(<QueueTab onOpen={() => {}} />);
    fireEvent.press(await screen.findByTestId("list-more"));
    expect(await screen.findByTestId("list-more-failed")).toBeTruthy();
    fail = false;
    fireEvent.press(screen.getByText("重试"));
    await waitFor(() => expect(screen.queryByTestId("list-more-failed")).toBeNull());
  });

  it("notices: unread is ● and bold, and tapping marks it read (○)", async () => {
    mockNotices.mockResolvedValue({ data: { results: [{ id: 1, title: "新审批", message: "有一件待办", is_read: false, created_at: "2026-10-09T01:00:00Z" }] } });
    const onRead = jest.fn();
    renderOfficer(<NoticesTab onRead={onRead} />);
    expect((await screen.findByText("●")).props.accessibilityLabel).toBe("未读"); // the only mark of "unread": spoken as a word
    fireEvent.press(screen.getByTestId("notice-1"));
    // Read: the ○ is decoration, so it is hidden from screen readers.
    expect((await screen.findByText("○", { includeHiddenElements: true })).props.accessibilityElementsHidden).toBe(true);
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1)); // the shell asks the server for the count again
  });

  it("notices: no big 「通知」 title under the top bar; 全部已读 stays", async () => {
    mockNotices.mockResolvedValue({ data: { results: [{ id: 1, title: "新审批", message: "有一件待办", is_read: false, created_at: "2026-10-09T01:00:00Z" }] } });
    renderOfficer(<NoticesTab />);
    await screen.findByTestId("notice-1");
    expect(screen.queryByText("通知")).toBeNull();
    expect(screen.getByTestId("notices-mark-all")).toBeTruthy();
  });

  it("notices: a row that names an item lands on it (read or not); one that names nothing only marks read", async () => {
    mockNotices.mockResolvedValue({
      data: {
        results: [
          { id: 1, title: "新审批", message: "", is_read: false, related_resource: "workflow", related_id: "wf-9", created_at: "2026-10-09T01:00:00Z" },
          { id: 2, title: "系统", message: "", is_read: false, related_resource: "scheduler", related_id: "5", created_at: "2026-10-09T01:00:00Z" },
        ],
      },
    });
    const onLand = jest.fn();
    renderOfficer(<NoticesTab onLand={onLand} />);
    fireEvent.press(await screen.findByTestId("notice-1"));
    expect(onLand).toHaveBeenCalledWith({ tab: "todo", item: { kind: "approval", id: "wf-9" } });
    fireEvent.press(screen.getByTestId("notice-2"));
    expect(onLand).toHaveBeenCalledTimes(1);
    // Already read: still opens.
    fireEvent.press(screen.getByTestId("notice-1"));
    expect(onLand).toHaveBeenCalledTimes(2);
  });

  it("notices: error", async () => {
    mockNotices.mockRejectedValue(httpError(500));
    renderOfficer(<NoticesTab />);
    expect(await screen.findByTestId("state-error")).toBeTruthy();
  });
});

describe("lists the server pages (20 a page) show the rest on 「加载更多」", () => {
  const judgment = (n: number) => ({ id: `j${n}`, case_number: `CN-${n}`, soul_name: `魂${n}`, court: "一殿", is_final: true });

  it("judgments: page 2 is appended under page 1 and the button goes with the last page", async () => {
    mockList.mockImplementation(async (params: { page?: string }) =>
      params.page === "2" ? { data: { results: [judgment(21)], next: null } } : { data: { results: [judgment(1), judgment(2)], next: "http://x/?page=2" } }
    );
    renderOfficer(<QueueTab onOpen={() => {}} />);
    expect(await screen.findByText("CN-1 · 魂1")).toBeTruthy();
    fireEvent.press(screen.getByTestId("list-more"));
    expect(await screen.findByText("CN-21 · 魂21")).toBeTruthy();
    expect(screen.getByText("CN-2 · 魂2")).toBeTruthy();
    expect(screen.queryByTestId("list-more")).toBeNull();
    expect(mockList).toHaveBeenCalledWith({ group: "mine", page: "2" });
  });

  it("judgments: a list with no next page has no button, and switching tab drops the extra pages", async () => {
    mockList.mockImplementation(async (params: { group: string; page?: string }) =>
      params.page === "2"
        ? { data: { results: [judgment(21)], next: null } }
        : { data: { results: [judgment(params.group === "mine" ? 1 : 7)], next: params.group === "mine" ? "http://x/?page=2" : null } }
    );
    renderOfficer(<QueueTab onOpen={() => {}} />);
    fireEvent.press(await screen.findByTestId("list-more"));
    await screen.findByText("CN-21 · 魂21");
    fireEvent.press(screen.getByTestId("queue-group-unclaimed"));
    expect(await screen.findByText("CN-7 · 魂7")).toBeTruthy();
    expect(screen.queryByText("CN-21 · 魂21")).toBeNull();
    expect(screen.queryByTestId("list-more")).toBeNull();
  });

  it("notices: the same", async () => {
    const notice = (id: number) => ({ id, title: `通知${id}`, message: "", is_read: true, created_at: "2026-10-09T01:00:00Z" });
    mockNotices.mockImplementation(async (params?: { page?: string }) =>
      params?.page === "2" ? { data: { results: [notice(21)], next: null } } : { data: { results: [notice(1)], next: "http://x/?page=2" } }
    );
    renderOfficer(<NoticesTab />);
    fireEvent.press(await screen.findByTestId("list-more"));
    expect(await screen.findByText("通知21")).toBeTruthy();
    expect(screen.getByText("通知1")).toBeTruthy();
  });
});

describe("a refresh that failed while the old list is on screen (A22)", () => {
  it("says so and offers a retry; says nothing for no data, a 403, or no error", () => {
    const retry = jest.fn();
    renderOfficer(<RefreshFailed data={[1]} error={httpError(500)} onRetry={retry} />);
    expect(screen.getByTestId("refresh-failed")).toBeTruthy();
    screen.unmount();
    for (const [data, error] of [[null, httpError(500)], [[1], httpError(403)], [[1], null]] as const) {
      renderOfficer(<RefreshFailed data={data} error={error} onRetry={retry} />);
      expect(screen.queryByTestId("refresh-failed")).toBeNull();
      screen.unmount();
    }
  });
});

describe("the pushed row's highlight (spec §五)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("washes the row in", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    renderOfficer(<Row title="x" highlight />);
    await act(async () => {});
    expect(screen.getByTestId("row-highlight")).toBeTruthy();
  });

  it("is not drawn at all when the system asks for reduced motion", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    renderOfficer(<Row title="x" highlight />);
    await act(async () => {});
    expect(screen.queryByTestId("row-highlight")).toBeNull();
  });

  it("is not drawn on a row that was not pushed", async () => {
    renderOfficer(<Row title="x" />);
    await act(async () => {});
    expect(screen.queryByTestId("row-highlight")).toBeNull();
  });
});

describe("the shell", () => {
  it("shows the officer's hall in the identity band and five tabs", async () => {
    renderOfficer(<Shell />);
    // The civilization's underworld name, not the tenant's English display_name (seen on the emulator).
    expect(await screen.findByText("酆都")).toBeTruthy();
    expect(screen.queryByText("Chinese Afterlife")).toBeNull();
    // Me reads the role through the bundles, not the raw code.
    fireEvent.press(screen.getByTestId("tab-me"));
    expect(await screen.findByText("审判者")).toBeTruthy();
    expect(screen.queryByText("JUDGE")).toBeNull();
    for (const tab of ["todo", "queue", "search", "notices", "me"]) expect(screen.getByTestId(`tab-${tab}`)).toBeTruthy();
    expect(screen.queryByTestId("mfa-banner")).toBeNull();
  });

  it("keeps the banner on screen for a role that must use two-step verification and has not set it up", async () => {
    renderOfficer(<Shell />, { user: { ...OFFICER, mfa_enabled: false, mfa_required: true } });
    expect(await screen.findByTestId("mfa-banner")).toBeTruthy();
    fireEvent.press(screen.getByTestId("tab-me"));
    await act(async () => {}); // let the Me tab's own loads land before the test ends
    expect(screen.getByTestId("mfa-banner")).toBeTruthy();
  });

  it("marks 通知 ● from the server's unread count, without the tab ever being opened", async () => {
    mockNotices.mockImplementation(async (params?: { is_read?: string }) =>
      params?.is_read === "false" ? { data: { count: 3, results: [] } } : { data: { results: [] } }
    );
    renderOfficer(<Shell />);
    await waitFor(() => expect(within(screen.getByTestId("tab-notices")).getByText("●")).toBeTruthy());
    expect(mockNotices).toHaveBeenCalledWith({ is_read: "false" });
  });

  it("a push that arrives while the app is open asks the lists and the unread count again", async () => {
    const { __state } = jest.requireMock("expo-notifications") as { __state: { receivedListeners: Set<() => void> } };
    renderOfficer(<Shell />);
    await screen.findByText("转生配额审批");
    const todoCalls = mockTodo.mock.calls.length;
    const countCalls = mockNotices.mock.calls.length;
    await act(async () => {
      __state.receivedListeners.forEach((l) => l());
    });
    await waitFor(() => expect(mockTodo.mock.calls.length).toBeGreaterThan(todoCalls));
    expect(mockNotices.mock.calls.length).toBeGreaterThan(countCalls);
  });
});

// ── Design 第四十批 ─────────────────────────────────────────────────────

describe("查询 finds a case by its number too (O-d)", () => {
  const CASE = { id: "j-42", case_number: "CN-2026-0042", soul_name: "王守仁", court: "酆都第十殿" };
  const search = (text: string) => {
    fireEvent.changeText(screen.getByTestId("soul-search"), text);
    fireEvent(screen.getByTestId("soul-search"), "submitEditing");
  };

  it("one box, the new placeholder", async () => {
    renderOfficer(<SearchTab onOpenSoul={() => {}} />);
    expect(screen.getByTestId("soul-search").props.placeholder).toBe("姓名、编号或案号");
    await act(async () => {}); // 打开时取的「最近」等落定
  });

  it("a whole case number pins a 案件 group above the souls, and does not jump to it", async () => {
    mockSouls.mockResolvedValue({ data: { results: [], count: 0, next: null } });
    mockList.mockResolvedValue({ data: { results: [CASE, { ...CASE, id: "j-43", case_number: "CN-2026-00421" }] } });
    const onOpenJudgment = jest.fn();
    renderOfficer(<SearchTab onOpenSoul={() => {}} onOpenJudgment={onOpenJudgment} />);
    search("cn-2026-0042");
    expect(await screen.findByTestId("case-row-j-42")).toBeTruthy();
    expect(screen.queryByTestId("case-row-j-43")).toBeNull(); // only the exact match
    expect(screen.getByText("案件")).toBeTruthy();
    expect(await screen.findByTestId("search-no-soul")).toBeTruthy();
    expect(screen.getByText("没有编号或姓名对得上的灵魂")).toBeTruthy();
    expect(onOpenJudgment).not.toHaveBeenCalled();
    expect(mockList).toHaveBeenCalledWith({ search: "cn-2026-0042" });
    fireEvent.press(screen.getByTestId("case-row-j-42"));
    expect(onOpenJudgment).toHaveBeenCalledWith("j-42");
  });

  it("a name does not ask the judgments at all", async () => {
    mockSouls.mockResolvedValue({ data: { results: [], count: 0, next: null } });
    renderOfficer(<SearchTab onOpenSoul={() => {}} />);
    search("王守仁");
    expect(await screen.findByText("没有找到")).toBeTruthy();
    expect(mockList).not.toHaveBeenCalled();
    expect(screen.queryByTestId("search-cases")).toBeNull();
  });
});

describe("rows whose detail was gone (O-c)", () => {
  it("a notice that lands on a gone item is greyed and opens nothing", async () => {
    mockNotices.mockResolvedValue({
      data: { results: [{ id: 1, title: "t", message: "", is_read: true, notification_type: "WORKFLOW_ASSIGNED", related_resource: "workflow", related_id: "wf-9", created_at: "2026-10-09T01:00:00Z" }] },
    });
    const onLand = jest.fn();
    renderOfficer(<NoticesTab gone={new Set(["approval:wf-9"])} onLand={onLand} />);
    fireEvent.press(await screen.findByTestId("notice-1"));
    expect(onLand).not.toHaveBeenCalled();
  });

  it("a queue row whose case was gone is greyed and opens nothing", async () => {
    mockList.mockResolvedValue({ data: { results: [{ id: "j-1", case_number: "C-1", soul_name: "周", court: "" }] } });
    const onOpen = jest.fn();
    renderOfficer(<QueueTab gone={new Set(["judgment:j-1"])} onOpen={onOpen} />);
    fireEvent.press(await screen.findByTestId("queue-row-j-1"));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
