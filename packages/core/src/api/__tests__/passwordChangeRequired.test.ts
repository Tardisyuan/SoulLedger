/**
 * A 403 `password_change_required` (first sign-in, an administrator's reset, a password that aged out mid-session)
 * reaches the host through `onPasswordChangeRequired`; any other 403 does not. `passwordReasonKeys` knows the
 * history refusal.
 */
import { type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, onMfaSetupRequired, onPasswordChangeRequired } from "../client";
import { passwordReasonKeys } from "../auth";
import { configurePlatform, type KeyValueStore } from "../../platform/index";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

let body: unknown;

beforeEach(() => {
  configurePlatform({
    session: memoryStore(),
    persistent: memoryStore(),
    secure: memoryStore(),
    onUnauthorized: () => {},
    onSessionSuspend: () => () => {},
    onSessionResume: () => () => {},
    notify: () => {},
    baseUrl: "http://api.test/api/v1",
  });
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    throw Object.assign(new Error("HTTP 403"), { config, response: { status: 403, data: body, headers: {}, config } });
  };
});

afterEach(() => onPasswordChangeRequired(null));

describe("onPasswordChangeRequired", () => {
  it("fires once for the matching 403 and still rejects the request", async () => {
    const listener = vi.fn();
    onPasswordChangeRequired(listener);
    body = { detail: "请先修改密码。", code: "password_change_required" };
    await expect(api.get("/users/")).rejects.toBeTruthy();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for any other 403", async () => {
    const listener = vi.fn();
    onPasswordChangeRequired(listener);
    body = { detail: "forbidden" };
    await expect(api.get("/users/")).rejects.toBeTruthy();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("onMfaSetupRequired", () => {
  afterEach(() => onMfaSetupRequired(null));

  it("fires for 403 `mfa_setup_required` only, and not for the password one", async () => {
    const mfa = vi.fn();
    const password = vi.fn();
    onMfaSetupRequired(mfa);
    onPasswordChangeRequired(password);
    body = { detail: "请先开启两步验证。", code: "mfa_setup_required" };
    await expect(api.get("/souls/")).rejects.toBeTruthy();
    expect(mfa).toHaveBeenCalledTimes(1);
    expect(password).not.toHaveBeenCalled();
    body = { detail: "请先修改密码。", code: "password_change_required" };
    await expect(api.get("/souls/")).rejects.toBeTruthy();
    expect(mfa).toHaveBeenCalledTimes(1);
  });
});

describe("passwordReasonKeys", () => {
  it("a reused password has its own line", () => {
    expect(passwordReasonKeys({ new_password: [{ code: "password_reused", message: "x" }] })).toEqual(["profile.password_reason_reused"]);
  });
});
