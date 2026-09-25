/**
 * 审判台「戊 · 发落」与「上一件」的请求形状:`judgmentApi.destinations` /
 * `previous` / `conclude`,经真实的 officer client、替换掉 adapter —— 同
 * soulsBatchRecycle.test.ts。
 */
import { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configurePlatform, resetPlatform, type KeyValueStore } from "../../platform/index";
import { api } from "../client";
import { judgmentApi } from "../judgment";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

let calls: { method: string; url: string; params: unknown; body: unknown }[];
const originalAdapter = api.defaults.adapter;

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
    baseUrl: "http://api.test/api/v1",
  });
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    calls.push({
      method: config.method ?? "",
      url: config.url ?? "",
      params: config.params,
      body: config.data ? JSON.parse(config.data as string) : undefined,
    });
    return { data: {}, status: 200, statusText: "", headers: {}, config } as AxiosResponse;
  };
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  resetPlatform();
});

describe("judgmentApi 「戊 · 发落」", () => {
  it("asks for destinations with `candidate_verdict`, not `verdict` (a list filter)", async () => {
    await judgmentApi.destinations("j1", "FAILED");
    expect(calls).toEqual([
      { method: "get", url: "/judgment/j1/destinations/", params: { candidate_verdict: "FAILED" }, body: undefined },
    ]);
  });

  it("sends the chosen destination and term with the verdict", async () => {
    await judgmentApi.conclude("j1", { verdict: "FAILED", destination_realm_id: "r5", term_years: 3 });
    expect(calls[0]).toMatchObject({
      method: "post",
      url: "/judgment/j1/conclude/",
      body: { verdict: "FAILED", destination_realm_id: "r5", term_years: 3 },
    });
  });
});

describe("judgmentApi.previous", () => {
  it("puts `at`, repeated skips and include_deferred on the query", async () => {
    await judgmentApi.previous({ at: "c", skip: ["a", "b"], includeDeferred: true });
    expect(calls[0].url).toBe("/judgment/previous/?at=c&skip=a&skip=b&include_deferred=true");
  });

  it("leaves include_deferred off by default", async () => {
    await judgmentApi.previous({ at: "c" });
    expect(calls[0].url).toBe("/judgment/previous/?at=c");
  });
});
