/** 审判详情的操作区(第三十四批 O-09):六种状态各一个主按钮,理由必填,放回要确认。 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { judgmentActionState, judgmentMoreItems, reasonBlank } from "../rules";
import { JudgmentActionBar } from "../screens/judgmentActions";
import { summaryFolds } from "../screens/judgmentCase";
import { OFFICER, renderOfficer } from "./harness";

const mockClaim = jest.fn();
const mockRelease = jest.fn();
const mockDefer = jest.fn();
const mockUndefer = jest.fn();
const mockAsk = jest.fn();
const mockReassign = jest.fn();
const mockOfficers = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    claim: (...a: unknown[]) => mockClaim(...a),
    release: (...a: unknown[]) => mockRelease(...a),
    defer: (...a: unknown[]) => mockDefer(...a),
    undefer: (...a: unknown[]) => mockUndefer(...a),
    requestReassign: (...a: unknown[]) => mockAsk(...a),
    reassign: (...a: unknown[]) => mockReassign(...a),
    assignableOfficers: (...a: unknown[]) => mockOfficers(...a),
  },
}));

const BASE = { id: "j-1", case_number: "C-2291", soul_name: "周阿满", is_final: true, claimed_by_name: "钟判官" } as never;
const ME = 7;

describe("judgmentActionState", () => {
  it.each([
    [{}, "unclaimed"],
    [{ claimed_by: 9 }, "other"],
    [{ claimed_by: ME, is_final: true }, "mine"],
    [{ claimed_by: ME, is_final: false }, "desk"],
    [{ claimed_by: ME, is_final: true, deferred_at: "2026-10-16T00:00:00Z" }, "deferred"],
    [{ claimed_by: ME, is_final: true, concluded_at: "2026-10-16T00:00:00Z" }, "closed"],
  ])("%j -> %s", (j, want) => {
    expect(judgmentActionState(j, ME, false)).toBe(want);
  });

  it("a request made this session is its own state, and a deferral wins over it", () => {
    expect(judgmentActionState({ claimed_by: ME, is_final: true }, ME, true)).toBe("reassign");
    expect(judgmentActionState({ claimed_by: ME, is_final: true, deferred_at: "x" }, ME, true)).toBe("deferred");
  });

  it("a request the server remembers shows as reassign after a reopen, with no local flag", () => {
    const j = { claimed_by: ME, is_final: true, reassign_requested_at: "2026-10-16T00:00:00Z" };
    expect(judgmentActionState(j, ME, false)).toBe("reassign");
    expect(judgmentActionState({ ...j, deferred_at: "x" }, ME, false)).toBe("deferred");
    expect(judgmentActionState({ ...j, reassign_requested_at: null }, ME, false)).toBe("mine");
  });

  it("puts 放回 last, and offers nothing in the read-only states", () => {
    expect(judgmentMoreItems("mine")).toEqual(["defer", "request_reassign", "release"]);
    expect(judgmentMoreItems("deferred")).toEqual(["release"]);
    expect(judgmentMoreItems("unclaimed")).toEqual([]);
    expect(judgmentMoreItems("other")).toEqual([]);
  });

  it("treats whitespace as no reason; folds long summaries", () => {
    expect(reasonBlank("  \n ")).toBe(true);
    expect(reasonBlank("等册页")).toBe(false);
    expect(summaryFolds("短")).toBe(false);
    expect(summaryFolds("长".repeat(200))).toBe(true);
  });
});

function bar(over: object, handlers: Partial<{ onChanged: () => void; onAsked: () => void }> = {}, user = OFFICER) {
  renderOfficer(
    <JudgmentActionBar
      data={{ ...(BASE as object), ...over } as never}
      me={ME}
      reassignAsked={false}
      onAsked={handlers.onAsked ?? (() => {})}
      onChanged={handlers.onChanged ?? (() => {})}
      onWrite={() => {}}
      onDesk={() => {}}
    />,
    { user }
  );
}

beforeEach(() => jest.clearAllMocks());

describe("JudgmentActionBar", () => {
  it("unclaimed: 认领 is the only button, and it claims", async () => {
    mockClaim.mockResolvedValue({});
    const changed = jest.fn();
    bar({}, { onChanged: changed });
    expect(screen.queryByTestId("judgment-more")).toBeNull();
    fireEvent.press(screen.getByTestId("judgment-claim"));
    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith("j-1"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it("unclaimed but held in 枉死城: no 认领, a line saying when it can be claimed (第五十一批)", () => {
    bar({ untimely: true, held_until: "2999-11-03" });
    expect(screen.queryByTestId("judgment-claim")).toBeNull();
    expect(screen.getByTestId("judgment-claim-held")).toHaveTextContent("候至 2999年 · 11月3日 · 到期后可认领");
    expect(screen.getByTestId("judgment-claim-held")).not.toHaveTextContent("2999-11-03"); // 日期写成字,不是 ISO 原值
    screen.unmount();
    bar({ untimely: true, held_until: "2000-01-01" });
    expect(screen.getByTestId("judgment-claim")).toBeTruthy();
  });

  it("unclaimed but the soul cannot reach the hall (埃及,review P2-9): no 认领, the stage instead", () => {
    bar({ duat_stage: "IMPROPER_BURIAL", held_until: null });
    expect(screen.queryByTestId("judgment-claim")).toBeNull();
    expect(screen.getByTestId("judgment-claim-held")).toHaveTextContent("葬仪不当 · 旅程未竟 · 到不了殿，不能认领");
  });

  it("without judgment.execute: no 认领 / 恢复 / ⋯ (they would 403); 写评议 or 在电脑上继续 stands in", () => {
    const reader = { ...OFFICER, permissions: ["judgment.read"] };
    bar({}, {}, reader);
    expect(screen.queryByTestId("judgment-claim")).toBeNull();
    expect(screen.getByTestId("judgment-write")).toBeTruthy();
    screen.unmount();
    bar({ claimed_by: ME }, {}, reader);
    expect(screen.queryByTestId("judgment-more")).toBeNull();
    screen.unmount();
    bar({ claimed_by: ME, deferred_at: "2026-10-16T00:00:00Z" }, {}, reader);
    expect(screen.queryByTestId("judgment-undefer")).toBeNull();
    expect(screen.getByTestId("judgment-desk")).toBeTruthy();
  });

  it("someone else's: a read-only line and no button", () => {
    bar({ claimed_by: 9 });
    expect(screen.getByTestId("judgment-with-other")).toBeTruthy();
    expect(screen.queryByTestId("judgment-claim")).toBeNull();
    expect(screen.queryByTestId("judgment-write")).toBeNull();
  });

  it("deferred by me: 恢复 undefers", async () => {
    mockUndefer.mockResolvedValue({});
    bar({ claimed_by: ME, deferred_at: "2026-10-16T00:00:00Z", defer_reason: "等册页" });
    expect(screen.getByTestId("judgment-deferred-banner")).toBeTruthy();
    fireEvent.press(screen.getByTestId("judgment-undefer"));
    await waitFor(() => expect(mockUndefer).toHaveBeenCalledWith("j-1"));
  });

  it("deferring with no reason flags the field and sends nothing; with one it sends it trimmed", async () => {
    mockDefer.mockResolvedValue({});
    const changed = jest.fn();
    bar({ claimed_by: ME }, { onChanged: changed });
    fireEvent.press(screen.getByTestId("judgment-more"));
    fireEvent.press(screen.getByTestId("judgment-menu-defer"));
    fireEvent.press(screen.getAllByTestId("judgment-sheet-confirm")[0]);
    expect(mockDefer).not.toHaveBeenCalled();
    expect(await screen.findByText("必须写理由")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("judgment-reason"), "  等册页  ");
    fireEvent.press(screen.getAllByTestId("judgment-sheet-confirm")[0]);
    await waitFor(() => expect(mockDefer).toHaveBeenCalledWith("j-1", "等册页"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("judgment-more")).toBeTruthy()); // settled: busy is off again
  });

  it("release asks first and sends no reason", async () => {
    mockRelease.mockResolvedValue({});
    const changed = jest.fn();
    bar({ claimed_by: ME }, { onChanged: changed });
    fireEvent.press(screen.getByTestId("judgment-more"));
    fireEvent.press(screen.getByTestId("judgment-menu-release"));
    expect(mockRelease).not.toHaveBeenCalled();
    fireEvent.press(screen.getAllByTestId("judgment-sheet-confirm")[0]);
    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith("j-1"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("judgment-more")).toBeTruthy());
  });

  it("a 429 on the reassign request is treated as already asked", async () => {
    mockAsk.mockRejectedValue(Object.assign(new Error("429"), { response: { status: 429 } }));
    const asked = jest.fn();
    bar({ claimed_by: ME }, { onAsked: asked });
    fireEvent.press(screen.getByTestId("judgment-more"));
    fireEvent.press(screen.getByTestId("judgment-menu-request_reassign"));
    fireEvent.changeText(screen.getByTestId("judgment-reason"), "本殿无人能接");
    fireEvent.press(screen.getAllByTestId("judgment-sheet-confirm")[0]);
    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(mockAsk).toHaveBeenCalledWith("j-1", "本殿无人能接");
  });
});

// ── Design 第四十批 O-a:别人手上的案子,本殿管理员的 ⋯ ─────────────────────

describe("an admin on a case someone else holds", () => {
  const ADMIN = { ...OFFICER, role: "ADMIN", permissions: ["judgment.execute", "judgment.assign"] };
  const OFFICERS = [
    { id: 9, display_name: "钟判官", username: "zhong", role: "JUDGE", in_hand: 1 },
    { id: 3, display_name: "韩判官", username: "han", role: "JUDGE", in_hand: 7 },
    { id: 4, display_name: "陆判官", username: "lu", role: "JUDGE", in_hand: 2 },
  ];

  it("says whose it is and offers 改派给… · 替他放回 · 暂缓; no 改派给… button without a request", () => {
    bar({ claimed_by: 9 }, {}, ADMIN);
    expect(screen.getByTestId("judgment-admin-context").props.children).toBe("○ 在钟判官手上 · 你是本殿管理员");
    expect(screen.queryByTestId("judgment-with-other")).toBeNull();
    expect(screen.queryByTestId("judgment-reassign-to")).toBeNull();
    fireEvent.press(screen.getByTestId("judgment-more"));
    expect(screen.getByTestId("judgment-menu-reassign_to")).toBeTruthy();
    expect(screen.getByTestId("judgment-menu-release_for")).toBeTruthy();
    expect(screen.getByTestId("judgment-menu-defer")).toBeTruthy();
    expect(screen.queryByTestId("judgment-menu-undefer")).toBeNull();
  });

  it("a request to reassign makes 改派给… the main button", () => {
    bar({ claimed_by: 9, reassign_requested_at: "2026-10-17T01:40:00Z", reassign_reason: "轮值" }, {}, ADMIN);
    expect(screen.getByTestId("judgment-reassign-to")).toBeTruthy();
  });

  it("a deferred one offers 取消暂缓 instead, and it needs a reason that reaches the holder", async () => {
    mockUndefer.mockResolvedValue({});
    bar({ claimed_by: 9, deferred_at: "2026-10-16T00:00:00Z" }, {}, ADMIN);
    fireEvent.press(screen.getByTestId("judgment-more"));
    expect(screen.queryByTestId("judgment-menu-defer")).toBeNull();
    fireEvent.press(screen.getByTestId("judgment-menu-undefer"));
    expect(await screen.findByText("理由 · 必填，钟判官会收到")).toBeTruthy();
    fireEvent.press(screen.getAllByTestId("judgment-sheet-confirm")[0]);
    expect(mockUndefer).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId("judgment-reason"), " 证据到了 ");
    fireEvent.press(screen.getAllByTestId("judgment-sheet-confirm")[0]);
    await waitFor(() => expect(mockUndefer).toHaveBeenCalledWith("j-1", "证据到了"));
    await act(async () => {}); // 底页收起的那次更新
  });

  it("替他放回 sends the reason", async () => {
    mockRelease.mockResolvedValue({});
    bar({ claimed_by: 9 }, {}, ADMIN);
    fireEvent.press(screen.getByTestId("judgment-more"));
    fireEvent.press(screen.getByTestId("judgment-menu-release_for"));
    fireEvent.changeText(await screen.findByTestId("judgment-reason"), "请假");
    fireEvent.press(screen.getAllByTestId("judgment-sheet-confirm")[0]);
    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith("j-1", "请假"));
    await act(async () => {}); // 底页收起的那次更新
  });

  it("the picker: no holder, fewest cases first, a reason before it sends", async () => {
    mockOfficers.mockResolvedValue({ data: OFFICERS });
    mockReassign.mockResolvedValue({});
    const changed = jest.fn();
    bar({ claimed_by: 9, reassign_requested_at: "2026-10-17T01:40:00Z" }, { onChanged: changed }, ADMIN);
    fireEvent.press(screen.getByTestId("judgment-reassign-to"));
    await screen.findByTestId("reassign-4");
    expect(screen.queryByTestId("reassign-9")).toBeNull();
    expect(screen.getByText("手上 2 件")).toBeTruthy();
    fireEvent.press(screen.getByTestId("reassign-4"));
    fireEvent.press(screen.getByTestId("reassign-confirm"));
    expect(mockReassign).not.toHaveBeenCalled();
    expect(await screen.findByText("必须写理由")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("reassign-reason"), "下周轮值");
    fireEvent.press(screen.getByTestId("reassign-confirm"));
    await waitFor(() => expect(mockReassign).toHaveBeenCalledWith("j-1", 4, "下周轮值"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it("counts that are not there are not shown as 0", async () => {
    mockOfficers.mockResolvedValue({ data: OFFICERS.map(({ in_hand: _n, ...o }) => o) });
    bar({ claimed_by: 9, reassign_requested_at: "2026-10-17T01:40:00Z" }, {}, ADMIN);
    fireEvent.press(screen.getByTestId("judgment-reassign-to"));
    await screen.findByTestId("reassign-4");
    expect(screen.queryByText(/^手上/)).toBeNull();
  });

  it("a judge (no judgment.assign) still only reads someone else's case", () => {
    bar({ claimed_by: 9, reassign_requested_at: "2026-10-17T01:40:00Z" });
    expect(screen.getByTestId("judgment-with-other")).toBeTruthy();
    expect(screen.queryByTestId("judgment-more")).toBeNull();
    expect(screen.queryByTestId("judgment-reassign-to")).toBeNull();
  });
});
