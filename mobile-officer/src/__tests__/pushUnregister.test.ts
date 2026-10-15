/** Sign-out asks the server to forget the token first and clears the local copy after (A16). */
import { platform } from "@soulledger/core/platform";

import { PUSH_TOKEN_KEY, registeredToken, unregisterDevice } from "../push";
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
