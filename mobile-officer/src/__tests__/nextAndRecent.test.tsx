/**
 * Convenience audit 2026-11-15: 「下一件」 after a decision (D1), and 查询 that searches as you type and remembers what
 * was opened (D2).
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { platform } from "@soulledger/core/platform";

import { USER_KEY } from "../owner";
import { clearReadCache } from "../readCache";
import { RECENT_KEEP, RECENT_KEY, noteOpened, readRecent } from "../recentOpened";
import { Detail } from "../screens/detail";
import { SearchTab } from "../screens/search";
import { Shell } from "../shell";
import { renderOfficer } from "./harness";

const mockTodo = jest.fn();
const mockItem = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: {
    todo: (...a: unknown[]) => mockTodo(...a),
    item: (...a: unknown[]) => mockItem(...a),
    stats: jest.fn(async () => ({ data: { concluded_this_month: 0, concluded_total: 0, open_claims: 0, appeals_reviewed: 0, appeals_in_review: 0 } })),
    signerCandidates: jest.fn(async () => ({ data: [] })),
    registerPush: jest.fn(),
    unregisterPush: jest.fn(),
  },
}));
const mockApproveNode = jest.fn();
// `get` never settles: the workflow's segments block just stays loading.
jest.mock("@soulledger/core/api/workflow", () => ({ workflowApi: { approveNode: (...a: unknown[]) => mockApproveNode(...a), get: () => new Promise(() => {}) } }));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));
const mockList = jest.fn();
const mockGet = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    list: (...a: unknown[]) => mockList(...a),
    get: (...a: unknown[]) => mockGet(...a),
    comments: jest.fn(async () => ({ data: [] })),
    addComment: jest.fn(),
    queueCounts: jest.fn(async () => ({ data: { mine: 0, unclaimed: 0, others: 0, deferred: 0 } })),
    hallStats: jest.fn(async () => ({ data: { month_done_pct: null } })),
  },
}));
const mockSouls = jest.fn();
jest.mock("@soulledger/core/api/souls", () => ({
  ...jest.requireActual("@soulledger/core/api/souls"),
  soulsApi: { list: (...a: unknown[]) => mockSouls(...a) },
}));
jest.mock("@soulledger/core/api/notifications", () => ({
  notificationsApi: { list: jest.fn(async () => ({ data: { results: [] } })), markRead: jest.fn(async () => ({})), markAllRead: jest.fn(async () => ({})) },
}));

const settle = () => act(async () => {});
const row = (id: string) => ({ kind: "approval", id, title: `审批 ${id}`, created_at: "2026-10-09T01:00:00Z", target: { kind: "approval", id }, node_name: "终审" });
const group = (items: object[]) => ({ count: items.length, items });
const detailOf = (id: string) => ({
  kind: "approval", id, title: `审批 ${id}`, created_at: "2026-10-09T01:00:00Z", actionable: true, state: "actionable",
  handled_by: null, handled_at: null, workflow_id: id, node_id: "node-1",
});
const signInAs = (id: number) => platform().persistent.set(USER_KEY, JSON.stringify({ id, username: `u${id}` }));

beforeEach(() => {
  jest.clearAllMocks();
  mockTodo.mockResolvedValue({ data: { approvals: group([row("wf-1"), row("wf-2"), row("wf-3")]), reassignments: group([]), cooldowns: group([]), rebirths: group([]) } });
  mockItem.mockImplementation(async (_kind: string, id: string) => ({ data: detailOf(id) }));
  mockApproveNode.mockResolvedValue({});
  mockList.mockResolvedValue({ data: { results: [] } });
  mockSouls.mockResolvedValue({ data: { results: [], count: 0, next: null } });
});
afterEach(() => {
  platform().persistent.remove(USER_KEY);
  platform().persistent.remove(RECENT_KEY);
});

async function approve() {
  fireEvent.press(await screen.findByTestId("action-approve"));
  fireEvent.press(await screen.findByTestId("decision-confirm"));
  await waitFor(() => expect(mockApproveNode).toHaveBeenCalled());
}

describe("「下一件」 after a decision (D1)", () => {
  it("offers the next row of the group with its place, opens it only when pressed; the last offers only 回到待办", async () => {
    renderOfficer(<Shell />);
    fireEvent.press(await screen.findByTestId("tab-todo"));
    fireEvent.press(await screen.findByTestId("todo-row-approval-wf-2"));
    await screen.findByTestId("todo-detail");
    expect(screen.queryByTestId("next-bar")).toBeNull(); // nothing offered before deciding

    await approve();
    expect(await screen.findByTestId("detail-next")).toHaveTextContent("下一件(3/3)");
    expect(screen.getByTestId("detail-leave")).toHaveTextContent("回到待办");
    expect(screen.queryByTestId("action-bar")).toBeNull();
    expect(mockItem).not.toHaveBeenCalledWith("approval", "wf-3"); // not jumped to

    fireEvent.press(screen.getByTestId("detail-next"));
    await waitFor(() => expect(mockItem).toHaveBeenLastCalledWith("approval", "wf-3"));
    expect(await screen.findByTestId("action-approve")).toBeTruthy(); // a fresh screen, not the last one's decision
    expect(screen.queryByTestId("next-bar")).toBeNull();

    mockApproveNode.mockClear();
    await approve();
    expect(await screen.findByTestId("detail-leave")).toHaveTextContent("回到待办");
    expect(screen.queryByTestId("detail-next")).toBeNull();
    fireEvent.press(screen.getByTestId("detail-leave"));
    expect(await screen.findByTestId("todo-row-approval-wf-1")).toBeTruthy();
  });
});

describe("查询 searches after a pause, for any word (D2)", () => {
  it("asks souls and judgments 300 ms after the last keystroke, not before", async () => {
    jest.useFakeTimers();
    try {
      renderOfficer(<SearchTab onOpenSoul={() => {}} />);
      fireEvent.changeText(screen.getByTestId("soul-search"), "王");
      act(() => jest.advanceTimersByTime(200));
      fireEvent.changeText(screen.getByTestId("soul-search"), "王守仁");
      act(() => jest.advanceTimersByTime(299));
      expect(mockSouls).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
      act(() => jest.advanceTimersByTime(1));
      expect(mockList).toHaveBeenCalledTimes(1);
      expect(mockList).toHaveBeenCalledWith({ search: "王守仁" });
      expect(mockSouls).toHaveBeenCalledWith({ search: "王守仁" });
      await settle();
    } finally {
      jest.useRealTimers();
    }
  });

  it("「搜索」 sends at once and the pause does not send it again", async () => {
    jest.useFakeTimers();
    try {
      renderOfficer(<SearchTab onOpenSoul={() => {}} />);
      fireEvent.changeText(screen.getByTestId("soul-search"), "李白");
      fireEvent(screen.getByTestId("soul-search"), "submitEditing");
      expect(mockSouls).toHaveBeenCalledTimes(1);
      act(() => jest.advanceTimersByTime(1000));
      expect(mockSouls).toHaveBeenCalledTimes(1);
      await settle();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("「最近打开」 (D2)", () => {
  it("an empty box lists the officer's last opened, newest first, and opens them; typing hides it", async () => {
    signInAs(7);
    noteOpened({ type: "judgment", id: "j-1", title: "CN-2026-0001", line: "李白" });
    noteOpened({ type: "soul", id: "s-1", title: "杜甫" });
    const onOpenSoul = jest.fn();
    const onOpenJudgment = jest.fn();
    renderOfficer(<SearchTab onOpenSoul={onOpenSoul} onOpenJudgment={onOpenJudgment} />);
    expect(screen.getByText("最近打开")).toBeTruthy();
    expect(screen.getAllByTestId(/^recent-row-/).map((r) => r.props.testID)).toEqual(["recent-row-soul-s-1", "recent-row-judgment-j-1"]);
    fireEvent.press(screen.getByTestId("recent-row-judgment-j-1"));
    expect(onOpenJudgment).toHaveBeenCalledWith("j-1");
    fireEvent.press(screen.getByTestId("recent-row-soul-s-1"));
    expect(onOpenSoul).toHaveBeenCalledWith("s-1");
    fireEvent.changeText(screen.getByTestId("soul-search"), "王");
    expect(screen.queryByTestId("search-recent")).toBeNull();
    await settle();
  });

  it("is the officer's own: another officer sees none, and sign-out's clear removes it", async () => {
    signInAs(7);
    noteOpened({ type: "soul", id: "s-1", title: "杜甫" });
    signInAs(8);
    expect(readRecent()).toEqual([]);
    renderOfficer(<SearchTab onOpenSoul={() => {}} />);
    expect(screen.queryByTestId("search-recent")).toBeNull();
    signInAs(7);
    expect(readRecent()).toHaveLength(1);
    clearReadCache();
    expect(readRecent()).toEqual([]);
    await settle();
  });

  it("keeps the newest ten, an entry opened again moves to the top", () => {
    signInAs(7);
    for (let i = 0; i < 12; i++) noteOpened({ type: "soul", id: `s-${i}`, title: `魂 ${i}` });
    noteOpened({ type: "soul", id: "s-5", title: "魂 5" });
    const ids = readRecent().map((e) => e.id);
    expect(ids).toHaveLength(RECENT_KEEP);
    expect(ids[0]).toBe("s-5");
    expect(ids.filter((id) => id === "s-5")).toHaveLength(1);
    expect(ids).not.toContain("s-0");
  });

  it("a case is recorded when its detail has loaded", async () => {
    signInAs(7);
    mockGet.mockResolvedValue({ data: { id: "j-1", case_number: "CN-2026-1", soul: "s-1", soul_name: "张三", court: "Tenth Court", claimed_by_name: "阎罗", is_final: false } });
    renderOfficer(<Detail target={{ type: "judgment", id: "j-1" }} onBack={() => {}} onSettled={() => {}} />);
    await screen.findByTestId("judgment-detail");
    expect(readRecent()[0]).toEqual({ type: "judgment", id: "j-1", title: "CN-2026-1", line: "张三" });
  });
});
