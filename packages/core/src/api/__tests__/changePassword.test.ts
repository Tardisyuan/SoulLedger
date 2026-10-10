/**
 * `authApi.changePassword`: this device's refresh token goes along, and the new pair that comes back
 * replaces the stored one (every other device was signed out by the server).
 */
import { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../client";
import { authApi } from "../auth";
import {
  ACCESS_TOKEN_KEY,
  configurePlatform,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
  type KeyValueStore,
} from "../../platform/index";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

let sent: { url?: string; body: unknown }[];
let reply: unknown;

beforeEach(() => {
  sent = [];
  reply = { detail: "ok", access: "NEW-A", refresh: "NEW-R" };
  const persistent = memoryStore();
  persistent.set(ACCESS_TOKEN_KEY, "stale-cookie");
  configurePlatform({
    session: memoryStore(),
    persistent,
    secure: memoryStore(),
    onUnauthorized: () => {},
    onSessionSuspend: () => () => {},
    onSessionResume: () => () => {},
    notify: () => {},
    baseUrl: "http://api.test/api/v1",
  });
  setAccessToken("OLD-A");
  setRefreshToken("OLD-R");
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    sent.push({ url: config.url, body: config.data ? JSON.parse(config.data as string) : undefined });
    return { status: 200, data: reply, headers: {}, config, statusText: "" } as AxiosResponse;
  };
});

describe("changePassword", () => {
  it("sends this device's refresh token and stores the new pair", async () => {
    await authApi.changePassword("old-pw", "new-pw-123");
    expect(sent).toEqual([
      { url: "/auth/change-password/", body: { old_password: "old-pw", new_password: "new-pw-123", refresh: "OLD-R" } },
    ]);
    expect(getAccessToken()).toBe("NEW-A");
    expect(getRefreshToken()).toBe("NEW-R");
  });

  it("keeps the stored pair when the answer carries none", async () => {
    reply = { detail: "ok" };
    await authApi.changePassword({ old_password: "a", new_password: "b" });
    expect(getAccessToken()).toBe("OLD-A");
    expect(getRefreshToken()).toBe("OLD-R");
  });
});
