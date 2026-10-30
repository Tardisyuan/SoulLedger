/**
 * The soul client's failure readers and its 401 refresh, in packages/core/src/api/soul.ts.
 * The soul app's screens are tested in mobile/ against these; this file pins the readers themselves:
 * every branch is a sentence some screen shows, so a misread code shows the wrong sentence.
 */
import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { responseCode } from "@soulledger/core/api/client";

import {
  clearSoulTokens,
  onSoulPasswordChangeRequired,
  passwordResetAttemptsLeft,
  passwordResetErrorMessage,
  passwordResetRetryAfter,
  soulCodeMessage,
  soulDeviceLoginFailure,
  soulErrorCode,
  soulErrorMessage,
  soulErrorStatus,
  soulHttp,
  soulMfaFailure,
  storeSoulTokens,
} from "@soulledger/core/api/soul";

const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
const http = (status: number, data?: unknown) =>
  new AxiosError("x", "ERR", config, {}, { status, data, statusText: "", headers: {}, config });
const offline = () => new AxiosError("Network Error", "ERR_NETWORK", config, {});

describe("soulErrorMessage / soulCodeMessage", () => {
  it.each([
    ["not an axios error", new Error("boom"), { key: "soul_app.errors.unknown", params: { code: "client" } }],
    ["no response", offline(), { key: "soul_app.errors.network" }],
    ["a known code", http(400, { code: "rate_limited" }), { key: "soul_app.errors.rate_limited" }],
    ["an unknown code is carried", http(409, { code: "brand_new" }), { key: "soul_app.errors.unknown", params: { code: "brand_new" } }],
    ["a 400 without a code", http(400, { field: ["bad"] }), { key: "soul_app.errors.validation" }],
    ["other status is carried", http(502), { key: "soul_app.errors.unknown", params: { code: "502" } }],
  ])("%s", (_name, error, expected) => {
    expect(soulErrorMessage(error)).toEqual(expected);
  });

  it("reads status and code only from axios errors", () => {
    expect(soulErrorStatus(http(404))).toBe(404);
    expect(soulErrorStatus(offline())).toBeNull();
    expect(soulErrorStatus("nope")).toBeNull();
    expect(soulErrorCode(http(400, { code: "x" }))).toBe("x");
    expect(soulErrorCode(http(400, { code: 3 }))).toBeNull();
    expect(soulErrorCode(new Error())).toBeNull();
    // soulErrorCode stays axios-only even though the shared reader is not: a plain object with a code is not a soul error.
    expect(soulErrorCode({ response: { data: { code: "x" } } })).toBeNull();
    expect(soulCodeMessage("invalid_credentials")).toEqual({ key: "soul_app.errors.invalid_credentials" });
  });
});

describe("responseCode (core api/client), the one reader the three error-code helpers share", () => {
  it("reads a string code off any axios-shaped rejection, and nothing else", () => {
    expect(responseCode(http(409, { code: "not_cancellable" }))).toBe("not_cancellable");
    expect(responseCode({ response: { status: 400, data: { code: "draft_conflict" } } })).toBe("draft_conflict");
    expect(responseCode(http(400, { code: 3 }))).toBeNull();
    expect(responseCode(http(500))).toBeNull();
    expect(responseCode(offline())).toBeNull();
    expect(responseCode(null)).toBeNull();
    expect(responseCode("nope")).toBeNull();
  });
});

describe("passwordResetErrorMessage and its numbers", () => {
  it.each([
    ["a refusal code", http(400, { code: "reset_code_expired" }), "soul_app.forgot_password.err_expired_title"],
    ["no account asks the hall", http(404, { code: "no_soul_account" }), "soul_app.forgot_password.ask_hall"],
    ["DRF new_password errors", http(400, { new_password: ["short"] }), "soul_app.errors.weak_password"],
    ["DRF code errors", http(400, { code: ["wrong"] }), "soul_app.forgot_password.err_wrong_title"],
    ["other 400", http(400, {}), "soul_app.errors.validation"],
    ["offline", offline(), "soul_app.errors.network"],
    ["falls back to the generic reader", http(500), "soul_app.errors.unknown"],
    ["not axios", new Error(), "soul_app.errors.unknown"],
  ])("%s", (_name, error, key) => {
    expect(passwordResetErrorMessage(error).key).toBe(key);
  });

  it("reads attempts_left and retry_after only when they are usable numbers", () => {
    expect(passwordResetAttemptsLeft(http(400, { attempts_left: 2 }))).toBe(2);
    expect(passwordResetAttemptsLeft(http(400, { attempts_left: -1 }))).toBeNull();
    expect(passwordResetAttemptsLeft(new Error())).toBeNull();
    expect(passwordResetRetryAfter(http(429, { retry_after: 30 }))).toBe(30);
    expect(passwordResetRetryAfter(http(429, { retry_after: 0 }))).toBeNull();
    expect(passwordResetRetryAfter(new Error())).toBeNull();
  });
});

describe("soulMfaFailure", () => {
  it("reads a known code with its numbers", () => {
    expect(soulMfaFailure(http(423, { code: "locked", locked_until: "2026-10-16T12:00:00Z", retry_after: 60 }))).toEqual({
      code: "locked", remainingAttempts: null, lockedUntil: "2026-10-16T12:00:00Z", retryAfter: 60,
    });
    expect(soulMfaFailure(http(400, { code: "wrong", remaining_attempts: 3 })).remainingAttempts).toBe(3);
  });

  it("is other / network for what it does not know", () => {
    expect(soulMfaFailure(http(400, { code: "mystery" })).code).toBe("other");
    expect(soulMfaFailure(http(500)).code).toBe("other");
    expect(soulMfaFailure(offline()).code).toBe("network");
    expect(soulMfaFailure(new Error()).code).toBe("other");
  });
});

describe("soulDeviceLoginFailure", () => {
  it.each([
    [http(401, { code: "device_login_revoked", reason: "password_changed" }), { code: "revoked", reason: "password_changed" }],
    [http(401, { code: "device_login_revoked" }), { code: "revoked", reason: null }],
    [http(401, { code: "device_login_invalid" }), { code: "invalid" }],
    [http(429, { code: "rate_limited" }), { code: "rate_limited" }],
    [http(500), { code: "other" }],
    [offline(), { code: "network" }],
    [new Error(), { code: "other" }],
  ])("%#", (error, expected) => {
    expect(soulDeviceLoginFailure(error)).toEqual(expected);
  });
});

describe("the 401 refresh on soulHttp", () => {
  const original = soulHttp.defaults.adapter;
  afterEach(() => {
    soulHttp.defaults.adapter = original;
    clearSoulTokens();
  });

  /** Each request is answered by the next entry; records url + Authorization. */
  type Answer = (_config: InternalAxiosRequestConfig) => unknown;
  function script(...answers: Answer[]) {
    const seen: { url?: string; auth?: unknown }[] = [];
    const adapter: AxiosAdapter = async (c) => {
      seen.push({ url: c.url, auth: c.headers?.Authorization });
      const next = answers.shift();
      if (!next) throw new Error("unexpected request");
      const out = next(c);
      if (out instanceof Error) throw out;
      return { data: out, status: 200, statusText: "OK", headers: {}, config: c };
    };
    soulHttp.defaults.adapter = adapter;
    return seen;
  }
  const fail = (status: number, data?: unknown) => (c: InternalAxiosRequestConfig) =>
    new AxiosError("x", "ERR", c, {}, { status, data, statusText: "", headers: {}, config: c });

  it("rotates the refresh token once and replays the request with the new access token", async () => {
    storeSoulTokens({ access: "old", refresh: "r1" });
    const seen = script(fail(401), () => ({ access: "new", refresh: "r2" }), () => ({ ok: true }));
    await expect(soulHttp.get("/me/").then((r) => r.data)).resolves.toEqual({ ok: true });
    expect(seen.map((s) => s.url)).toEqual(["/me/", "/soul-auth/refresh/", "/me/"]);
    expect(seen[2].auth).toBe("Bearer new");
  });

  it("does not refresh a 401 from the auth endpoints themselves", async () => {
    storeSoulTokens({ access: "old", refresh: "r1" });
    const seen = script(fail(401));
    await expect(soulHttp.post("/soul-auth/login/", {})).rejects.toMatchObject({ response: { status: 401 } });
    expect(seen).toHaveLength(1);
  });

  it("keeps the session when the refresh itself has no response (offline)", async () => {
    storeSoulTokens({ access: "old", refresh: "r1" });
    script(fail(401), (c) => new AxiosError("Network Error", "ERR_NETWORK", c, {}));
    await expect(soulHttp.get("/me/")).rejects.toMatchObject({ code: "ERR_NETWORK" });
  });

  it("tells listeners when the server demands a password change", async () => {
    const heard = jest.fn();
    const off = onSoulPasswordChangeRequired(heard);
    script(fail(403, { code: "password_change_required" }));
    await expect(soulHttp.get("/me/")).rejects.toBeTruthy();
    off();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
