/**
 * The four states every tab shares (loading / empty / error / denied), the to-do list's grouping,
 * the pushed row's highlight and its absence under reduce-motion, and the locked-down parts of the
 * shell (the band shows the hall; the two-step banner stays until it is set up).
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, AppState, StyleSheet } from "react-native";

import { OnlineContext, type Online } from "../../../mobile/src/online";
import { officerDoors } from "@soulledger/core/domain/doors";
import { RefreshFailed, Row, TAB_CODES, TabBar, doorOf, visibleTabs } from "../kit";
import { themeFor, useI18n } from "../shared";
import { cacheWrite, clearReadCache } from "../readCache";
import { NoticesTab } from "../screens/notices";
import { QueueTab, overviewParts } from "../screens/queue";
import { SearchTab } from "../screens/search";
import { TodoTab } from "../screens/todo";
import { Shell } from "../shell";
import { OFFICER, httpError, renderOfficer } from "./harness";

const mockTodo = jest.fn();
const mockList = jest.fn();
const mockNotices = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { stats: jest.fn(async () => ({ data: { concluded_this_month: 0, concluded_total: 0, open_claims: 0, appeals_reviewed: 0, appeals_in_review: 0 } })), todo: (...a: unknown[]) => mockTodo(...a), registerPush: jest.fn(), unregisterPush: jest.fn() },
}));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: false, required: true } })) },
}));
const mockClaim = jest.fn();
const mockRelease = jest.fn();
const mockCounts = jest.fn();
const mockHallStats = jest.fn(async () => ({ data: { month_done_pct: null as number | null } }));
jest.mock("@soulledger/core/api/judgment", () => ({
  // `get` never settles: a case opened from the list just sits loading (the shell test below only needs it open).
  judgmentApi: { list: (...a: unknown[]) => mockList(...a), claim: (...a: unknown[]) => mockClaim(...a), release: (...a: unknown[]) => mockRelease(...a), queueCounts: (...a: unknown[]) => mockCounts(...a), hallStats: () => mockHallStats(), get: () => new Promise(() => {}) },
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
    expect(await screen.findByText("此刻没有待办")).toBeTruthy();
    expect(screen.getByText("新的审批、移交和申请会推送到这部手机。")).toBeTruthy();
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
    // The role's name, not its code (decision 30).
    expect(screen.getByText("本账号的角色「判官」看不到待办。需要时请找本殿管理员。")).toBeTruthy();
    expect(screen.queryByText(/「JUDGE」/)).toBeNull();
    expect(screen.queryByTestId("state-retry")).toBeNull();
  });
});

describe("the other tabs have the same four states", () => {
  // 案卷台 (第三十批): three groups asked separately; a row is drawn once, in the first group that has it.
  const byGroup = (groups: Record<string, object[]>) => async (p: { group: string }) => ({ data: { results: groups[p.group] ?? [] } });

  it("judgments: empty", async () => {
    renderOfficer(<QueueTab onOpen={() => {}} />);
    expect(await screen.findByText("案卷台上没有案卷")).toBeTruthy();
    expect(screen.getByText("新的案子到了会出现在这里。")).toBeTruthy();
  });

  it("judgments: denied names the role and the area", async () => {
    mockList.mockRejectedValue(httpError(403));
    renderOfficer(<QueueTab onOpen={() => {}} />);
    expect(await screen.findByTestId("state-denied")).toBeTruthy();
  });

  it("judgments: an overdue case in hand carries 「! 超期 N 日」; one not yet final 「◇ 待宣判」 with its deadline on the second line", async () => {
    mockList.mockImplementation(
      byGroup({
        mine: [
          { id: "j1", case_number: "CN-2026-0007", soul_name: "李白", court: "一殿", is_final: false, deadline_remaining_seconds: -86_400, is_overdue: true },
          { id: "j2", case_number: "CN-2026-0008", soul_name: "杜甫", court: "一殿", is_final: false, deadline_remaining_seconds: 3 * 86_400 },
        ],
      })
    );
    renderOfficer(<QueueTab onOpen={() => {}} />);
    const late = await screen.findByTestId("queue-row-j1");
    expect(within(late).getByText("! 超期 1 日")).toBeTruthy();
    expect(within(late).getByText("CN-2026-0007")).toBeTruthy();
    expect(within(late).getByText("李白")).toBeTruthy();
    expect(within(late).queryByText(/期限/)).toBeNull(); // the tag says it already
    expect(within(screen.getByTestId("queue-row-j2")).getByText("◇ 待宣判")).toBeTruthy();
    expect(within(screen.getByTestId("queue-row-j2")).getByText(/ · 期限 3 日$/)).toBeTruthy();
    expect(within(screen.getByTestId("queue-row-j2")).queryByText(/超期/)).toBeNull();
  });

  it("judgments: a stale case says 滞留 on its second line; a fresh one does not", async () => {
    mockList.mockImplementation(
      byGroup({
        mine: [
          { id: "j1", case_number: "CN-1", soul_name: "李白", court: "一殿", is_final: false, stale_since: "2026-10-01T01:00:00Z" },
          { id: "j2", case_number: "CN-2", soul_name: "杜甫", court: "一殿", is_final: false, stale_since: null },
        ],
      })
    );
    renderOfficer(<QueueTab onOpen={() => {}} />);
    expect(within(await screen.findByTestId("queue-row-j1")).getByText(/ · 滞留$/)).toBeTruthy();
    expect(within(screen.getByTestId("queue-row-j2")).queryByText(/滞留/)).toBeNull();
  });

  const UNCLAIMED = { data: { results: [{ id: "j9", case_number: "CN-9", soul_name: "王九", court: "一殿", is_final: true }] } };

  it("judgments: 认领 that someone beat us to (409) asks the lists and the counts again", async () => {
    mockList.mockImplementation(byGroup({ unclaimed: UNCLAIMED.data.results }));
    mockClaim.mockRejectedValue(httpError(409));
    renderOfficer(<QueueTab onOpen={() => {}} />);
    fireEvent.press(await screen.findByTestId("queue-claim-j9"));
    await waitFor(() => expect(mockCounts).toHaveBeenCalledTimes(2));
    expect(mockList.mock.calls.filter(([p]) => (p as { group: string }).group === "unclaimed").length).toBeGreaterThanOrEqual(2);
  });

  it("judgments: a case in hand swipes to 「放回」, which releases it", async () => {
    mockList.mockImplementation(byGroup({ mine: UNCLAIMED.data.results }));
    mockRelease.mockResolvedValue({ data: {} });
    renderOfficer(<QueueTab onOpen={() => {}} />);
    const put = await screen.findByTestId("queue-release-j9");
    expect(put).toHaveTextContent("放回");
    expect(screen.queryByTestId("queue-claim-j9")).toBeNull();
    fireEvent.press(put);
    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith("j9"));
  });

  it("judgments: 重试 after a failed start asks the counts again too (phone QA 10-29b: offline, both failed)", async () => {
    mockList.mockRejectedValue(httpError(500));
    mockCounts.mockRejectedValue(new Error("Network Error"));
    renderOfficer(<QueueTab onOpen={() => {}} />);
    const retry = await screen.findByTestId("state-retry");
    expect(mockCounts).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("desk-overview")).toBeNull();
    mockList.mockResolvedValue({ data: { results: [] } });
    mockCounts.mockResolvedValue({ data: { mine: 0, unclaimed: 7, others: 0, deferred: 0 } });
    fireEvent.press(retry);
    await waitFor(() => expect(mockCounts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("desk-overview")).toHaveTextContent(/今日 7 件/));
  });

  it("judgments: no 认领 without judgment.execute (it would 403)", async () => {
    mockList.mockImplementation(byGroup({ unclaimed: UNCLAIMED.data.results }));
    renderOfficer(<QueueTab onOpen={() => {}} />, { user: { ...OFFICER, permissions: ["judgment.read"] } });
    await screen.findByText("王九");
    expect(screen.queryByTestId("queue-claim-j9")).toBeNull();
  });

  it("judgments: held in 枉死城 — 到期后可认领, 枉死 · 候至 and no 认领; past the date 认领 is back", async () => {
    mockList.mockImplementation(
      byGroup({
        unclaimed: [
          { id: "j7", case_number: "CN-7", soul_name: "王守仁", court: "十殿", is_final: false, untimely: true, held_until: "2999-11-03" },
          { id: "j8", case_number: "CN-8", soul_name: "严嵩", court: "十殿", is_final: false, untimely: true, held_until: "2000-01-01" },
        ],
      })
    );
    renderOfficer(<QueueTab onOpen={() => {}} />);
    const held = await screen.findByTestId("queue-row-j7");
    expect(within(held).getByText("‖ 到期后可认领")).toBeTruthy();
    expect(within(held).getByText(/ · 枉死 · 候至 2999年 · 11月3日$/)).toBeTruthy();
    expect(within(held).queryByText(/2999-11-03/)).toBeNull();
    expect(screen.queryByTestId("queue-claim-j7")).toBeNull();
    expect(within(screen.getByTestId("queue-row-j8")).getByText(/ · 枉死$/)).toBeTruthy();
    expect(screen.getByTestId("queue-claim-j8")).toBeTruthy();
  });

  it("「加载更多」 that fails says so under the list, and 重试 asks again", async () => {
    let fail = true;
    mockList.mockImplementation(async (params: { group: string; page?: string }) => {
      if (params.page === "2") {
        if (fail) throw new Error("Network Error");
        return { data: { results: [], next: null } };
      }
      return params.group === "unclaimed" ? { data: { results: UNCLAIMED.data.results, next: "http://x/?page=2" } } : { data: { results: [] } };
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
    mockList.mockImplementation(async (params: { group: string; page?: string }) =>
      params.group !== "mine"
        ? { data: { results: [] } }
        : params.page === "2"
          ? { data: { results: [judgment(21)], next: null } }
          : { data: { results: [judgment(1), judgment(2)], next: "http://x/?page=2" } }
    );
    renderOfficer(<QueueTab onOpen={() => {}} />);
    expect(await screen.findByText("魂1")).toBeTruthy();
    fireEvent.press(screen.getByTestId("list-more"));
    expect(await screen.findByText("魂21")).toBeTruthy();
    expect(screen.getByText("魂2")).toBeTruthy();
    expect(screen.queryByTestId("list-more")).toBeNull();
    expect(mockList).toHaveBeenCalledWith({ group: "mine", page: "2" });
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

  // opt-apps2 N1: the shell's bump (a push, the foreground) remounted the tab (`key={version}`): back to the top,
  // the pages fetched with 「加载更多」 gone.
  it("the shell's bump reloads in place: same screen, the extra pages fetched again and still shown", async () => {
    const notice = (id: number, title = `通知${id}`) => ({ id, title, message: "", is_read: true, created_at: "2026-10-09T01:00:00Z" });
    let round = 0;
    mockNotices.mockImplementation(async (params?: { page?: string }) =>
      params?.page === "2" ? { data: { results: [notice(21, `通知21-${round}`)], next: null } } : { data: { results: [notice(0, `新${round}`), notice(1)], next: "http://x/?page=2" } }
    );
    let bump!: () => void;
    function Host() {
      const [version, setVersion] = useState(0);
      bump = () => setVersion((v) => v + 1);
      return <NoticesTab version={version} />;
    }
    renderOfficer(<Host />);
    fireEvent.press(await screen.findByTestId("list-more"));
    expect(await screen.findByText("通知21-0")).toBeTruthy();
    const before = screen.getByTestId("tab-notices-screen");
    round = 1;
    await act(async () => bump());
    expect(await screen.findByText("新1")).toBeTruthy();
    expect(await screen.findByText("通知21-1")).toBeTruthy(); // page 2 asked again, not dropped
    expect(screen.queryByText("通知21-0")).toBeNull();
    expect(screen.getByTestId("tab-notices-screen")).toBe(before); // not remounted
    expect(mockNotices.mock.calls.filter(([p]) => (p as { page?: string } | undefined)?.page === "2")).toHaveLength(2);
  });

  it("after a bump, a list that now ends on page 1 drops the extra pages", async () => {
    const notice = (id: number) => ({ id, title: `通知${id}`, message: "", is_read: true, created_at: "2026-10-09T01:00:00Z" });
    let short = false;
    mockNotices.mockImplementation(async (params?: { page?: string }) =>
      params?.page === "2" ? { data: { results: [notice(21)], next: null } } : { data: { results: [notice(1)], next: short ? null : "http://x/?page=2" } }
    );
    let bump!: () => void;
    function Host() {
      const [version, setVersion] = useState(0);
      bump = () => setVersion((v) => v + 1);
      return <NoticesTab version={version} />;
    }
    renderOfficer(<Host />);
    fireEvent.press(await screen.findByTestId("list-more"));
    await screen.findByText("通知21");
    short = true;
    await act(async () => bump());
    await waitFor(() => expect(screen.queryByText("通知21")).toBeNull());
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

describe("tabs by permission (decisions 30 / 31)", () => {
  const VIEWER = { ...OFFICER, role: "VIEWER", permissions: ["soul.read", "reincarnation.read", "ledger.read"] };

  it("a 访客 / 牛头马面 gets 册 and 我 (我的 · 通知) only, and starts on 查询", async () => {
    renderOfficer(<Shell />, { user: VIEWER });
    expect(await screen.findByTestId("tab-search-screen")).toBeTruthy();
    expect(screen.getByTestId("door-roll")).toBeTruthy();
    expect(screen.queryByTestId("door-desk")).toBeNull(); // not greyed: not drawn (第三十批 九.3)
    fireEvent.press(screen.getByTestId("door-me"));
    for (const tab of ["notices", "me"]) expect(await screen.findByTestId(`tab-${tab}`)).toBeTruthy();
    expect(screen.queryByTestId("tab-todo")).toBeNull();
    expect(screen.queryByTestId("tab-queue")).toBeNull();
    // Nothing behind the hidden tabs was asked for.
    expect(mockTodo).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("a role with judgment.read but none of the to-do codes gets 审 with 案卷台 only, no 待办 page and no 册", async () => {
    renderOfficer(<Shell />, { user: { ...OFFICER, role: "AUDITOR", permissions: ["judgment.read"] } });
    expect(await screen.findByTestId("tab-queue-screen")).toBeTruthy();
    expect(screen.getByTestId("door-desk").props.accessibilityState.selected).toBe(true);
    // One page behind 审: no switch under the top bar.
    expect(screen.queryByTestId("tab-queue")).toBeNull();
    expect(screen.queryByTestId("tab-todo")).toBeNull();
    expect(screen.queryByTestId("door-roll")).toBeNull();
  });

  it("visibleTabs: 待办 for any one of its groups' codes; 通知 / 我的 for everyone", () => {
    expect(visibleTabs([])).toEqual(["me", "notices"]);
    expect(visibleTabs(undefined)).toEqual(["me", "notices"]);
    for (const code of ["workflow.approve", "dispatch.approve", "soul_inbox.reply", "judgment.execute", "city_god.execute", "wangsi.execute"]) expect(visibleTabs([code])).toContain("todo");
    expect(visibleTabs(["dispatch.read", "workflow.read"])).not.toContain("todo");
    expect(visibleTabs(OFFICER.permissions)).toEqual(["queue", "todo", "search", "me", "notices"]);
  });

  it("the denied page names a role the bundles do not know by its code", async () => {
    mockTodo.mockRejectedValue(httpError(403));
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />, { user: { ...OFFICER, role: "CLERK_7" } });
    expect(await screen.findByText("本账号的角色「CLERK_7」看不到待办。需要时请找本殿管理员。")).toBeTruthy();
  });

  it("an empty 待办 promises approvals only to someone who can be given one", async () => {
    mockTodo.mockResolvedValue({ data: EMPTY });
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />, { user: { ...OFFICER, role: "CLERK_7", permissions: ["soul_inbox.reply"] } });
    expect(await screen.findByText("此刻没有待办")).toBeTruthy();
    expect(screen.getByText("有待办时会推送到这部手机。")).toBeTruthy();
    expect(screen.queryByText("新的审批、移交和申请会推送到这部手机。")).toBeNull();
  });
});

describe("the shell", () => {
  it("shows the officer's hall in the identity band and the doors 审 / 册 / 我 (no 律: no page for it here)", async () => {
    renderOfficer(<Shell />);
    // The civilization's underworld name, not the tenant's English display_name (seen on the emulator).
    expect(await screen.findByText("酆都")).toBeTruthy();
    expect(screen.queryByText("Chinese Afterlife")).toBeNull();
    // Me reads the role through the bundles, not the raw code.
    // A judge starts on 案卷台 (九.3), with 待办 the second page of 审.
    expect(screen.getByTestId("tab-queue").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("tab-todo")).toBeTruthy();
    expect(screen.getAllByTestId(/^door-(desk|roll|me)$/).map((n) => n.props.testID)).toEqual(["door-desk", "door-roll", "door-me"]);
    expect(within(screen.getByTestId("door-desk")).getByText("审")).toBeTruthy();
    fireEvent.press(screen.getByTestId("door-me"));
    expect(await screen.findByText("判官")).toBeTruthy();
    expect(screen.queryByText("JUDGE")).toBeNull();
    expect(screen.getByTestId("tab-notices")).toBeTruthy();
    expect(screen.queryByTestId("mfa-banner")).toBeNull();
  });

  // The doors are the shared definition (@soulledger/core/domain/doors, user 2026-11-13 Q8), not a table of this app's own.
  it("the bar draws the shared definition's doors, in its order, and each opens on that door's first page", async () => {
    renderOfficer(<Shell />);
    await screen.findByTestId("tab-queue-screen");
    const doors = officerDoors();
    expect(within(screen.getByTestId("tab-bar")).getAllByRole("tab").map((n) => n.props.testID)).toEqual(doors.map((d) => `door-${d.key}`));
    for (const door of doors) {
      fireEvent.press(screen.getByTestId(`door-${door.key}`));
      expect(await screen.findByTestId(`tab-${door.pages[0]}-screen`)).toBeTruthy();
      for (const page of door.pages) expect(doorOf(page)).toBe(door.key);
    }
    // Every page the definition names has its codes here, and none is left over.
    expect(Object.keys(TAB_CODES).sort()).toEqual(doors.flatMap((d) => d.pages).sort());
  });

  // opt-apps2 N1 + N2: the to-do list asks again on a return from the background, in place; the face sheet's
  // inactive → active is not a return.
  it("back from the background the to-do list asks again without remounting; inactive → active asks nothing", async () => {
    const listeners = new Set<(s: string) => void>();
    // Swapped, not spied: the preset's addEventListener is itself a jest.fn, and restoring a spy on it leaves it
    // answering undefined for the tests after this one.
    const real = AppState.addEventListener;
    AppState.addEventListener = ((_t: string, fn: (s: string) => void) => {
      listeners.add(fn);
      return { remove: () => void listeners.delete(fn) };
    }) as unknown as typeof AppState.addEventListener;
    const turn = (s: string) => act(async () => void listeners.forEach((l) => l(s)));
    renderOfficer(<Shell />);
    fireEvent.press(await screen.findByTestId("tab-todo"));
    const before = await screen.findByTestId("tab-todo-screen");
    await waitFor(() => expect(mockTodo).toHaveBeenCalledTimes(1));
    await turn("inactive");
    await turn("active");
    expect(mockTodo).toHaveBeenCalledTimes(1);
    await turn("background");
    await turn("active");
    await waitFor(() => expect(mockTodo).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("tab-todo-screen")).toBe(before);
    screen.unmount();
    AppState.addEventListener = real;
  });

  it("keeps the banner on screen for a role that must use two-step verification and has not set it up", async () => {
    renderOfficer(<Shell />, { user: { ...OFFICER, mfa_enabled: false, mfa_required: true } });
    expect(await screen.findByTestId("mfa-banner")).toBeTruthy();
    fireEvent.press(screen.getByTestId("door-me"));
    await act(async () => {}); // let the Me tab's own loads land before the test ends
    expect(screen.getByTestId("mfa-banner")).toBeTruthy();
  });

  it("marks 我 with the unread dot from the server's unread count, without 通知 ever being opened (九.5)", async () => {
    mockNotices.mockImplementation(async (params?: { is_read?: string }) =>
      params?.is_read === "false" ? { data: { count: 3, results: [] } } : { data: { results: [] } }
    );
    renderOfficer(<Shell />);
    await waitFor(() => expect(screen.getByTestId("door-me-unread")).toBeTruthy());
    expect(screen.getByTestId("door-me").props.accessibilityLabel).toBe("本人 · 有未读通知");
    expect(mockNotices).toHaveBeenCalledWith({ is_read: "false" });
  });

  it("a push that arrives while the app is open asks the lists and the unread count again", async () => {
    const { __state } = jest.requireMock("expo-notifications") as { __state: { receivedListeners: Set<() => void> } };
    renderOfficer(<Shell />);
    fireEvent.press(await screen.findByTestId("tab-todo"));
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

// 案卷台 (Design 第三十批 第 2 步 · 官员端): the overview line, the source chips, the groups, and the full-screen case.
describe("the 案卷台", () => {
  it("the overview: 0 overdue reads 「无超期」 unmarked; an overdue count is marked; the month is the server's share", () => {
    const t = (key: string, vars?: Record<string, string>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
    expect(overviewParts(t, 7, 0, null)).toEqual([{ text: 'officer_app.desk.overview.today{"n":"7"}' }, { text: "officer_app.desk.overview.no_overdue" }]);
    expect(overviewParts(t, 0, 0, null)).toEqual([{ text: 'officer_app.desk.overview.today{"n":"0"}' }, { text: "officer_app.desk.overview.no_overdue" }]);
    expect(overviewParts(t, 7, 1, 22)[1]).toEqual({ text: 'officer_app.desk.overview.overdue{"n":"1"}', neg: true });
    expect(overviewParts(t, 7, 1, 22)[2]).toEqual({ text: 'officer_app.desk.overview.month_done{"pct":"22"}' });
    // The server says null when the month has nothing concluded and nothing open: no share, not 「0%」 of nothing.
    expect(overviewParts(t, null, null, null)).toEqual([]);
  });

  it("draws the overview from the counts and the hall's month_done_pct (the web desk's figure, not one worked out here)", async () => {
    mockCounts.mockResolvedValue({ data: { mine: 2, unclaimed: 4, others: 9, deferred: 1, overdue: 0 } });
    mockHallStats.mockResolvedValueOnce({ data: { month_done_pct: 37 } });
    renderOfficer(<QueueTab onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("desk-overview")).toHaveTextContent("今日 7 件 · 无超期 · 本月已结 37%"));
  });

  it("the four groups in order, 他人手上 last and read-only", async () => {
    const row = (id: string) => ({ id, case_number: `CN-${id}`, soul_name: id, court: "一殿", is_final: true });
    mockList.mockImplementation(async (p: { group: string }) => ({ data: { results: p.group === "others" ? [row("o")] : [row(p.group)] } }));
    renderOfficer(<QueueTab onOpen={() => {}} />);
    await screen.findByTestId("queue-row-o");
    const drawn = screen.root.findAll((n) => typeof n.props.testID === "string" && /^desk-group-/.test(n.props.testID)).map((n) => n.props.testID);
    expect([...new Set(drawn)]).toEqual(["desk-group-mine", "desk-group-deferred", "desk-group-unclaimed", "desk-group-others"]);
    expect(within(screen.getByTestId("desk-group-mine")).getByText("我认领")).toBeTruthy();
    expect(within(screen.getByTestId("desk-group-others")).getByText("他人手上")).toBeTruthy();
    expect(within(screen.getByTestId("queue-row-o")).getByText("◌ 他人认领")).toBeTruthy();
    expect(screen.queryByTestId("queue-claim-o")).toBeNull();
    expect(screen.queryByTestId("queue-release-o")).toBeNull();
  });

  const SOURCED = {
    mine: 1, unclaimed: 3, others: 0, deferred: 0, total: 4,
    sources: { queue: 1, city_god: 3, cross: 0 },
    elsewhere: { appeal: 5, city_god_review: 2, cross_judgment: null, capture_due: 0 },
  };

  it("source chips come from the counts: 0 / null hidden, no chip for a list the app has no screen for", async () => {
    mockCounts.mockResolvedValue({ data: SOURCED });
    mockList.mockImplementation(async (p: { group: string }) => ({
      data: { results: p.group === "unclaimed" ? [{ id: "c1", case_number: "CN-1", soul_name: "哪吒", court: "一殿", source: "city_god" }] : [] },
    }));
    renderOfficer(<QueueTab onOpen={() => {}} onOpenCityGod={() => {}} />);
    await screen.findByTestId("desk-sources-city_god_review");
    expect(screen.getByTestId("desk-sources-all")).toHaveTextContent(/全部\s*4/);
    expect(screen.getByTestId("desk-sources-queue")).toHaveTextContent(/审判队列\s*1/);
    expect(screen.getByTestId("desk-sources-city_god")).toHaveTextContent(/城隍送来\s*3/);
    expect(screen.getByTestId("desk-sources-city_god_review")).toHaveTextContent(/城隍初审中\s*2/);
    expect(screen.queryByTestId("desk-sources-cross")).toBeNull(); // 0
    expect(screen.queryByTestId("desk-sources-cross_judgment")).toBeNull(); // null
    expect(screen.queryByTestId("desk-sources-capture_due")).toBeNull(); // 0, and no screen
    expect(screen.queryByTestId("desk-sources-appeal")).toBeNull(); // 5, but no screen in this app
    // The row's second line names its own source.
    expect(within(screen.getByTestId("queue-row-c1")).getByText(/^城隍初审 · /)).toBeTruthy();
  });

  it("城隍送来 filters the four lists with ?source= (the counts stay the whole desk); again goes back to 全部", async () => {
    mockCounts.mockResolvedValue({ data: SOURCED });
    renderOfficer(<QueueTab onOpen={() => {}} />);
    fireEvent.press(await screen.findByTestId("desk-sources-city_god"));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ group: "unclaimed", source: "city_god" }));
    expect(mockList).toHaveBeenCalledWith({ group: "others", source: "city_god" });
    expect(mockCounts).not.toHaveBeenCalledWith({ source: "city_god" });
    expect(screen.getByTestId("desk-sources-city_god").props.accessibilityState).toMatchObject({ selected: true });
    mockList.mockClear();
    fireEvent.press(screen.getByTestId("desk-sources-city_god"));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ group: "mine" }));
    expect(screen.getByTestId("desk-sources-all").props.accessibilityState).toMatchObject({ selected: true });
  });

  it("城隍初审中 opens its list instead of filtering; without a way there it is not drawn", async () => {
    mockCounts.mockResolvedValue({ data: SOURCED });
    const onOpenCityGod = jest.fn();
    const { unmount } = renderOfficer(<QueueTab onOpen={() => {}} onOpenCityGod={onOpenCityGod} />);
    fireEvent.press(await screen.findByTestId("desk-sources-city_god_review"));
    expect(onOpenCityGod).toHaveBeenCalledTimes(1);
    expect(mockList).not.toHaveBeenCalledWith(expect.objectContaining({ source: expect.anything() }));
    unmount();
    renderOfficer(<QueueTab onOpen={() => {}} />);
    await screen.findByTestId("desk-sources-city_god");
    expect(screen.queryByTestId("desk-sources-city_god_review")).toBeNull();
  });

  it("转生申请 (the seventh source) opens 待办 on 转生申请; 0, missing, or no way there: no chip", async () => {
    mockCounts.mockResolvedValue({ data: { ...SOURCED, elsewhere: { ...SOURCED.elsewhere, rebirth_application: 4 } } });
    const onOpenRebirth = jest.fn();
    const { unmount } = renderOfficer(<QueueTab onOpen={() => {}} onOpenRebirth={onOpenRebirth} />);
    const chip = await screen.findByTestId("desk-sources-rebirth_application");
    expect(chip).toHaveTextContent(/转生申请/);
    fireEvent.press(chip);
    expect(onOpenRebirth).toHaveBeenCalledTimes(1);
    unmount();
    renderOfficer(<QueueTab onOpen={() => {}} />);
    await screen.findByTestId("desk-sources-city_god");
    expect(screen.queryByTestId("desk-sources-rebirth_application")).toBeNull();
    screen.unmount();
    mockCounts.mockResolvedValue({ data: SOURCED }); // a server without the field
    renderOfficer(<QueueTab onOpen={() => {}} onOpenRebirth={onOpenRebirth} />);
    await screen.findByTestId("desk-sources-city_god");
    expect(screen.queryByTestId("desk-sources-rebirth_application")).toBeNull();
  });

  it("in the shell, 转生申请 lands on 待办 filtered to 转生申请 for that visit", async () => {
    mockCounts.mockResolvedValue({ data: { ...SOURCED, elsewhere: { ...SOURCED.elsewhere, rebirth_application: 4 } } });
    renderOfficer(<Shell />);
    fireEvent.press(await screen.findByTestId("desk-sources-rebirth_application"));
    expect(await screen.findByTestId("tab-todo-screen")).toBeTruthy();
    expect(screen.getByTestId("tab-todo").props.accessibilityState.selected).toBe(true);
    await act(async () => {});
  });

  it("opening a case reports where it sits among the rows shown", async () => {
    const row = (id: string) => ({ id, case_number: `CN-${id}`, soul_name: id, court: "一殿", is_final: true });
    mockList.mockImplementation(async (p: { group: string }) => ({ data: { results: p.group === "mine" ? [row("a"), row("b")] : p.group === "unclaimed" ? [row("c")] : [] } }));
    const onOpen = jest.fn();
    renderOfficer(<QueueTab onOpen={onOpen} />);
    fireEvent.press(await screen.findByTestId("queue-row-c"));
    expect(onOpen).toHaveBeenCalledWith("c", { n: 3, total: 3 });
  });

  it("in the shell: the case is full-screen under 「‹ 案卷台」 and 「第 1 / 1 件」; back lands on the desk", async () => {
    mockList.mockImplementation(async (p: { group: string }) => ({
      data: { results: p.group === "unclaimed" ? [{ id: "j9", case_number: "CN-9", soul_name: "王九", court: "一殿", is_final: true }] : [] },
    }));
    renderOfficer(<Shell />);
    fireEvent.press(await screen.findByTestId("tab-queue"));
    expect(await screen.findByTestId("tab-queue-screen")).toBeTruthy();
    fireEvent.press(await screen.findByTestId("queue-row-j9"));
    expect(screen.getByTestId("detail-back").props.accessibilityLabel).toBe("案卷台");
    expect(screen.getByTestId("detail-position")).toHaveTextContent("第 1 / 1 件");
    expect(screen.queryByTestId("tab-queue-screen")).toBeNull();
    fireEvent.press(screen.getByTestId("detail-back"));
    expect(await screen.findByTestId("queue-row-j9")).toBeTruthy();
  });

  it("no search box on the desk; the magnifier in the top bar opens 查询", async () => {
    renderOfficer(<Shell />);
    fireEvent.press(await screen.findByTestId("tab-queue"));
    await screen.findByTestId("tab-queue-screen");
    expect(screen.queryByTestId("soul-search")).toBeNull();
    fireEvent.press(screen.getByTestId("desk-search"));
    expect(await screen.findByTestId("soul-search")).toBeTruthy();
    await act(async () => {});
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

// 真机 10-29c(o14–o19):飞行模式进审判页，列表读缓存不报错、所以没有「重试」;四个计数取失败就一直空着，
// 联网后也不自己回来，只有下拉才找回。现在：取不到的计数写「—」,恢复联网时列表和计数自己重取。
describe("the judgments tab across a dropped network", () => {
  const net = { set: (_n: Online) => {} };
  function Net({ children }: { children: ReactNode }) {
    const [value, set] = useState<Online>({ offline: true, back: 0 });
    useEffect(() => {
      net.set = set;
    }, []);
    return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>;
  }
  beforeEach(() => clearReadCache());

  it("offline from the cache: no error, no overview; back online: the lists and the counts are asked again by themselves", async () => {
    cacheWrite("list:queue:mine", { results: [{ id: "j-old", case_number: "CN-0", soul_name: "旧", court: "一殿", is_final: true }] });
    cacheWrite("list:queue:deferred", { results: [] });
    cacheWrite("list:queue:unclaimed", { results: [] });
    cacheWrite("list:queue:others", { results: [] });
    mockCounts.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue({ data: { mine: 3, unclaimed: 0, others: 0, deferred: 0 } });
    mockList.mockImplementation(async (p: { group: string }) => ({
      data: { results: p.group === "mine" ? [{ id: "j-new", case_number: "CN-1", soul_name: "新", court: "一殿", is_final: true }] : [] },
    }));
    renderOfficer(
      <Net>
        <QueueTab onOpen={() => {}} />
      </Net>
    );
    expect(await screen.findByTestId("queue-row-j-old")).toBeTruthy();
    expect(screen.queryByTestId("desk-overview")).toBeNull();
    expect(screen.queryByTestId("refresh-failed")).toBeNull();
    expect(mockList).not.toHaveBeenCalled();
    expect(mockCounts).toHaveBeenCalledTimes(1);

    await act(async () => net.set({ offline: false, back: 1 }));
    expect(await screen.findByTestId("queue-row-j-new")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("desk-overview")).toHaveTextContent(/今日 3 件/));
    expect(screen.queryByTestId("queue-row-j-old")).toBeNull();
    expect(mockCounts).toHaveBeenCalledTimes(2);
  });
});

// 第三十八批 四: in en / egy each door is the shared 24px line icon over its name; `.glyph` is drawn only in zh.
describe("the door bar's marks follow the interface language", () => {
  function InLocale({ locale, children }: { locale: "en" | "egy"; children: ReactNode }) {
    const { locale: now, setLocale } = useI18n();
    useEffect(() => {
      setLocale(locale);
      return () => setLocale("zh-Hans");
    }, [locale, setLocale]);
    return now === locale ? children : null;
  }

  it.each([
    ["en", ["Cases", "Roll", "Me"]],
    ["egy", ["Sepu", "Sesh Ba", "Djes"]],
  ] as const)("%s: an icon and the door's name in every cell, no glyph; the current door has its short line", async (locale, names) => {
    renderOfficer(
      <InLocale locale={locale}>
        <TabBar current="search" onSelect={() => {}} unread />
      </InLocale>
    );
    const bar = await screen.findByTestId("tab-bar");
    for (const [i, door] of (["desk", "roll", "me"] as const).entries()) {
      expect(within(bar).getByTestId(`door-${door}-icon`)).toBeTruthy();
      expect(within(screen.getByTestId(`door-${door}`)).getByText(names[i])).toBeTruthy();
    }
    for (const glyph of ["C", "R", "M", "Wedja", "Sesh", "审", "册", "我"]) expect(within(bar).queryByText(glyph)).toBeNull();
    expect(screen.getByTestId("door-roll-current")).toBeTruthy();
    expect(screen.queryByTestId("door-desk-current")).toBeNull();
    expect(screen.getByTestId("door-me-unread")).toBeTruthy();
  });

  it("zh: the glyph over the name, no icon", () => {
    renderOfficer(<TabBar current="queue" onSelect={() => {}} />);
    expect(within(screen.getByTestId("door-desk")).getByText("审")).toBeTruthy();
    expect(screen.queryByTestId("door-desk-icon")).toBeNull();
    expect(screen.getByTestId("door-desk-current")).toBeTruthy();
  });

  // TAS-AL00 2026-11-14: a percentage `left` put the line ~50 dp right of its glyph on Android. It is centred by
  // its parent's alignItems instead, so it carries no horizontal offset of its own.
  it("the current-door line is centred by its parent, not by a percentage offset", () => {
    renderOfficer(<TabBar current="queue" onSelect={() => {}} />);
    const line = StyleSheet.flatten(screen.getByTestId("door-desk-current").props.style);
    expect(line.left).toBeUndefined();
    expect(line.marginLeft).toBeUndefined();
    expect(line.position).toBe("absolute");
  });

  it("第四十八批 A1: the current-door line is ink, not the hall's colour", () => {
    renderOfficer(<TabBar current="queue" onSelect={() => {}} />);
    const t = themeFor("CHINESE_UNDERWORLD", "light");
    const line = StyleSheet.flatten(screen.getByTestId("door-desk-current").props.style);
    expect(line.backgroundColor).toBe(t.ink);
    expect(line.backgroundColor).not.toBe(t.plaque);
  });
});
