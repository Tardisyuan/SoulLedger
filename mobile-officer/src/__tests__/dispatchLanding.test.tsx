/**
 * The four dispatch notices (`DISPATCH_PROPOSED` / `APPROVED` / `REJECTED` / `CANCELLED`, all
 * `related_resource: "DispatchRecord"`) land on a screen chosen by the RECORD -- is this hall the receiver, and is
 * the proposal still open -- not by the notice's type. Receiver + PROPOSED = the actionable detail; anything else =
 * the same layout read-only with one status line and no action bar. Each "has" is paired with a "has not".
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { clearReadCache } from "../readCache";

import { parseOfficerLink } from "../links";
import { dispatchReasonOf, dispatchStatusLine, dispatchView, noticeLanding } from "../rules";
import { Shell } from "../shell";
import { httpError, renderOfficer } from "./harness";

const mockItem = jest.fn();
const mockGet = jest.fn();
const mockNotices = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: {
    todo: jest.fn(async () => ({ data: { approvals: { count: 0, items: [] }, reassignments: { count: 0, items: [] }, cooldowns: { count: 0, items: [] }, rebirths: { count: 0, items: [] } } })),
    item: (...a: unknown[]) => mockItem(...a),
    registerPush: jest.fn(),
    unregisterPush: jest.fn(),
  },
}));
jest.mock("@soulledger/core/api/dispatch", () => ({
  ...jest.requireActual("@soulledger/core/api/dispatch"),
  dispatchApi: { get: (...a: unknown[]) => mockGet(...a), approve: jest.fn(), reject: jest.fn() },
}));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));
jest.mock("@soulledger/core/api/judgment", () => ({ judgmentApi: { list: jest.fn(async () => ({ data: { results: [] } })), claim: jest.fn(), queueCounts: jest.fn(async () => ({ data: { mine: 0, unclaimed: 0, others: 0, deferred: 0 } })) } }));
jest.mock("@soulledger/core/api/notifications", () => ({
  notificationsApi: { list: (...a: unknown[]) => mockNotices(...a), markRead: jest.fn(async () => ({})), markAllRead: jest.fn(async () => ({})) },
}));

// The officer in the harness belongs to CN_DIYU.
const ME = "CN_DIYU";
const OTHER = "EG_DUAT";
const record = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  status: "PROPOSED",
  source_tenant_code: ME,
  target_tenant_code: OTHER,
  soul_name: "李白",
  reason: "移交理由",
  decision_reason: "",
  proposed_at: "2026-10-09T01:00:00Z",
  ...over,
});
const notice = (type: string) => ({
  id: 1, title: "t", message: "", is_read: false, notification_type: type, related_resource: "DispatchRecord", related_id: "d1", created_at: "2026-10-09T01:00:00Z",
});

async function openNotice(type: string) {
  mockNotices.mockResolvedValue({ data: { results: [notice(type)] } });
  renderOfficer(<Shell />);
  fireEvent.press(await screen.findByTestId("tab-notices"));
  fireEvent.press(await screen.findByTestId("notice-1"));
  // 点开会标已读,壳层随即重问未读数;等它落定,不让那次 setState 落在测试之后。
  await act(async () => {});
}

const noActions = () => {
  for (const id of ["action-bar", "action-approve", "action-reject", "action-cosign", "cancel-dispatch"]) expect(screen.queryByTestId(id)).toBeNull();
};

beforeEach(() => {
  jest.clearAllMocks();
  // 详情走读缓存(离线时显示上次的);上一条测试缓存的记录会让「没有回应」显示旧数据而不是出错。
  clearReadCache();
  mockItem.mockResolvedValue({
    data: { kind: "reassignment", id: "d1", title: "李白", created_at: "2026-10-09T01:00:00Z", actionable: true, state: "actionable", handled_by: null, handled_at: null },
  });
});

describe("noticeLanding / links", () => {
  it("a DispatchRecord notice names the record; the link parser takes item/dispatch/<id>", () => {
    expect(noticeLanding({ related_resource: "DispatchRecord", related_id: "d1" })).toEqual({ tab: "todo", item: { kind: "dispatch", id: "d1" } });
    expect(noticeLanding({ related_resource: "DispatchRecord", related_id: null })).toBeNull();
    expect(noticeLanding({ related_resource: "CrossTenantJudgment", related_id: "j1" })).toBeNull();
    expect(parseOfficerLink("soulledger-officer://item/dispatch/d1")).toEqual({ tab: "todo", item: { kind: "dispatch", id: "d1" } });
    expect(parseOfficerLink("soulledger-officer://item/dispatches/d1")).toBeNull();
  });
});

describe("dispatchView: the record decides", () => {
  it.each([
    ["receiver, open", { status: "PROPOSED", source_tenant_code: OTHER, target_tenant_code: ME }, { mode: "act" }],
    ["receiver, cancelled", { status: "CANCELLED", source_tenant_code: OTHER, target_tenant_code: ME }, { mode: "read", side: "other" }],
    ["receiver, already approved", { status: "APPROVED", source_tenant_code: OTHER, target_tenant_code: ME }, { mode: "read", side: "other" }],
    ["sender, open", { status: "PROPOSED", source_tenant_code: ME, target_tenant_code: OTHER }, { mode: "read", side: "sender" }],
    ["sender, approved", { status: "APPROVED", source_tenant_code: ME, target_tenant_code: OTHER }, { mode: "read", side: "sender" }],
  ])("%s", (_name, rec, expected) => expect(dispatchView(rec as never, ME)).toEqual(expected));

  it("a hall on neither side never gets the actionable screen", () => {
    expect(dispatchView({ status: "PROPOSED", source_tenant_code: "A", target_tenant_code: "B" }, ME)).toEqual({ mode: "read", side: "other" });
    expect(dispatchView({ status: "PROPOSED", source_tenant_code: ME, target_tenant_code: ME }, undefined)).toEqual({ mode: "read", side: "other" });
  });
});

describe("the reason and the status line", () => {
  it("reads the server's decision_reason field -- never the proposal's own `reason` text; blank / none -> null", () => {
    expect(dispatchReasonOf({ status: "REJECTED", decision_reason: "不收" })).toBe("不收");
    expect(dispatchReasonOf({ status: "CANCELLED", decision_reason: " 改派 " })).toBe("改派");
    expect(dispatchReasonOf({ status: "REJECTED", decision_reason: "" })).toBeNull();
    expect(dispatchReasonOf({ status: "REJECTED", decision_reason: "  " })).toBeNull();
    // Words that look like the old appended marker are just words: the reason is the field, not a slice of `reason`.
    expect(dispatchReasonOf({ status: "REJECTED", decision_reason: "", reason: "x\n\nRejection reason: a" } as never)).toBeNull();
    // Only a rejected / cancelled record has a decision reason to show.
    expect(dispatchReasonOf({ status: "APPROVED", decision_reason: "a" })).toBeNull();
  });

  it.each([
    ["PROPOSED", "◐", "officer_app.dispatch_status.waiting"],
    ["APPROVED", "✓", "officer_app.dispatch_status.approved"],
    ["REJECTED", "✕", "officer_app.dispatch_status.rejected"],
    ["CANCELLED", "○", "dispatch.states.CANCELLED"],
  ])("the sender sees %s as %s", (status, glyph, key) => {
    expect(dispatchStatusLine({ status, decision_reason: "" } as never, "sender")).toMatchObject({ glyph, key });
  });

  it("someone who is not the sender is not told 'the other hall' decided", () => {
    // 批准不是完成:接收方殿还要在电脑上执行(Design 第四十批 O-f);那句话自带 ◐。
    expect(dispatchStatusLine({ status: "APPROVED", decision_reason: "" } as never, "other")).toMatchObject({ glyph: "", key: "officer_app.dispatch.awaiting_receiver" });
    expect(dispatchStatusLine({ status: "EXECUTED", decision_reason: "" } as never, "sender")).toMatchObject({ glyph: "→", key: "dispatch.states.EXECUTED" });
  });
});

describe("each notice lands on the right screen (through the notices tab)", () => {
  it("DISPATCH_PROPOSED, I am the receiver: the actionable detail, with 批准 / 驳回", async () => {
    mockGet.mockResolvedValue({ data: record({ source_tenant_code: OTHER, target_tenant_code: ME }) });
    await openNotice("DISPATCH_PROPOSED");
    expect(await screen.findByTestId("action-approve")).toBeTruthy();
    expect(screen.getByTestId("action-reject")).toBeTruthy();
    expect(mockItem).toHaveBeenCalledWith("reassignment", "d1");
    expect(screen.queryByTestId("dispatch-readonly")).toBeNull();
  });

  it("DISPATCH_APPROVED, I am the sender: read-only, '✓ 对方已批准', nothing to press", async () => {
    mockGet.mockResolvedValue({ data: record({ status: "APPROVED" }) });
    await openNotice("DISPATCH_APPROVED");
    expect((await screen.findByTestId("dispatch-status")).props.children).toBe("✓ 对方已批准");
    expect(screen.getByTestId("dispatch-readonly")).toBeTruthy();
    expect(screen.queryByTestId("dispatch-status-reason")).toBeNull();
    noActions();
    expect(mockItem).not.toHaveBeenCalled();
  });

  it("DISPATCH_REJECTED, I am the sender: '✕ 对方已驳回' and the reason on the next line", async () => {
    mockGet.mockResolvedValue({ data: record({ status: "REJECTED", decision_reason: "不收" }) });
    await openNotice("DISPATCH_REJECTED");
    expect((await screen.findByTestId("dispatch-status")).props.children).toBe("✕ 对方已驳回");
    expect(screen.getByTestId("dispatch-status-reason").props.children).toBe("理由：不收");
    noActions();
  });

  it("DISPATCH_CANCELLED, I am the receiver: read-only '○ 已取消' with the reason; the proposal is gone, nothing to decide", async () => {
    mockGet.mockResolvedValue({ data: record({ status: "CANCELLED", source_tenant_code: OTHER, target_tenant_code: ME, decision_reason: "改派别处" }) });
    await openNotice("DISPATCH_CANCELLED");
    expect((await screen.findByTestId("dispatch-status")).props.children).toBe("○ 已取消");
    expect(screen.getByTestId("dispatch-status-reason").props.children).toBe("理由：改派别处");
    noActions();
    expect(mockItem).not.toHaveBeenCalled();
  });

  it("I am the sender and the other hall has not answered: '◐ 等对方批准' -- and still no 取消移交 (the app does not cancel)", async () => {
    mockGet.mockResolvedValue({ data: record() });
    await openNotice("DISPATCH_APPROVED");
    expect((await screen.findByTestId("dispatch-status")).props.children).toBe("◐ 等对方批准");
    noActions();
  });

  it("a stale DISPATCH_PROPOSED tapped after I already approved: read-only, not the action bar, waiting for us to execute", async () => {
    mockGet.mockResolvedValue({ data: record({ status: "APPROVED", source_tenant_code: OTHER, target_tenant_code: ME }) });
    await openNotice("DISPATCH_PROPOSED");
    expect((await screen.findByTestId("dispatch-status")).props.children).toBe("◐ 等接收方执行");
    noActions();
  });

  it("the screen is the same layout: kind label, soul name, time", async () => {
    mockGet.mockResolvedValue({ data: record({ status: "APPROVED" }) });
    await openNotice("DISPATCH_APPROVED");
    await screen.findByTestId("dispatch-readonly");
    expect(screen.getByText("李白")).toBeTruthy();
    expect(screen.getByTestId("continue-on-desk")).toBeTruthy();
  });
});

describe("a record I cannot read", () => {
  // Design 第四十批 O-c:404 与 403 是同一句「这条已经不在了」,不分删了还是没权限,也不给重试。
  it.each([403, 404])("%s: 「这条已经不在了」, a way back to 通知, and no status line", async (status) => {
    mockGet.mockRejectedValue(httpError(status));
    await openNotice("DISPATCH_APPROVED");
    expect(await screen.findByTestId("state-gone")).toBeTruthy();
    expect(screen.getByText("这条已经不在了")).toBeTruthy();
    expect(screen.queryByTestId("state-retry")).toBeNull();
    expect(screen.queryByTestId("state-denied")).toBeNull();
    expect(screen.queryByTestId("dispatch-status")).toBeNull();
    fireEvent.press(screen.getByTestId("state-gone-back"));
    await waitFor(() => expect(screen.queryByTestId("detail")).toBeNull());
  });

  it("no answer at all is still the error state with 重试, and retrying asks again", async () => {
    mockGet.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue({ data: record({ status: "APPROVED" }) });
    await openNotice("DISPATCH_APPROVED");
    expect(await screen.findByTestId("state-error")).toBeTruthy();
    expect(screen.queryByTestId("state-gone")).toBeNull();
    fireEvent.press(screen.getByTestId("state-retry"));
    await waitFor(() => expect(screen.getByTestId("dispatch-status")).toBeTruthy());
  });
});
