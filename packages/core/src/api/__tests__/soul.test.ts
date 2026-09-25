/**
 * The soul client's session rules, driven through the REAL interceptors with a
 * stubbed transport (axios `adapter`), not a mocked axios — a mock of axios
 * would be a test of the mock.
 */
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  configurePlatform,
  resetPlatform,
  type KeyValueStore,
} from "../../platform/index";
import ts from "typescript";
import {
  RESET_CODE_EXPIRED_ERROR,
  RESET_CODE_WRONG_ERROR,
  clearSoulTokens,
  onSoulPasswordChangeRequired,
  passwordResetErrorMessage,
  soulApi,
  soulErrorMessage,
  soulHttp,
  storeSoulTokens,
} from "../soul";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

type Reply = { status: number; data?: unknown } | "offline";
let session: ReturnType<typeof memoryStore>;
let persistent: ReturnType<typeof memoryStore>;
let secure: ReturnType<typeof memoryStore>;
let onUnauthorized: ReturnType<typeof vi.fn<() => void>>;
let calls: { url: string; auth: string | undefined; body: unknown }[];

function script(routes: Record<string, Reply[]>) {
  soulHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? "";
    calls.push({
      url,
      auth: config.headers?.Authorization as string | undefined,
      body: config.data ? JSON.parse(config.data as string) : undefined,
    });
    const reply = routes[url]?.shift();
    if (!reply) throw new Error(`unscripted request: ${url}`);
    if (reply === "offline") {
      throw new AxiosError("Network Error", "ERR_NETWORK", config);
    }
    const response = { status: reply.status, data: reply.data, headers: {}, config, statusText: "" } as AxiosResponse;
    if (reply.status >= 400) {
      throw new AxiosError("fail", "ERR_BAD_RESPONSE", config, null, response);
    }
    return response;
  };
}

beforeEach(() => {
  session = memoryStore();
  persistent = memoryStore();
  secure = memoryStore();
  onUnauthorized = vi.fn<() => void>();
  calls = [];
  configurePlatform({
    session,
    persistent,
    secure,
    onUnauthorized,
    onSessionSuspend: () => () => {},
    onSessionResume: () => () => {},
    notify: () => {},
    baseUrl: "http://api.test/api/v1",
  });
});

afterEach(() => {
  resetPlatform();
});

describe("token storage", () => {
  it("puts the refresh token in secure and the access token in session — never in persistent", () => {
    storeSoulTokens({ access: "A1", refresh: "R1" });
    expect(secure.data.get(REFRESH_TOKEN_KEY)).toBe("R1");
    expect(session.data.get(ACCESS_TOKEN_KEY)).toBe("A1");
    expect([...persistent.data.values()]).toEqual([]);
  });

  it("clears both stores", () => {
    storeSoulTokens({ access: "A1", refresh: "R1" });
    clearSoulTokens();
    expect(secure.data.size + session.data.size).toBe(0);
  });
});

describe("401 handling", () => {
  it("refreshes through /soul-auth/refresh/ once, stores the rotated pair, and replays", async () => {
    storeSoulTokens({ access: "old", refresh: "R1" });
    script({
      "/me/": [{ status: 401 }, { status: 200, data: { soul_code: "S" } }],
      "/soul-auth/refresh/": [{ status: 200, data: { access: "new", refresh: "R2" } }],
    });
    const me = await soulApi.me();
    expect(me).toEqual({ soul_code: "S" });
    expect(calls.map((c) => c.url)).toEqual(["/me/", "/soul-auth/refresh/", "/me/"]);
    expect(calls[1].body).toEqual({ refresh: "R1" });
    expect(calls[2].auth).toBe("Bearer new");
    expect(secure.data.get(REFRESH_TOKEN_KEY)).toBe("R2");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("ends the session when the server refuses the refresh", async () => {
    storeSoulTokens({ access: "old", refresh: "R1" });
    script({
      "/me/life/": [{ status: 401 }],
      "/soul-auth/refresh/": [{ status: 401, data: { code: "token_not_valid" } }],
    });
    await expect(soulApi.life()).rejects.toBeTruthy();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(secure.data.has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(session.data.has(ACCESS_TOKEN_KEY)).toBe(false);
  });

  it("ends the session when there is no refresh token at all", async () => {
    script({ "/me/": [{ status: 401 }] });
    await expect(soulApi.me()).rejects.toBeTruthy();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("keeps the session when the refresh never reached the server (offline)", async () => {
    storeSoulTokens({ access: "old", refresh: "R1" });
    script({ "/me/": [{ status: 401 }], "/soul-auth/refresh/": ["offline"] });
    const error = await soulApi.me().catch((e) => e);
    expect(soulErrorMessage(error).key).toBe("soul_app.errors.network");
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(secure.data.get(REFRESH_TOKEN_KEY)).toBe("R1");
  });

  it("does not refresh-and-replay a failed login", async () => {
    storeSoulTokens({ access: "old", refresh: "R1" });
    script({ "/soul-auth/login/": [{ status: 401, data: { code: "invalid_credentials" } }] });
    const error = await soulApi.login("X", "bad").catch((e) => e);
    expect(calls.map((c) => c.url)).toEqual(["/soul-auth/login/"]);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(soulErrorMessage(error).key).toBe("soul_app.errors.invalid_credentials");
  });
});

describe("403 password_change_required", () => {
  it("tells subscribers, and only for that code", async () => {
    const handler = vi.fn();
    const off = onSoulPasswordChangeRequired(handler);
    script({
      "/me/": [
        { status: 403, data: { code: "password_change_required" } },
        { status: 403, data: { code: "initial_password_expired" } },
      ],
    });
    await soulApi.me().catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
    await soulApi.me().catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    off();
  });
});

describe("soulErrorMessage", () => {
  function httpError(status: number, data?: unknown) {
    return new AxiosError("x", "ERR", undefined, null, { status, data } as AxiosResponse);
  }

  it.each([
    ["invalid_credentials", 401],
    ["rate_limited", 429],
    ["weak_password", 400],
    ["cooldown", 409],
    ["appeal_used", 409],
    ["past_life_read_only", 403],
  ])("maps %s to its own key", (code, status) => {
    expect(soulErrorMessage(httpError(status, { code }))).toEqual({ key: `soul_app.errors.${code}` });
  });

  it("does not swallow an unmapped code: it travels as a parameter", () => {
    expect(soulErrorMessage(httpError(409, { code: "brand_new_rule" }))).toEqual({
      key: "soul_app.errors.unknown",
      params: { code: "brand_new_rule" },
    });
    expect(soulErrorMessage(httpError(500))).toEqual({
      key: "soul_app.errors.unknown",
      params: { code: "500" },
    });
  });

  it("separates DRF field validation from a coded 400", () => {
    expect(soulErrorMessage(httpError(400, { soul_code: ["required"] })).key).toBe(
      "soul_app.errors.validation"
    );
  });

  it("does not call a programming error a network failure", () => {
    expect(soulErrorMessage(new TypeError("boom")).key).toBe("soul_app.errors.unknown");
  });
});

describe("password reset (「忘记密码」)", () => {
  function httpError(status: number, data?: unknown) {
    return new AxiosError("x", "ERR", undefined, null, { status, data } as AxiosResponse);
  }

  it("posts step 1 and step 2 to the auth endpoints, signed out, and hands back only {detail}", async () => {
    script({
      "/auth/reset-password/": [{ status: 200, data: { detail: "sent" } }],
      "/auth/set-new-password/": [{ status: 200, data: { detail: "done" } }],
    });
    await expect(soulApi.requestPasswordReset("soul@example.com")).resolves.toEqual({ detail: "sent" });
    const body = { email: "soul@example.com", code: "123456", new_password: "new-password-1" };
    await expect(soulApi.setNewPassword(body)).resolves.toEqual({ detail: "done" });
    expect(calls).toEqual([
      { url: "/auth/reset-password/", auth: undefined, body: { email: "soul@example.com" } },
      { url: "/auth/set-new-password/", auth: undefined, body },
    ]);
    // A reset is not a sign-in: nothing was stored.
    expect(session.data.size + secure.data.size + persistent.data.size).toBe(0);
  });

  it.each<[string, unknown, string]>([
    ["expired", httpError(400, { error: RESET_CODE_EXPIRED_ERROR }), "soul_app.forgot_password.code_expired"],
    ["wrong", httpError(400, { error: RESET_CODE_WRONG_ERROR }), "soul_app.forgot_password.code_wrong"],
    ["validator refusal", httpError(400, { error: "['This password is too common.']" }), "soul_app.errors.weak_password"],
    ["new_password field", httpError(400, { new_password: ["too short"] }), "soul_app.errors.weak_password"],
    ["code field", httpError(400, { code: ["验证码必须是6位数字"] }), "soul_app.forgot_password.code_wrong"],
    ["email field", httpError(400, { email: ["bad"] }), "soul_app.errors.validation"],
    ["too many tries", httpError(429, { error: "验证码错误次数过多,请重新获取" }), "soul_app.forgot_password.too_many_tries"],
    ["no account", httpError(404, { error: "用户不存在" }), "soul_app.forgot_password.ask_hall"],
    ["two accounts", httpError(409, { error: "x" }), "soul_app.forgot_password.ask_hall"],
    ["offline", new AxiosError("Network Error", "ERR_NETWORK"), "soul_app.errors.network"],
  ])("classifies %s", (_, error, key) => {
    expect(passwordResetErrorMessage(error).key).toBe(key);
  });

  it("does not swallow an unexpected status", () => {
    expect(passwordResetErrorMessage(httpError(500))).toEqual({ key: "soul_app.errors.unknown", params: { code: "500" } });
  });

  it("the two sentences it matches are still the ones set_new_password sends", () => {
    // The backend answers both with `{error}` and no `code`, so the sentence IS
    // the contract. Reword either there and this goes red, instead of the app
    // quietly calling a wrong code a weak password.
    const configPath = ts.findConfigFile(ts.sys.getCurrentDirectory(), (f) => ts.sys.fileExists(f), "tsconfig.json");
    const views = configPath && ts.sys.readFile(configPath.replace(/tsconfig\.json$/, "../../backend/apps/authentication/views.py"));
    if (!views) throw new Error("cannot read backend/apps/authentication/views.py");
    const view = views.slice(views.indexOf("def set_new_password"), views.indexOf("def ", views.indexOf("def set_new_password") + 4));
    expect(view).toContain(`{"error": "${RESET_CODE_EXPIRED_ERROR}"}`);
    expect(view).toContain(`{"error": "${RESET_CODE_WRONG_ERROR}"}`);
  });
});

describe("push tokens and notification settings", () => {
  function recordRequests(replies: Record<string, { status: number; data?: unknown }>) {
    const seen: { method: string; url: string; auth: unknown; body: unknown }[] = [];
    soulHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const url = config.url ?? "";
      seen.push({
        method: (config.method ?? "").toUpperCase(),
        url,
        auth: config.headers?.Authorization,
        body: config.data ? JSON.parse(config.data as string) : undefined,
      });
      const reply = replies[url];
      if (!reply) throw new Error(`unscripted request: ${url}`);
      return { status: reply.status, data: reply.data, headers: {}, config, statusText: "" } as AxiosResponse;
    };
    return seen;
  }

  it("registers a token with the soul's access token and returns the device", async () => {
    storeSoulTokens({ access: "A1", refresh: "R1" });
    const device = { id: "d1", platform: "IOS", is_active: true, last_seen_at: "t", created_at: "t" };
    const seen = recordRequests({ "/me/push-tokens/": { status: 201, data: device } });
    await expect(soulApi.registerPushToken("ExponentPushToken[abc]", "IOS")).resolves.toEqual(device);
    expect(seen).toEqual([
      {
        method: "POST",
        url: "/me/push-tokens/",
        auth: "Bearer A1",
        body: { token: "ExponentPushToken[abc]", platform: "IOS" },
      },
    ]);
  });

  it("unregisters by posting the token and resolves to nothing", async () => {
    storeSoulTokens({ access: "A1", refresh: "R1" });
    const seen = recordRequests({ "/me/push-tokens/unregister/": { status: 204 } });
    await expect(soulApi.unregisterPushToken("ExponentPushToken[abc]")).resolves.toBeUndefined();
    expect(seen.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "/me/push-tokens/unregister/", { token: "ExponentPushToken[abc]" }],
    ]);
  });

  it("reads settings with GET and sends only the changed fields with PATCH", async () => {
    storeSoulTokens({ access: "A1", refresh: "R1" });
    const settings = { rebirth: true, judgment: false, residence: true, locale: "en" };
    const seen = recordRequests({ "/me/notification-settings/": { status: 200, data: settings } });
    await expect(soulApi.notificationSettings()).resolves.toEqual(settings);
    await expect(soulApi.updateNotificationSettings({ judgment: false })).resolves.toEqual(settings);
    expect(seen.map((c) => [c.method, c.body])).toEqual([
      ["GET", undefined],
      ["PATCH", { judgment: false }],
    ]);
  });
});
