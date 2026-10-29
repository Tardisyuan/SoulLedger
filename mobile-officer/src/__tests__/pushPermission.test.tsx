/**
 * EMUI on Android 12 (phone QA 10-29b): the first 开启推送 said 「系统已关闭通知」 while the system dialog was still
 * up -- `requestPermissionsAsync` came back before the officer answered, and "undetermined" was read as a refusal.
 * Now an undetermined answer is read again for a moment; one still unanswered says so, never "turned off".
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import * as push from "../push";
import { MeTab } from "../screens/me";
import { renderOfficer } from "./harness";

jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));

const system = (Notifications as unknown as { __state: { status: string; answer: string; canAskAgain?: boolean } }).__state;

beforeEach(() => {
  Object.assign(system, { status: "undetermined", answer: "granted", canAskAgain: undefined });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("requestPermission", () => {
  it("an answer that lands after the call returned is waited for: granted, not denied", async () => {
    jest.useFakeTimers();
    system.answer = "undetermined"; // the call returns with the dialog still up
    const asked = push.requestPermission();
    await jest.advanceTimersByTimeAsync(600);
    system.status = "granted"; // the officer taps 允许
    await jest.advanceTimersByTimeAsync(600);
    await expect(asked).resolves.toBe("granted");
  });

  it("a refusal is still a refusal, and is not waited on", async () => {
    system.answer = "denied";
    await expect(push.requestPermission()).resolves.toBe("denied");
  });

  it("never answered: undetermined after the wait, not denied", async () => {
    jest.useFakeTimers();
    system.answer = "undetermined";
    const asked = push.requestPermission();
    await jest.advanceTimersByTimeAsync(5000);
    await expect(asked).resolves.toBe("undetermined");
  });
});

describe("the switch on 我的", () => {
  it("unanswered says to answer the system, not that the system turned it off", async () => {
    jest.spyOn(push, "requestPermission").mockResolvedValue("undetermined");
    renderOfficer(<MeTab onOpen={() => {}} />);
    const row = await screen.findByTestId("me-push");
    await act(async () => {
      fireEvent.press(row);
    });
    expect(screen.getByText("通知还没打开。系统询问时选「允许」，再点一次。")).toBeTruthy();
    expect(screen.queryByText("系统已关闭通知。请先在系统设置里放行。")).toBeNull();
  });

  it("denied still says the system turned it off", async () => {
    jest.spyOn(push, "requestPermission").mockResolvedValue("denied");
    renderOfficer(<MeTab onOpen={() => {}} />);
    const row = await screen.findByTestId("me-push");
    await act(async () => {
      fireEvent.press(row);
    });
    expect(screen.getByText("系统已关闭通知。请先在系统设置里放行。")).toBeTruthy();
    expect(screen.queryByText("通知还没打开。系统询问时选「允许」，再点一次。")).toBeNull();
  });
});
