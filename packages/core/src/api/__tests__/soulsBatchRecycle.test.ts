/**
 * `soulsApi.batchRecycle` and `soulBatchRecycleErrorOf`, driven through the
 * real officer client with a stubbed adapter — as soulSocial.test.ts does.
 */
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configurePlatform, resetPlatform, type KeyValueStore } from "../../platform/index";
import { api } from "../client";
import { soulBatchRecycleErrorOf, soulsApi } from "../souls";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

let calls: { method: string; url: string; body: unknown }[];
let reply: { status: number; data: unknown };
const originalAdapter = api.defaults.adapter;

beforeEach(() => {
  calls = [];
  reply = { status: 200, data: { recycled: 1, results: [{ id: "a", cascade_id: "c" }] } };
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
      body: config.data ? JSON.parse(config.data as string) : undefined,
    });
    const response = { data: reply.data, status: reply.status, statusText: "", headers: {}, config } as AxiosResponse;
    if (reply.status >= 400) {
      throw new AxiosError("refused", String(reply.status), config, null, response);
    }
    return response;
  };
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  resetPlatform();
});

async function refusal(status: number, data: unknown): Promise<unknown> {
  reply = { status, data };
  try {
    await soulsApi.batchRecycle({ ids: ["a"] });
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to fail");
}

describe("soulsApi.batchRecycle", () => {
  it("POSTs the body to /souls/batch-recycle/", async () => {
    const res = await soulsApi.batchRecycle({ ids: ["a", "b"], reason: "dup" });
    expect(calls).toEqual([{ method: "post", url: "/souls/batch-recycle/", body: { ids: ["a", "b"], reason: "dup" } }]);
    expect(res.data.recycled).toBe(1);
  });
});

describe("soulBatchRecycleErrorOf", () => {
  it("reads a 409 refusal with its ids and archivable flag", async () => {
    const error = await refusal(409, { code: "not_deletable", error: "x", ids: ["a"], archivable: true });
    expect(soulBatchRecycleErrorOf(error)).toEqual({ code: "not_deletable", error: "x", ids: ["a"], archivable: true });
  });

  it("reads a 404 refusal", async () => {
    const error = await refusal(404, { code: "not_found", error: "x", ids: ["a"] });
    expect(soulBatchRecycleErrorOf(error)?.code).toBe("not_found");
  });

  it("is null for a 400 field-error body, an unknown code, and a non-axios error", async () => {
    expect(soulBatchRecycleErrorOf(await refusal(400, { ids: ["Duplicate ids: a."] }))).toBeNull();
    expect(soulBatchRecycleErrorOf(await refusal(404, { detail: "Not found." }))).toBeNull();
    expect(soulBatchRecycleErrorOf(await refusal(404, { code: "gone", error: "x", ids: [] }))).toBeNull();
    expect(soulBatchRecycleErrorOf(new Error("boom"))).toBeNull();
  });
});
