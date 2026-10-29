/**
 * 批准、驳回前认面容 (Design 第二十八批 O1): every approve and reject asks the phone first; a cancelled or
 * unrecognised check sends nothing, keeps the sheet and the typed reason, and says which of the two did not happen.
 * Comments and co-sign opinions never ask. The switch is on by default, greyed on a phone with no screen lock.
 */
import { platform } from "@soulledger/core/platform";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";

import { confirmKey } from "../deviceCheck";
import { USER_KEY } from "../session";
import { MeTab } from "../screens/me";
import { CosignSheet, DecisionSheet } from "../screens/sheets";
import { translate } from "../shared";
import { renderOfficer } from "./harness";

const mockSubmit = jest.fn();
jest.mock("../rules", () => ({ ...jest.requireActual("../rules"), submitDecision: (...a: unknown[]) => mockSubmit(...a) }));
const mockAddCosigner = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { stats: jest.fn(async () => ({ data: { concluded_this_month: 0, concluded_total: 0, open_claims: 0, appeals_reviewed: 0, appeals_in_review: 0 } })), addCosigner: (...a: unknown[]) => mockAddCosigner(...a), signerCandidates: jest.fn(async () => ({ data: [{ id: 2, name: "孟婆", username: "mengpo", role: "JUDGE" }] })) },
}));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));

const auth = LocalAuthentication as unknown as { __state: { level: number; success: boolean; types: number[]; error: string } };
const authenticate = LocalAuthentication.authenticateAsync as jest.Mock;

const detailOf = (kind: string) => ({ kind, id: "x-1", title: "案卷", created_at: "2026-10-09T01:00:00Z", actionable: true, state: "actionable", workflow_id: "wf-1", node_id: "n-1" }) as never;
const FAILED_APPROVE = "没有认出面容，还没批准。再点一次确认重试。";
const FAILED_REJECT = "没有认出面容，还没驳回。再点一次确认重试。";

beforeEach(() => {
  jest.clearAllMocks();
  auth.__state.level = 1;
  auth.__state.success = true;
  auth.__state.types = [2];
  auth.__state.error = "authentication_failed";
  platform().persistent.remove(confirmKey());
  mockSubmit.mockResolvedValue(undefined);
});

function sheet(kind: string, verdict: "approve" | "reject") {
  const onDone = jest.fn();
  const onClose = jest.fn();
  renderOfficer(<DecisionSheet key={`${kind}${verdict}`} open verdict={verdict} detail={detailOf(kind)} cooldown={null} onClose={onClose} onDone={onDone} />);
  return { onDone, onClose };
}

describe.each(["approval", "rebirth", "reassignment"])("%s", (kind) => {
  it("approve asks the system, then submits once", async () => {
    const { onDone } = sheet(kind, "approve");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(authenticate).toHaveBeenCalledTimes(1);
    // 系统弹框的理由走语言包(这里是中文那份),不是写死在代码里的一句
    expect(authenticate).toHaveBeenCalledWith({ promptMessage: translate("zh-Hans", "officer_app.biometric.prompt") });
    expect(translate("en", "officer_app.biometric.prompt")).not.toBe(translate("zh-Hans", "officer_app.biometric.prompt"));
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it("reject asks the system, then submits once", async () => {
    const { onDone } = sheet(kind, "reject");
    fireEvent.changeText(screen.getByTestId("decision-reason"), "材料不全");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
});

// A cooldown approval also needs its days, so it has its own case; letters have no approve/reject sheet.
describe("a cooldown approval", () => {
  it("asks too", async () => {
    const onDone = jest.fn();
    const facts = { reason: "x", remainingDays: 10, approved: true, desiredDays: 3 };
    renderOfficer(<DecisionSheet open verdict="approve" detail={detailOf("cooldown")} cooldown={facts} onClose={() => {}} onDone={onDone} />);
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(authenticate).toHaveBeenCalledTimes(1);
  });
});

describe("a check that does not pass", () => {
  it("approve: sends nothing, closes nothing, says 还没批准", async () => {
    auth.__state.success = false;
    const { onDone, onClose } = sheet("approval", "approve");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText(FAILED_APPROVE)).toBeTruthy();
    // Design 第三十二批: the ⚠ is the only error mark (no 「!」 in the text), so a screen reader must name it.
    expect(screen.getByTestId("decision-unrecognised").props.children).toBe(FAILED_APPROVE);
    expect(screen.getByLabelText("错误")).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(FAILED_REJECT)).toBeNull();
    expect(screen.getByTestId("decision-confirm").props.accessibilityState.disabled).toBe(false);
  });

  it("reject: keeps the reason, says 还没驳回, and a second tap that passes submits once", async () => {
    auth.__state.success = false;
    const { onDone } = sheet("reject", "reject");
    fireEvent.changeText(screen.getByTestId("decision-reason"), "材料不全");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText(FAILED_REJECT)).toBeTruthy();
    expect(screen.queryByText(FAILED_APPROVE)).toBeNull();
    expect(screen.getByTestId("decision-reason").props.value).toBe("材料不全");
    expect(mockSubmit).not.toHaveBeenCalled();

    auth.__state.success = true;
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit.mock.calls[0][0]).toMatchObject({ verdict: "reject", reason: "材料不全" });
    expect(screen.queryByText(FAILED_REJECT)).toBeNull();
  });

  it("a cancelled check says 已取消, not 没有认出, and sends nothing (phone QA 10-29b)", async () => {
    auth.__state.success = false;
    auth.__state.error = "user_cancel";
    const { onClose } = sheet("approval", "approve");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText("已取消，还没提交。再点一次确认重试。")).toBeTruthy();
    expect(screen.queryByText(FAILED_APPROVE)).toBeNull();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an empty reason is flagged before the system is asked", async () => {
    sheet("approval", "reject");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText(/驳回必须写理由/)).toBeTruthy();
    expect(authenticate).not.toHaveBeenCalled();
  });
});

describe("when nothing is asked", () => {
  it("the switch is off: submits without the system check", async () => {
    platform().persistent.set(confirmKey(), "0");
    const { onDone } = sheet("approval", "approve");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(authenticate).not.toHaveBeenCalled();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it("the phone has no screen lock: submits without the system check, even with the switch on", async () => {
    auth.__state.level = 0;
    const { onDone } = sheet("approval", "approve");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("a co-sign opinion never asks", async () => {
    mockAddCosigner.mockResolvedValue({ data: {} });
    renderOfficer(<CosignSheet open kind="approval" id="wf-1" onClose={() => {}} onDone={() => {}} />);
    fireEvent.press(await screen.findByTestId("cosign-2"));
    fireEvent.press(screen.getByTestId("cosign-confirm"));
    await waitFor(() => expect(mockAddCosigner).toHaveBeenCalled());
    expect(authenticate).not.toHaveBeenCalled();
  });
});

describe("the switch on 我的", () => {
  it("is on by default and remembers being turned off on this phone", async () => {
    renderOfficer(<MeTab onOpen={() => {}} />);
    const row = await screen.findByTestId("me-confirm-bio");
    expect(screen.getAllByText("批准、驳回前验证面容").length).toBeTruthy();
    expect(screen.getByText("别人拿到你的手机，也做不了决定")).toBeTruthy();
    expect(row.props.accessibilityState.disabled).toBeFalsy();
    expect(row).toHaveTextContent(/✓/);
    expect(platform().persistent.get(confirmKey())).toBeNull();

    await act(async () => {
      fireEvent.press(row);
    });
    expect(platform().persistent.get(confirmKey())).toBe("0");
    expect(authenticate).toHaveBeenCalledTimes(1); // turning it off asked the phone (A8)
    expect(authenticate).toHaveBeenCalledWith({ promptMessage: translate("zh-Hans", "officer_app.biometric.prompt_off") });
    await act(async () => {
      fireEvent.press(screen.getByTestId("me-confirm-bio"));
    });
    expect(platform().persistent.get(confirmKey())).toBeNull();
    expect(authenticate).toHaveBeenCalledTimes(1); // turning it back on asks nothing
  });

  it("stays on when the phone does not recognise whoever turns it off (A8)", async () => {
    auth.__state.success = false;
    renderOfficer(<MeTab onOpen={() => {}} />);
    const row = await screen.findByTestId("me-confirm-bio");
    await act(async () => {
      fireEvent.press(row);
    });
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(platform().persistent.get(confirmKey())).toBeNull();
    expect(screen.getByTestId("me-confirm-bio")).toHaveTextContent(/✓/);
    expect(screen.getByText("没有认出面容，这项仍然开着。")).toBeTruthy();
    expect(screen.queryByText("已取消，这项仍然开着。")).toBeNull();
  });

  it("stays on and says 已取消 (not 没有认出) when the check is cancelled (phone QA 10-29b)", async () => {
    auth.__state.success = false;
    auth.__state.error = "user_cancel";
    renderOfficer(<MeTab onOpen={() => {}} />);
    const row = await screen.findByTestId("me-confirm-bio");
    await act(async () => {
      fireEvent.press(row);
    });
    expect(platform().persistent.get(confirmKey())).toBeNull();
    expect(screen.getByTestId("me-confirm-bio")).toHaveTextContent(/✓/);
    expect(screen.getByText("已取消，这项仍然开着。")).toBeTruthy();
    expect(screen.queryByText("没有认出面容，这项仍然开着。")).toBeNull();
  });

  it("is each officer's own: one turning it off leaves it on for the next", async () => {
    platform().persistent.set(USER_KEY, JSON.stringify({ id: 41, username: "a" }));
    platform().persistent.set(confirmKey(), "0");
    platform().persistent.set(USER_KEY, JSON.stringify({ id: 42, username: "b" }));
    try {
      const { onDone } = sheet("approval", "approve");
      fireEvent.press(screen.getByTestId("decision-confirm"));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(authenticate).toHaveBeenCalledTimes(1); // officer 42 never turned it off
    } finally {
      platform().persistent.set(USER_KEY, JSON.stringify({ id: 41, username: "a" }));
      platform().persistent.remove(confirmKey());
      platform().persistent.remove(USER_KEY);
    }
  });

  it("names the fingerprint on a phone without face recognition", async () => {
    auth.__state.types = [1];
    renderOfficer(<MeTab onOpen={() => {}} />);
    expect((await screen.findAllByText("批准、驳回前验证指纹")).length).toBeTruthy();
    expect(screen.queryByText("批准、驳回前验证面容")).toBeNull();
  });

  it("starts off when this phone was told so earlier", async () => {
    platform().persistent.set(confirmKey(), "0");
    renderOfficer(<MeTab onOpen={() => {}} />);
    const row = await screen.findByTestId("me-confirm-bio");
    expect(row).toHaveTextContent(/○/);
    expect(row).not.toHaveTextContent(/✓/);
  });

  it("is greyed, with the way out, and does nothing when the phone has no screen lock", async () => {
    auth.__state.level = 0;
    renderOfficer(<MeTab onOpen={() => {}} />);
    const row = await screen.findByTestId("me-confirm-bio");
    expect(row.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("这部手机还没设锁屏密码，开不了。先在系统设置里设一个。")).toBeTruthy();
    expect(screen.queryByText("别人拿到你的手机，也做不了决定")).toBeNull();
    await act(async () => {
      fireEvent.press(row);
    });
    expect(platform().persistent.get(confirmKey())).toBeNull();
  });
});
