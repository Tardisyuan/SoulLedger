/**
 * 「批准 / 驳回前验证指纹」covers every decision, not just the approve / reject sheet (phone QA 10-29b):
 * the wangsi conclusion, 期满释放 and the city god's 解送 / 退回. Switch on: nothing is sent until the phone's
 * check passes; a cancelled check says 已取消, an unrecognised one 没有认出. Switch off: sent without asking.
 * Which call sites count as decisions is pinned by decisionsAreChecked.test.ts.
 */
import { platform } from "@soulledger/core/platform";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";

import { confirmKey } from "../deviceCheck";
import { CityGodCase } from "../screens/cityGod";
import { ServingFact } from "../screens/servingFact";
import { WangsiReview } from "../screens/wangsi";
import { translate } from "../shared";
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
const settle = () => act(async () => new Promise((r) => setTimeout(r, 400)));
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
      renderOfficer(<ServingFact soulId="s-1" />, { user: { ...OFFICER, permissions: ["disposition.read", "disposition.execute"] } });
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
    await settle();
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
    await settle();
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
