import { storeSoulTokens, clearSoulTokens } from "@soulledger/core/api/soul";
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, getRefreshToken, platform } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

import { installMobilePlatform, mobilePlatform, persistentStore, secureStore, sessionStore } from "../platform";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(async () => {
  installMobilePlatform();
  secure.clear();
  await AsyncStorage.clear();
});

it("installs the three stores into the ports they are named for", () => {
  expect(platform().session).toBe(sessionStore);
  expect(platform().persistent).toBe(persistentStore);
  expect(platform().secure).toBe(secureStore);
});

it("the refresh token goes to the Keychain/Keystore store; AsyncStorage never sees a token", async () => {
  storeSoulTokens({ access: "A", refresh: "R" });
  expect(secure.get(REFRESH_TOKEN_KEY)).toBe("R");
  expect(sessionStore.get(ACCESS_TOKEN_KEY)).toBe("A");
  expect(secure.has(ACCESS_TOKEN_KEY)).toBe(false);
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});

it("a removed refresh token is gone for the very next synchronous read", () => {
  storeSoulTokens({ access: "A", refresh: "R" });
  clearSoulTokens();
  expect(getRefreshToken()).toBeNull();
  expect(sessionStore.get(ACCESS_TOKEN_KEY)).toBeNull();
});

it("maps AppState background/active to suspend/resume", () => {
  const listeners: ((s: string) => void)[] = [];
  const spy = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_type, listener) => {
      listeners.push(listener as (s: string) => void);
      return { remove: jest.fn() } as never;
    });
  const suspended = jest.fn();
  const resumed = jest.fn();
  mobilePlatform.onSessionSuspend(suspended);
  mobilePlatform.onSessionResume(resumed);
  listeners.forEach((l) => l("background"));
  listeners.forEach((l) => l("active"));
  expect(suspended).toHaveBeenCalledWith("transient");
  expect(resumed).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
