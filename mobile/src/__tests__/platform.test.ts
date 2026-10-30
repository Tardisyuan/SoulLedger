import { storeSoulTokens, clearSoulTokens } from "@soulledger/core/api/soul";
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, getRefreshToken, platform } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

import { readCredential, storeCredential } from "../deviceLogin";
import { hydratePersistentStore, installMobilePlatform, mobilePlatform, onForeground, persistentStore, secureStore, sessionStore } from "../platform";

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

// opt-apps2 N2: the four foreground listeners now share this rule.
it("onForeground: background → active only; inactive → active (the face sheet, an alert) is not a return", () => {
  const listeners: ((s: string) => void)[] = [];
  const remove = jest.fn();
  const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.push(listener as (s: string) => void);
    return { remove } as never;
  });
  const back = jest.fn();
  const off = onForeground(back);
  for (const s of ["inactive", "active", "inactive", "active"]) listeners.forEach((l) => l(s));
  expect(back).not.toHaveBeenCalled();
  for (const s of ["inactive", "background", "active"]) listeners.forEach((l) => l(s));
  expect(back).toHaveBeenCalledTimes(1);
  off();
  expect(remove).toHaveBeenCalled();
  spy.mockRestore();
});

// opt-apps2 S5: every request read the refresh token from the Keychain / Keystore.
describe("the secure port's memory copy", () => {
  it("asks the native store once per key; a write or removal through the port is seen at once", () => {
    // The double's getItem asks its map `has(key)` once per native read.
    secure.set("k", "v1");
    const read = jest.spyOn(secure, "has");
    expect(secureStore.get("k")).toBe("v1");
    expect(secureStore.get("k")).toBe("v1");
    expect(read.mock.calls.filter(([key]) => key === "k")).toHaveLength(1);
    secureStore.set("k", "v2");
    expect(secureStore.get("k")).toBe("v2");
    expect(read.mock.calls.filter(([key]) => key === "k")).toHaveLength(1);
    secureStore.remove("k");
    expect(secureStore.get("k")).toBeNull();
    // An absent key is remembered as absent too.
    expect(secureStore.get("none")).toBeNull();
    expect(secureStore.get("none")).toBeNull();
    expect(read.mock.calls.filter(([key]) => key === "none")).toHaveLength(1);
    read.mockRestore();
  });

  it("the face / finger credential is never read through it", async () => {
    const mock = SecureStore as unknown as { __guarded: Map<string, string>; __auth: { error: unknown; prompts: string[] } };
    mock.__auth.error = null;
    await storeCredential("CRED");
    const before = mock.__auth.prompts.length;
    expect(await readCredential()).toEqual({ status: "ok", credential: "CRED" });
    expect(await readCredential()).toEqual({ status: "ok", credential: "CRED" });
    expect(mock.__auth.prompts.length - before).toBe(2); // asked (and verified) each time
    mock.__guarded.clear();
    expect(await readCredential()).toEqual({ status: "invalidated" });
  });
});

// opt-apps2 N5: Android throws for the whole multiGet when one row is past its cursor window.
it("hydrate: one unreadable row costs that key only, not every key", async () => {
  for (const k of ["theme", "huge", "account"]) persistentStore.remove(k);
  await AsyncStorage.setItem("theme", "dark");
  await AsyncStorage.setItem("huge", "x");
  await AsyncStorage.setItem("account", "QU33");
  const multi = jest.spyOn(AsyncStorage, "multiGet").mockRejectedValue(new Error("Row too big to fit into CursorWindow"));
  const rows: Record<string, string> = { theme: "dark", account: "QU33" };
  const one = jest.spyOn(AsyncStorage, "getItem").mockImplementation((key: string) => (key === "huge" ? Promise.reject(new Error("too big")) : Promise.resolve(rows[key] ?? null)));
  await hydratePersistentStore();
  expect(persistentStore.get("theme")).toBe("dark");
  expect(persistentStore.get("account")).toBe("QU33");
  expect(persistentStore.get("huge")).toBeNull();
  multi.mockRestore();
  one.mockRestore();
});
