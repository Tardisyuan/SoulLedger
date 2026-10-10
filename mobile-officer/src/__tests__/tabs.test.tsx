/**
 * The four states every tab shares (loading / empty / error / denied), the to-do list's grouping,
 * the pushed row's highlight and its absence under reduce-motion, and the locked-down parts of the
 * shell (the band shows the hall; the two-step banner stays until it is set up).
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { Row } from "../kit";
import { NoticesTab } from "../screens/notices";
import { QueueTab } from "../screens/queue";
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
jest.mock("@soulledger/core/api/judgment", () => ({ judgmentApi: { list: (...a: unknown[]) => mockList(...a), claim: jest.fn() } }));
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

  it("notices: unread is ● and bold, and tapping marks it read (○)", async () => {
    mockNotices.mockResolvedValue({ data: { results: [{ id: 1, title: "新审批", message: "有一件待办", is_read: false, created_at: "2026-10-09T01:00:00Z" }] } });
    const onUnread = jest.fn();
    renderOfficer(<NoticesTab onUnread={onUnread} />);
    expect(await screen.findByText("●")).toBeTruthy();
    fireEvent.press(screen.getByTestId("notice-1"));
    expect(await screen.findByText("○")).toBeTruthy();
    await waitFor(() => expect(onUnread).toHaveBeenLastCalledWith(false));
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
    renderOfficer(<NoticesTab onUnread={() => {}} onLand={onLand} />);
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
    renderOfficer(<NoticesTab onUnread={() => {}} />);
    expect(await screen.findByTestId("state-error")).toBeTruthy();
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
});
