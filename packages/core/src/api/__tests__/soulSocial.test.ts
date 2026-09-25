/**
 * The soul circle client rides `soulHttp`: the soul token, the soul refresh
 * path. Driven through the real interceptors with a stubbed adapter, as
 * soul.test.ts does — a mocked axios would test the mock.
 */
import { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configurePlatform, resetPlatform, type KeyValueStore } from "../../platform/index";
import { soulHttp, storeSoulTokens } from "../soul";
import { mediaUrl, soulSocialApi } from "../soul-social";

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

describe("soulSocialApi", () => {
  it("sends every call with the soul token, under /me/social/", async () => {
    await soulSocialApi.status();
    await soulSocialApi.feed({ page: 2, author: 7 });
    await soulSocialApi.search("甲");
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["get", "/me/social/status/"],
      ["get", "/me/social/feed/"],
      ["get", "/me/social/search/"],
    ]);
    expect(calls.every((c) => c.auth === "Bearer SOUL")).toBe(true);
    expect(calls[1].params).toEqual({ page: 2, author: 7 });
    expect(calls[2].params).toEqual({ q: "甲" });
  });

  it("posts with the default visibility TENANT and omits an absent parent", async () => {
    await soulSocialApi.createPost("你好");
    await soulSocialApi.comment("p1", "回复");
    expect(calls[0].body).toEqual({ content: "你好", visibility: "TENANT" });
    expect(calls[1]).toMatchObject({ url: "/me/social/posts/p1/comments/", body: { content: "回复" } });
  });

  it("follow and unfollow are the same path, POST and DELETE", async () => {
    expect(await soulSocialApi.follow(5)).toBe(true);
    expect(await soulSocialApi.unfollow(5)).toBe(false);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["post", "/me/social/users/5/follow/"],
      ["delete", "/me/social/users/5/follow/"],
    ]);
  });

  it("sends a numeric report target as a string — the serializer's field is a CharField", async () => {
    await soulSocialApi.report("USER", 42, "ABUSE");
    expect(calls[0].body).toEqual({ target_type: "USER", target_id: "42", reason: "ABUSE", detail: "" });
  });

  it("posts attached media ids in order, and sends no `media` key for a text-only post", async () => {
    await soulSocialApi.createPost("配图", "PUBLIC", ["m2", "m1"]);
    await soulSocialApi.createPost("只有字");
    expect(calls[0].body).toEqual({ content: "配图", visibility: "PUBLIC", media: ["m2", "m1"] });
    expect(calls[1].body).toEqual({ content: "只有字", visibility: "TENANT" });
    expect(calls[1].body).not.toHaveProperty("media");
  });

  it("uploads multipart with the soul token and reports progress as a fraction", async () => {
    const seen: { url?: string; type?: unknown; auth?: unknown; data?: unknown }[] = [];
    soulHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      seen.push({ url: config.url, type: config.headers?.["Content-Type"], auth: config.headers?.Authorization, data: config.data });
      config.onUploadProgress?.({ loaded: 50, total: 200, bytes: 50, lengthComputable: true });
      return { status: 201, data: { id: "m1" }, headers: {}, config, statusText: "" } as AxiosResponse;
    };
    const body = { append: () => {} } as FormData;
    const progress: number[] = [];
    const media = await soulSocialApi.uploadMedia(body, (f) => progress.push(f));
    expect(media).toEqual({ id: "m1" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: "/me/social/media/", auth: "Bearer SOUL" });
    expect(String(seen[0].type)).toMatch(/^multipart\/form-data/);
    expect(progress).toEqual([0.25]);
  });

  it("removes an unposted upload by id", async () => {
    await soulSocialApi.removeMedia("m9");
    expect(calls.map((c) => [c.method, c.url])).toEqual([["delete", "/me/social/media/m9/"]]);
  });
});

describe("mediaUrl", () => {
  it("joins the server's site-rooted path to the API host's origin, not to the /api/v1 base", () => {
    expect(mediaUrl("/api/v1/social-media/m1/?t=abc")).toBe("http://api.test/api/v1/social-media/m1/?t=abc");
  });

  it("leaves an absolute URL alone", () => {
    expect(mediaUrl("https://cdn.test/x.png")).toBe("https://cdn.test/x.png");
  });
});
