/**
 * 「批准 / 驳回前验证指纹」covers every decision, not just the approve / reject sheet (phone QA 10-29b):
 * the wangsi conclusion, 期满释放 and the city god's 解送 / 退回. Switch on: nothing is sent until the phone's
 * check passes; a cancelled check says 已取消, an unrecognised one 没有认出. Switch off: sent without asking.
 * Which call sites count as decisions is pinned by decisionsAreChecked.test.ts.
 */
import { platform } from "@soulledger/core/platform";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { AppState } from "react-native";

import { confirmKey } from "../deviceCheck";
import { CityGodCase } from "../screens/cityGod";
import { ServingFact } from "../screens/servingFact";
import { WangsiReview } from "../screens/wangsi";
import { ToastProvider, translate } from "../shared";
import { OFFICER, renderOfficer } from "./harness";

const mockDecide = jest.fn();
const mockSendOn = jest.fn();
const mockRelease = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    get: jest.fn(async () => ({
      data: {
        id: "j-1", case_number: "CN-1", soul: "s-1", soul_name: "钱谦益", city_god_name: "城隍", city_god_status: "SENT_ON", untimely: true,
        held_until: "2999-11-03", wrongful_death_cause: "VICTIM", grievance_level: "MAJOR", grievance_status: "FILED", grievance_plea: "冤", verdict: null, is_final: false,
      },
    })),
    update: jest.fn(),
  },
  wangsiApi: { decideGrievance: (...a: unknown[]) => mockDecide(...a) },
  cityGodCasesApi: {
    get: jest.fn(async () => ({
      data: {
        id: "cg-1", case_number: "CN-1", city_god_name: "城隍甲", soul_name: "李白", city_god_status: "PENDING", untimely: false,
        origin_location: "长安", soul_birth_year: 701, soul_death_year: 762, soul_fated_death_year: 762, registered_via: "MANUAL",
        created_at: "2026-10-09T01:00:00Z", can_act: true, returned_at: null, city_god_note: "",
      },
    })),
    sendOn: (...a: unknown[]) => mockSendOn(...a),
    returnCase: jest.fn(),
  },
}));
jest.mock("@soulledger/core/api/disposition", () => ({
  ...jest.requireActual("@soulledger/core/api/disposition"),
  dispositionApi: {
    list: jest.fn(async () => ({
      data: { results: [{ id: "d-1", is_executed: true, expired_at: null, is_eternal: false, term_end: { year: 2026, month: 1, day: 1 }, sentence_years: 40, default_term_years: 40, can_release: true }], count: 1, next: null },
    })),
    release: (...a: unknown[]) => mockRelease(...a),
  },
}));

const auth = LocalAuthentication as unknown as { __state: { level: number; success: boolean; error: string } };
const authenticate = LocalAuthentication.authenticateAsync as jest.Mock;
// Flush the updates still in flight before the test ends (act warnings otherwise). No real-time sleep: a "nothing
// was sent" check waits for the refusal line instead, which only shows once the attempt is over.
const settle = () => act(async () => {});
const CANCELLED = translate("zh-Hans", "officer_app.biometric.cancelled");
const FAILED = translate("zh-Hans", "officer_app.biometric.failed_any", { bio: "面容" });

beforeEach(() => {
  jest.clearAllMocks();
  auth.__state.level = 1;
  auth.__state.success = true;
  auth.__state.error = "authentication_failed";
  platform().persistent.remove(confirmKey());
  mockDecide.mockResolvedValue({ data: {} });
  mockSendOn.mockResolvedValue({ data: {} });
  mockRelease.mockResolvedValue({ data: {} });
});

const SCREENS = [
  {
    name: "wangsi conclusion",
    sent: mockDecide,
    failureID: "wangsi-failure",
    go: async () => {
      renderOfficer(<WangsiReview id="j-1" onSettled={jest.fn()} onDone={jest.fn()} />);
      fireEvent.changeText(await screen.findByTestId("wangsi-note"), "不实");
      fireEvent.press(screen.getByTestId("wangsi-reject"));
    },
  },
  {
    name: "city god send-on",
    sent: mockSendOn,
    failureID: "city-god-failure",
    go: async () => {
      renderOfficer(<CityGodCase id="cg-1" onSettled={jest.fn()} onDone={jest.fn()} />, { user: { ...OFFICER, permissions: ["city_god.read", "city_god.execute"] } });
      fireEvent.press(await screen.findByTestId("city-god-send-on"));
      fireEvent.press(screen.getByTestId("city-god-confirm"));
    },
  },
  {
    name: "期满释放",
    sent: mockRelease,
    failureID: null,
    go: async () => {
      // In a ToastProvider: its refusal line is a toast, and "nothing was sent" waits for that line.
      renderOfficer(
        <ToastProvider>
          <ServingFact soulId="s-1" />
        </ToastProvider>,
        { user: { ...OFFICER, permissions: ["disposition.read", "disposition.execute"] } }
      );
      fireEvent.press(await screen.findByTestId("soul-release"));
      fireEvent.press(screen.getByTestId("soul-release-confirm"));
    },
  },
];

describe.each(SCREENS)("$name", ({ sent, failureID, go }) => {
  it("switch on, check passes: asks once, then sends", async () => {
    await go();
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    expect(authenticate).toHaveBeenCalledWith({ promptMessage: translate("zh-Hans", "officer_app.biometric.prompt") });
    await settle();
  });

  it("switch on, not recognised: nothing is sent, and it says 没有认出", async () => {
    auth.__state.success = false;
    await go();
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(sent).not.toHaveBeenCalled();
    if (failureID) {
      expect(screen.getByTestId(failureID).props.children).toBe(FAILED);
      expect(screen.queryByText(CANCELLED)).toBeNull();
    }
  });

  it("switch on, cancelled: nothing is sent, and it says 已取消 — not 没有认出", async () => {
    auth.__state.success = false;
    auth.__state.error = "user_cancel";
    await go();
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(CANCELLED)).toBeTruthy();
    expect(sent).not.toHaveBeenCalled();
    if (failureID) {
      expect(screen.getByTestId(failureID).props.children).toBe(CANCELLED);
      expect(screen.queryByText(FAILED)).toBeNull();
    }
  });

  it("switch off: sent without asking", async () => {
    platform().persistent.set(confirmKey(), "0");
    await go();
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    expect(authenticate).not.toHaveBeenCalled();
    await settle();
  });
});

// 真机 10-29c(o13b):指纹先被拒、再通过，屏上却是「释放失败」,后端没收到请求。认证通过就发;没认出 / 取消说它自己的话;
// 请求没有任何回应时说「网络错误」,绝不说「释放失败」。
describe("期满释放 after the check (phone QA 10-29c)", () => {
  const NETWORK = translate("zh-Hans", "officer_app.confirm.reasons.network");
  const GENERIC = translate("zh-Hans", "disposition.release_error.generic");
  const noAnswer = () => Object.assign(new Error("Network Error"), { request: {} });
  const open = async () => {
    renderOfficer(
      <ToastProvider>
        <ServingFact soulId="s-1" />
      </ToastProvider>,
      { user: { ...OFFICER, permissions: ["disposition.read", "disposition.execute"] } }
    );
    fireEvent.press(await screen.findByTestId("soul-release"));
  };

  it("not recognised, then recognised: the first tap sends nothing, the second sends once and says 已期满释放", async () => {
    authenticate.mockResolvedValueOnce({ success: false, error: "authentication_failed" }).mockResolvedValueOnce({ success: true });
    await open();
    fireEvent.press(screen.getByTestId("soul-release-confirm"));
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(mockRelease).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("soul-release-confirm"));
    await waitFor(() => expect(mockRelease).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(translate("zh-Hans", "disposition.release_success"))).toBeTruthy();
    expect(screen.queryByText(GENERIC)).toBeNull();
    await settle();
  });

  it.each(["lockout", "timeout", "unknown"])("a check ending in %s sends nothing and says 没有认出, never 释放失败", async (error) => {
    authenticate.mockResolvedValueOnce({ success: false, error });
    await open();
    fireEvent.press(screen.getByTestId("soul-release-confirm"));
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(GENERIC)).toBeNull();
    expect(mockRelease).not.toHaveBeenCalled();
    await settle();
  });

  it("check passed but the request got no answer: 网络错误, the sheet stays, not 释放失败", async () => {
    mockRelease.mockRejectedValueOnce(noAnswer());
    await open();
    fireEvent.press(screen.getByTestId("soul-release-confirm"));
    expect(await screen.findByText(NETWORK)).toBeTruthy();
    expect(screen.queryByText(GENERIC)).toBeNull();
    expect(screen.getByTestId("soul-release-sheet")).toBeTruthy();
    await settle();
  });

  it("sends only once the app is in front again: Android calls back while the prompt is closing", async () => {
    const listeners: ((s: string) => void)[] = [];
    const change = (s: string) => listeners.forEach((fn) => fn(s));
    const was = AppState.currentState;
    (AppState as { currentState: string }).currentState = "background";
    const listen = jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, fn: (s: string) => void) => {
      listeners.push(fn);
      return { remove: jest.fn() };
    }) as never);
    // Fake timers: the wait has a 2 s cap (deviceCheck.ts `foreground`); a real-time sleep would say nothing
    // about it under load. Advance well inside the cap, with no `active` yet: nothing may have gone out.
    jest.useFakeTimers();
    try {
      await open();
      fireEvent.press(screen.getByTestId("soul-release-confirm"));
      await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
      await act(() => jest.advanceTimersByTimeAsync(1000));
      expect(mockRelease).not.toHaveBeenCalled();
      await act(async () => change("active"));
      await waitFor(() => expect(mockRelease).toHaveBeenCalledTimes(1));
    } finally {
      (AppState as { currentState: string }).currentState = was;
      listen.mockRestore();
      jest.useRealTimers();
    }
    await settle();
  });
});

describe("a decision that got no answer says 网络错误, not the generic refusal", () => {
  const NETWORK = translate("zh-Hans", "officer_app.confirm.reasons.network");
  const noAnswer = () => Object.assign(new Error("Network Error"), { request: {} });
  it.each([
    ["wangsi conclusion", 0, "wangsi-failure", "common.error"],
    ["city god send-on", 1, "city-god-failure", "judgment.claim.refused.generic"],
  ] as const)("%s", async (_name, i, failureID, generic) => {
    SCREENS[i].sent.mockRejectedValueOnce(noAnswer());
    await SCREENS[i].go();
    await waitFor(() => expect(screen.getByTestId(failureID).props.children).toBe(NETWORK));
    expect(screen.queryByText(translate("zh-Hans", generic))).toBeNull();
    await settle();
  });
});
