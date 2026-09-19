/**
 * The soul chat client rides `soulHttp`: the soul token, the soul refresh path.
 * Driven through the real interceptors with a stubbed adapter, as
 * soulSocial.test.ts does.
 */
import { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configurePlatform, resetPlatform, type KeyValueStore } from "../../platform/index";
import { SOUL_ERROR_CODES, soulCodeMessage, soulHttp, storeSoulTokens } from "../soul";
import { SOUL_CHAT_LOOKUP_ERROR_CODES, soulChatApi } from "../soul-chat";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

let calls: { method: string; url: string; auth: unknown; params: unknown; body: unknown }[];

beforeEach(() => {
  calls = [];
  configurePlatform({
    session: memoryStore(),
    persistent: memoryStore(),
    secure: memoryStore(),
    onUnauthorized: () => {},
    onSessionSuspend: () => () => {},
    onSessionResume: () => () => {},
    notify: () => {},
    deliverOnExit: () => false,
    baseUrl: "http://api.test/api/v1",
  });
  storeSoulTokens({ access: "SOUL", refresh: "R" });
  soulHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    calls.push({
      method: config.method ?? "",
      url: config.url ?? "",
      auth: config.headers?.Authorization,
      params: config.params,
      body: config.data ? JSON.parse(config.data as string) : undefined,
    });
    return { status: 200, data: { ok: true }, headers: {}, config, statusText: "" } as AxiosResponse;
  };
});

afterEach(() => resetPlatform());

describe("soulChatApi", () => {
  it("looks up with the soul token, the code in the POST body and nowhere in the URL", async () => {
    await soulChatApi.lookup("abcd23456x");
    expect(calls).toEqual([
      { method: "post", url: "/me/chat/lookup/", auth: "Bearer SOUL", params: undefined, body: { soul_code: "abcd23456x" } },
    ]);
  });

  it("opens with the looked-up user_id under the same token", async () => {
    await soulChatApi.openDirect(7);
    expect(calls[0]).toMatchObject({ method: "post", url: "/me/chat/conversations/", auth: "Bearer SOUL", body: { target_user: 7 } });
  });

  it("maps every lookup refusal to existing copy, not to the `unknown` fallback", () => {
    for (const code of SOUL_CHAT_LOOKUP_ERROR_CODES) {
      expect(SOUL_ERROR_CODES).toContain(code);
      expect(soulCodeMessage(code)).toEqual({ key: `soul_app.errors.${code}` });
    }
  });
});
