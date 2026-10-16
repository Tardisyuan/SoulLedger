/** 审判详情的操作区(第三十四批 O-09):六种状态各一个主按钮,理由必填,放回要确认。 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { judgmentActionState, judgmentMoreItems, reasonBlank } from "../rules";
import { JudgmentActionBar } from "../screens/judgmentActions";
import { summaryFolds } from "../screens/judgmentCase";
import { renderOfficer } from "./harness";

const mockClaim = jest.fn();
const mockRelease = jest.fn();
const mockDefer = jest.fn();
const mockUndefer = jest.fn();
const mockAsk = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    claim: (...a: unknown[]) => mockClaim(...a),
    release: (...a: unknown[]) => mockRelease(...a),
    defer: (...a: unknown[]) => mockDefer(...a),
    undefer: (...a: unknown[]) => mockUndefer(...a),
    requestReassign: (...a: unknown[]) => mockAsk(...a),
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

function bar(over: object, handlers: Partial<{ onChanged: () => void; onAsked: () => void }> = {}) {
  renderOfficer(
    <JudgmentActionBar
      data={{ ...(BASE as object), ...over } as never}
      me={ME}
      reassignAsked={false}
      onAsked={handlers.onAsked ?? (() => {})}
      onChanged={handlers.onChanged ?? (() => {})}
      onWrite={() => {}}
      onDesk={() => {}}
    />
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
