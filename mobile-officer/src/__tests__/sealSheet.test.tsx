/**
 * 卷宗的「判」抽屉(第三十批 八.6):与网页同样四个判决(用户 2026-11-13)、各文明的叫法、置灰同网页、
 * 按住 1 秒才落印(短按不发)、发出去的内容、服务端拒绝时照它回的那句写出。按住的手势本身要上设备看(CLAUDE.md)。
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { HOLD_TO_SEAL_MS, SealSheet } from "../screens/sealSheet";
import { verdictFailure } from "../screens/swipe";
import { NO_SEAL, passBarredBy, sealPayload, sealReady } from "../verdict";
import { renderOfficer } from "./harness";

const mockConclude = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    conclude: (...a: unknown[]) => mockConclude(...a),
    negativeConfessions: jest.fn(async () => ({ items: [] })),
  },
}));

const CASE = { id: "j-1", case_number: "DY-1", soul: "s-1", soul_name: "李青竹", civilization: "CHINESE", court: "第五殿", conclude_refusal: "", admitted_balance: {} };

function open(over: Record<string, unknown> = {}) {
  const sealed = jest.fn();
  renderOfficer(<SealSheet open judgment={{ ...CASE, ...over } as never} onClose={() => {}} onSealed={sealed} />);
  return sealed;
}

beforeEach(() => jest.clearAllMocks());

describe("the four verdicts", () => {
  it("offers all four, numbered, PURGATORY named per civilization", () => {
    open({ civilization: "EUROPEAN" });
    for (const v of ["PASSED", "FAILED", "PURGATORY", "RETRY"]) expect(screen.getByTestId(`seal-option-${v}`)).toBeTruthy();
    expect(screen.getByTestId("seal-option-PURGATORY")).toHaveTextContent(/炼狱/);
    expect(screen.getByTestId("seal-option-RETRY")).toHaveTextContent(/重审/);
    screen.unmount();
    open({ civilization: "GREEK" });
    expect(screen.getByTestId("seal-option-PURGATORY")).toHaveTextContent(/普通/);
    screen.unmount();
    open({ civilization: "CHINESE" });
    expect(screen.getByTestId("seal-option-PURGATORY")).toHaveTextContent(/存疑/);
    expect(screen.getByTestId("seal-option-PURGATORY")).not.toHaveTextContent(/炼狱/);
  });

  it("bars 通过 for 五逆 and, on a weighed 埃及 case, the side the scale ruled out -- 存疑 / 重审 stay open", () => {
    open({ offence: "FIVE_HEINOUS" });
    expect(screen.getByTestId("seal-option-PASSED").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("seal-option-FAILED").props.accessibilityState.disabled).toBe(false);
    screen.unmount();
    open({ civilization: "EGYPTIAN", admitted_balance: { weighing: { weighed_verdict: "PASSED" } } });
    expect(screen.getByTestId("seal-option-FAILED").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("seal-option-PASSED").props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId("seal-option-PURGATORY").props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId("seal-option-RETRY").props.accessibilityState.disabled).toBe(false);
  });

  it("rules: what is ready and what is sent", () => {
    expect(sealReady("CHINESE", NO_SEAL)).toBe(false);
    expect(sealReady("CHINESE", { ...NO_SEAL, verdict: "PURGATORY" })).toBe(true);
    expect(sealReady("GREEK", { ...NO_SEAL, verdict: "PASSED" })).toBe(false); // the account first
    expect(sealReady("GREEK", { ...NO_SEAL, verdict: "PASSED", account: "GORGIAS" })).toBe(true);
    expect(sealReady("CHINESE", { ...NO_SEAL, verdict: "FAILED" })).toBe(false); // a reason first
    // 存疑 / 重审 carry no account or reasons (backend fail_reasons.check refuses reasons on them).
    expect(sealPayload("GREEK", { ...NO_SEAL, verdict: "RETRY", account: "GORGIAS" })).toEqual({ verdict: "RETRY" });
    expect(sealPayload("CHINESE", { ...NO_SEAL, verdict: "PURGATORY", notes: "  待查  " })).toEqual({ verdict: "PURGATORY", notes: "待查" });
    expect(passBarredBy({ offence: "FIVE_HEINOUS" })).toBe("judgment.detail.passed_barred_five_heinous");
    expect(passBarredBy({ offence: "MURDER" })).toBeNull();
  });
});

describe("按住落印", () => {
  it("is greyed until a verdict is chosen; a short press sends nothing; holding 1 s seals", async () => {
    mockConclude.mockResolvedValue({ data: {} });
    const sealed = open();
    expect(screen.getByTestId("seal-hold").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("seal-option-RETRY"));
    fireEvent.changeText(screen.getByTestId("seal-notes"), "证词互相矛盾");
    fireEvent(screen.getByTestId("seal-hold"), "pressIn");
    fireEvent(screen.getByTestId("seal-hold"), "pressOut");
    fireEvent.press(screen.getByTestId("seal-hold"));
    expect(mockConclude).not.toHaveBeenCalled();
    expect(HOLD_TO_SEAL_MS).toBe(1000); // the Pressable's delayLongPress
    fireEvent(screen.getByTestId("seal-hold"), "longPress");
    await waitFor(() => expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "RETRY", notes: "证词互相矛盾" }));
    await waitFor(() => expect(sealed).toHaveBeenCalled());
  });

  it("a refusal the app has no words for is shown as the server said it, and nothing is sealed", async () => {
    mockConclude.mockRejectedValue({ response: { status: 400, data: { detail: "未受洗的灵魂不入炼狱。", code: "purgatory_unbaptized" } } });
    const sealed = open({ civilization: "EUROPEAN" });
    fireEvent.press(screen.getByTestId("seal-option-PURGATORY"));
    fireEvent(screen.getByTestId("seal-hold"), "longPress");
    await waitFor(() => expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "PURGATORY" }));
    await act(async () => {});
    expect(sealed).not.toHaveBeenCalled();
    expect(screen.getByTestId("seal-sheet")).toBeTruthy();
  });

  it("the failure line: the server's own sentence for a refusal the app has no words for; translated for known codes", () => {
    const t = (key: string) => key;
    const refused = (data: object) => ({ response: { status: 400, data } });
    expect(verdictFailure(t, refused({ detail: "未受洗的灵魂不入炼狱。", code: "purgatory_unbaptized" }))).toBe("未受洗的灵魂不入炼狱。");
    expect(verdictFailure(t, refused({ error: "Not allowed." }))).toBe("Not allowed.");
    expect(verdictFailure(t, refused({ detail: "x", code: "fail_reason_required" }))).toBe("judgment.fail_reason_errors.fail_reason_required");
    expect(verdictFailure(t, new Error("network"))).toBe("officer_app.state.error_title");
  });

  it("shows the dashed seal before it is set", () => {
    open();
    expect(screen.getByTestId("seal-pending")).toBeTruthy();
  });
});
