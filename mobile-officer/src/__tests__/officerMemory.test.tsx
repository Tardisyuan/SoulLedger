/**
 * Convenience audit 2026-11-15: 我's read-only 登录用户名 (O1); 案卷台's source chip kept across launches and the last
 * three reject reasons offered above the box (D8), both owner-scoped and cleared on sign-out.
 */
import { platform } from "@soulledger/core/platform";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Pressable, StyleSheet } from "react-native";

import { QUEUE_SOURCE_KEY, REJECT_REASONS_KEY, readQueueSource, recentReasons, rememberReason, writeQueueSource } from "../memory";
import { Detail } from "../screens/detail";
import { MeTab } from "../screens/me";
import { QueueTab } from "../screens/queue";
import { SessionProvider, USER_KEY, useSession } from "../session";
import { OFFICER, renderOfficer } from "./harness";

const mockItem = jest.fn();
const mockApproveNode = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: {
    item: (...a: unknown[]) => mockItem(...a),
    stats: jest.fn(async () => ({ data: {} })),
    signerCandidates: jest.fn(async () => ({ data: [] })),
    registerPush: jest.fn(),
    unregisterPush: jest.fn(),
  },
}));
jest.mock("@soulledger/core/api/workflow", () => ({ workflowApi: { approveNode: (...a: unknown[]) => mockApproveNode(...a) } }));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: { profile: jest.fn(async () => ({ data: {} })), preferences: jest.fn(async () => ({ data: {} })), logout: jest.fn(async () => ({})) },
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));
const mockList = jest.fn();
const mockCounts = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  judgmentApi: {
    list: (...a: unknown[]) => mockList(...a),
    queueCounts: (...a: unknown[]) => mockCounts(...a),
    hallStats: jest.fn(async () => ({ data: { month_done_pct: null } })),
    claim: jest.fn(),
    release: jest.fn(),
  },
}));

const as = (id: number) => platform().persistent.set(USER_KEY, JSON.stringify({ ...OFFICER, id }));
const COUNTS = { mine: 1, unclaimed: 3, others: 0, deferred: 0, total: 4, sources: { queue: 1, city_god: 3, cross: 0 }, elsewhere: {} };

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of [USER_KEY, QUEUE_SOURCE_KEY, REJECT_REASONS_KEY]) platform().persistent.remove(key);
  as(7);
  mockList.mockResolvedValue({ data: { results: [] } });
  mockCounts.mockResolvedValue({ data: COUNTS });
});
afterEach(() => platform().persistent.remove(USER_KEY));

describe("O1 / 第五十二批 F2: 我 › 账号安全 shows the sign-in username first", () => {
  it("read-only, whole, in mono, the first row of 账号安全 (not under 个人信息), selectable for a long-press copy", async () => {
    renderOfficer(<MeTab onOpen={() => {}} />);
    const row = await screen.findByTestId("me-username");
    expect(row).toHaveTextContent(/^用户名\s*yama$/);
    // Not a button: nothing to press there.
    expect(screen.root.findAll((n) => n.props.testID === "me-username" && typeof n.props.onPress === "function")).toEqual([]);
    const value = screen.getByTestId("me-username-value");
    expect(value.props.selectable).toBe(true);
    expect(StyleSheet.flatten(value.props.style)).toMatchObject({ fontSize: 14 });
    expect(String(StyleSheet.flatten(value.props.style).fontFamily)).toMatch(/Mono/i);
    expect(screen.getByTestId("me-name-value")).toHaveTextContent("阎罗");
    // Order on the page: 账号安全's heading, then the username, then 用指纹登录's block.
    const ids = screen.root.findAll((n) => typeof n.props.testID === "string" && typeof n.type === "string").map((n) => n.props.testID as string);
    expect(ids.indexOf("me-username")).toBeGreaterThan(ids.indexOf("me-name"));
    expect(ids.indexOf("me-username")).toBeLessThan(ids.indexOf("me-password"));
    expect(ids.indexOf("me-username")).toBeGreaterThan(ids.indexOf("me-mfa"));
    // No verified email: no hint.
    expect(screen.queryByTestId("me-username-hint")).toBeNull();
  });

  it("the hint that a verified email also signs in shows only with a verified email", async () => {
    const { authApi } = jest.requireMock("@soulledger/core/api/auth") as { authApi: { profile: jest.Mock } };
    authApi.profile.mockResolvedValueOnce({ data: { email: "yama@example.com", email_verified: true } });
    renderOfficer(<MeTab onOpen={() => {}} />);
    expect(await screen.findByTestId("me-username-hint")).toHaveTextContent("登录时也可以用已验证的邮箱。");
  });

  it("an unverified email gives no hint", async () => {
    const { authApi } = jest.requireMock("@soulledger/core/api/auth") as { authApi: { profile: jest.Mock } };
    authApi.profile.mockResolvedValueOnce({ data: { email: "yama@example.com", email_verified: false } });
    renderOfficer(<MeTab onOpen={() => {}} />);
    expect(await screen.findByTestId("me-email")).toBeTruthy();
    expect(screen.queryByTestId("me-username-hint")).toBeNull();
  });
});

describe("D8a: 案卷台's source chip is kept", () => {
  it("a chosen source is there again on the next launch, and the lists ask with it from the start", async () => {
    const first = renderOfficer(<QueueTab onOpen={() => {}} />);
    fireEvent.press(await screen.findByTestId("desk-sources-city_god"));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ group: "mine", source: "city_god" }));
    first.unmount();
    mockList.mockClear();

    renderOfficer(<QueueTab onOpen={() => {}} />);
    expect(mockList).toHaveBeenCalledWith({ group: "mine", source: "city_god" });
    expect(mockList).not.toHaveBeenCalledWith({ group: "mine" });
    await waitFor(() => expect(screen.getByTestId("desk-sources-city_god").props.accessibilityState).toMatchObject({ selected: true }));
  });

  it("another officer on the same phone starts at 全部", async () => {
    writeQueueSource("city_god");
    as(8);
    renderOfficer(<QueueTab onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("desk-sources-all").props.accessibilityState).toMatchObject({ selected: true }));
    expect(mockList).not.toHaveBeenCalledWith(expect.objectContaining({ source: "city_god" }));
  });

  it("a kept source with nothing in it now falls back to 全部 (its chip is not drawn, so it could not be taken off)", async () => {
    writeQueueSource("cross");
    renderOfficer(<QueueTab onOpen={() => {}} />);
    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ group: "mine" }));
    expect(screen.getByTestId("desk-sources-all").props.accessibilityState).toMatchObject({ selected: true });
  });

  it("garbage or an unknown source reads as nothing", () => {
    platform().persistent.set(QUEUE_SOURCE_KEY, "{not json");
    expect(readQueueSource(["all", "queue"])).toBeNull();
    writeQueueSource("appeal");
    expect(readQueueSource(["all", "queue"])).toBeNull();
  });
});

describe("D8b: the last three reject reasons", () => {
  it("newest first, three at most, the same words once, blank never kept", () => {
    for (const r of ["一", "二", "三", "二", "四", "  "]) rememberReason(r);
    expect(recentReasons()).toEqual(["四", "二", "三"]);
  });

  it("are another officer's: not shown", () => {
    rememberReason("材料不全");
    as(8);
    expect(recentReasons()).toEqual([]);
  });

  const ITEM = { kind: "approval", id: "wf-1", title: "转生配额审批", created_at: "2026-10-09T01:00:00Z", actionable: true, state: "actionable", handled_by: null, handled_at: null, workflow_id: "wf-1", node_id: "node-1" };
  async function openReject() {
    mockItem.mockResolvedValue({ data: ITEM });
    renderOfficer(<Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={() => {}} />);
    fireEvent.press(await screen.findByTestId("action-reject"));
    await screen.findByTestId("sheet-reject");
  }

  it("no chips before any reason was sent", async () => {
    await openReject();
    expect(screen.queryByTestId("decision-recent")).toBeNull();
  });

  it("shows them above the box; a tap fills the box; a reject the server took is remembered first", async () => {
    rememberReason("先退回");
    rememberReason("材料不全");
    mockApproveNode.mockResolvedValue({});
    await openReject();
    expect(screen.getByTestId("decision-recent")).toHaveTextContent(/^最近用过/);
    expect(screen.getByTestId("decision-recent")).not.toHaveTextContent(/点一条填入/);
    expect(screen.getByTestId("decision-recent-0")).toHaveTextContent(/↺材料不全$/);
    expect(screen.getByTestId("decision-recent-1")).toHaveTextContent(/↺先退回$/);
    expect(screen.queryByTestId("decision-recent-2")).toBeNull();
    // 第五十二批 F1: an outlined full-width row, 40 high, ↺ in --faint, one line; read as 「填入：…」.
    const row = screen.getByTestId("decision-recent-1");
    expect(row.props.accessibilityLabel).toBe("填入：先退回");
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ height: 40, borderWidth: 1, borderRadius: 8 });
    expect(screen.getByTestId("decision-recent-1-icon", { includeHiddenElements: true })).toHaveTextContent("↺");
    fireEvent.press(screen.getByTestId("decision-recent-1"));
    expect(screen.getByTestId("decision-reason").props.value).toBe("先退回");
    // A second tap adds on a new line, never over what is there; the row is still there.
    fireEvent.press(screen.getByTestId("decision-recent-0"));
    expect(screen.getByTestId("decision-reason").props.value).toBe("先退回\n材料不全");
    expect(screen.getByTestId("decision-recent-0")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("decision-reason"), "先退回");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(mockApproveNode).toHaveBeenCalledWith("wf-1", "node-1", { verdict: "REJECTED", notes: "先退回", require_reason: true }));
    await waitFor(() => expect(recentReasons()).toEqual(["先退回", "材料不全"]));
  });

  it("a reject the server refused is not remembered", async () => {
    mockApproveNode.mockRejectedValue(new Error("Network Error"));
    await openReject();
    fireEvent.changeText(screen.getByTestId("decision-reason"), "没送出去");
    await act(async () => {
      fireEvent.press(screen.getByTestId("decision-confirm"));
    });
    expect(await screen.findByText("没能提交 · 网络错误")).toBeTruthy();
    expect(recentReasons()).toEqual([]);
  });

  it("a kept reason longer than any box (2000) is not offered; the box keeps its own limit", async () => {
    platform().persistent.set(REJECT_REASONS_KEY, JSON.stringify({ owner: "id:7", reasons: ["长".repeat(2001), "短"] }));
    expect(recentReasons()).toEqual(["短"]);
    await openReject();
    expect(screen.getByTestId("decision-recent-0")).toHaveTextContent(/↺短$/);
    expect(screen.queryByTestId("decision-recent-1")).toBeNull();
    expect(screen.getByTestId("decision-reason").props.maxLength).toBe(2000);
  });
});

describe("sign-out clears both", () => {
  function SignOut() {
    const { signOut } = useSession();
    return <Pressable testID="sign-out" onPress={() => signOut()} />;
  }

  it("the kept source and the reasons go with the officer", async () => {
    platform().persistent.set(USER_KEY, JSON.stringify(OFFICER));
    writeQueueSource("city_god");
    rememberReason("材料不全");
    renderOfficer(
      <SessionProvider>
        <SignOut />
      </SessionProvider>
    );
    await act(async () => {});
    fireEvent.press(screen.getByTestId("sign-out"));
    await act(async () => {});
    expect(platform().persistent.get(QUEUE_SOURCE_KEY)).toBeNull();
    expect(platform().persistent.get(REJECT_REASONS_KEY)).toBeNull();
  });
});
