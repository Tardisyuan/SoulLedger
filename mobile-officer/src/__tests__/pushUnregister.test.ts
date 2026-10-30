/** Sign-out asks the server to forget the token first and clears the local copy after (A16). */
import { platform } from "@soulledger/core/platform";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";

import { PUSH_TOKEN_KEY, registerDevice, registeredToken, unregisterDevice } from "../push";
import { installMobilePlatform } from "../shared";

installMobilePlatform();

const mockUnregister = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { unregisterPush: (...a: unknown[]) => mockUnregister(...a), registerPush: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  platform().persistent.set(PUSH_TOKEN_KEY, "ExponentPushToken[abc]");
});

it("the token is still stored while the request is on its way, and gone after it", async () => {
  let storedDuringRequest: string | undefined;
  mockUnregister.mockImplementation(async () => {
    storedDuringRequest = registeredToken();
  });
  await unregisterDevice();
  expect(mockUnregister).toHaveBeenCalledWith("ExponentPushToken[abc]");
  expect(storedDuringRequest).toBe("ExponentPushToken[abc]");
  expect(registeredToken()).toBeUndefined();
});

it("a failed request does not throw, and the local copy is cleared all the same", async () => {
  mockUnregister.mockRejectedValue(new Error("Network Error"));
  await expect(unregisterDevice()).resolves.toBeUndefined();
  expect(registeredToken()).toBeUndefined();
});

// pushCore (cq-apps 2026-10-30 #6): server first, local copy after -- but a sign-in that registered again while the
// request was out owns the stored token now; clearing it would leave the next sign-out nothing to unregister.
it("a registration that lands while the unregister request is out keeps its token", async () => {
  const system = (Notifications as unknown as { __state: { status: string } }).__state;
  const extra = (Constants.expoConfig as unknown as { extra: Record<string, unknown> }).extra;
  system.status = "granted";
  extra.eas = { projectId: "p" };
  try {
    mockUnregister.mockImplementation(async () => {
      expect(await registerDevice()).toEqual({ ok: true, token: "ExponentPushToken[test-device-0001]" });
    });
    await unregisterDevice();
    expect(registeredToken()).toBe("ExponentPushToken[test-device-0001]");
    // With no registration in between, the next sign-out clears it (the guard must not keep tokens for good).
    mockUnregister.mockResolvedValue(undefined);
    await unregisterDevice();
    expect(registeredToken()).toBeUndefined();
  } finally {
    system.status = "undetermined";
    delete extra.eas;
  }
});
