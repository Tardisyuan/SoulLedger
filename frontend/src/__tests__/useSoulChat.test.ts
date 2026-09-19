/**
 * The soul chat entry point's hooks: find a soul by its full code, then open the chat.
 *
 * The server rate-limits lookups per account, so the hook must fire exactly once
 * per submit: never on mount, never on retry.
 *
 * `soulHttp` is replaced by a plain axios instance whose transport is stubbed.
 * Its own behaviour (soul token, refresh, password gate) is `soul.ts`'s and is
 * tested by core's vitest (`api/__tests__/soul.test.ts`, `soulChat.test.ts`) —
 * importing the real module here would only pull its interceptors into this
 * run's coverage denominator as untested code (measured: core branches
 * 76.8% → 70.3%, under the 74% gate), without testing any of it.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { soulHttp } from "@soulledger/core/api/soul";
import { soulChatApi, soulChatErrorCode, soulChatErrorMessage, soulChatRetryAt } from "@soulledger/core/api/soul-chat";
import { useOpenSoulChat, useSoulChatLookup, useSoulConversations } from "@soulledger/core/hooks/useSoulChat";
import { soulChatKeys } from "@soulledger/core/query_keys";

jest.mock("@soulledger/core/api/soul", () => ({
  soulHttp: jest.requireActual("axios").create(),
  // The general copy is soul.ts's (tested by core's vitest); here only "it was asked for".
  soulErrorMessage: () => ({ key: "soul_app.errors.general" }),
}));

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let reply: (_config: InternalAxiosRequestConfig) => AxiosResponse;
const originalAdapter = soulHttp.defaults.adapter;

const ok = (config: InternalAxiosRequestConfig, data: unknown, status = 200) =>
  ({ status, data, headers: {}, config, statusText: "" }) as AxiosResponse;

beforeEach(() => {
  calls = [];
  reply = (config) => ok(config, {});
  soulHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    calls.push({
      method: config.method ?? "",
      url: config.url ?? "",
      body: config.data ? JSON.parse(config.data as string) : undefined,
    });
    return reply(config);
  };
});

afterEach(() => {
  soulHttp.defaults.adapter = originalAdapter;
});

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

const card = { user_id: 7, display_name: "Beatrice", avatar: null, is_active: true };

describe("soulChatApi", () => {
  it("looks up by POST body — the code never goes into a URL", async () => {
    reply = (config) => ok(config, card);
    await expect(soulChatApi.lookup("abcd23456x")).resolves.toEqual(card);
    expect(calls).toEqual([{ method: "post", url: "/me/chat/lookup/", body: { soul_code: "abcd23456x" } }]);
  });

  it("opens a direct chat with the looked-up user_id, and lists conversations", async () => {
    await soulChatApi.openDirect(7);
    await soulChatApi.conversations();
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["post", "/me/chat/conversations/", { target_user: 7 }],
      ["get", "/me/chat/conversations/", undefined],
    ]);
  });
});

describe("useSoulChatLookup", () => {
  it("does nothing until submitted, then calls exactly once — no retry on a 404", async () => {
    reply = (config) => {
      throw new AxiosError("nf", "ERR_BAD_REQUEST", config, null, ok(config, { detail: "x", code: "not_found" }, 404));
    };
    // A host that turns on mutation retries app-wide must not turn one lookup into three.
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 2, retryDelay: 0 } } });
    const { result } = renderHook(() => useSoulChatLookup(), { wrapper: wrapper(client) });
    expect(calls).toEqual([]);

    act(() => result.current.mutate("ZZZZZZZZZZ"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toHaveLength(1);
  });

  it("returns the card on a hit", async () => {
    reply = (config) => ok(config, card);
    const { result } = renderHook(() => useSoulChatLookup(), { wrapper: wrapper(new QueryClient()) });
    act(() => result.current.mutate("G947JCWTSN"));
    await waitFor(() => expect(result.current.data).toEqual(card));
  });
});

describe("useOpenSoulChat / useSoulConversations", () => {
  it("opening invalidates the conversation list, which then refetches", async () => {
    reply = (config) => ok(config, config.method === "get" ? [] : { id: "c1", throttled: true }, 201);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => ({ list: useSoulConversations(), open: useOpenSoulChat() }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    act(() => result.current.open.mutate(7));
    await waitFor(() => expect(result.current.open.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: soulChatKeys.all });
    await waitFor(() => expect(calls.filter((c) => c.method === "get")).toHaveLength(2));
    expect(soulChatKeys.conversations().slice(0, 1)).toEqual([...soulChatKeys.all]);
  });
});

/** A refusal as the backend sends it: `{code, detail}`, plus `retry_at` on a 429. */
function refusal(status: number, data: unknown) {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError("fail", "ERR_BAD_RESPONSE", config, null, ok(config, data, status));
}

describe("the chat refusals the app picks its screens by", () => {
  it("reads the chat code, and only a known one", () => {
    expect(soulChatErrorCode(refusal(429, { code: "request_throttled", retry_at: "2026-09-20T10:00:00Z" }))).toBe("request_throttled");
    expect(soulChatErrorCode(refusal(403, { code: "muted" }))).toBe("muted");
    // A code this client does not know is not guessed at.
    expect(soulChatErrorCode(refusal(409, { code: "not_initiator" }))).toBeNull();
    expect(soulChatErrorCode(new Error("offline"))).toBeNull();
  });

  it("carries retry_at of a 429, and nothing else", () => {
    expect(soulChatRetryAt(refusal(429, { code: "request_throttled", retry_at: "2026-09-20T10:00:00Z" }))).toBe("2026-09-20T10:00:00Z");
    expect(soulChatRetryAt(refusal(403, { code: "muted" }))).toBeNull();
    expect(soulChatRetryAt(new Error("offline"))).toBeNull();
  });

  it("maps a chat code to its own copy, the server's self_conversation to `self`, the rest to the general copy", () => {
    expect(soulChatErrorMessage(refusal(409, { code: "closed" }))).toEqual({ key: "soul_app.chat.errors.closed" });
    expect(soulChatErrorMessage(refusal(400, { code: "self_conversation" }))).toEqual({ key: "soul_app.chat.errors.self" });
    expect(soulChatErrorMessage(refusal(500, {}))).toEqual({ key: "soul_app.errors.general" });
  });

  it("session, the list, the hall and a letter each hit their own endpoint", async () => {
    reply = (config) => ok(config, config.url === "/me/chat/conversations/" && config.method === "get" ? [] : { event_id: "$e", id: "c" });
    await soulChatApi.session();
    await soulChatApi.conversations();
    await soulChatApi.openInbox();
    await expect(soulChatApi.send("c1", "hi")).resolves.toBe("$e");
    expect(calls).toEqual([
      { method: "get", url: "/me/chat/session/", body: undefined },
      { method: "get", url: "/me/chat/conversations/", body: undefined },
      { method: "post", url: "/me/chat/conversations/", body: { kind: "OFFICER_INBOX" } },
      { method: "post", url: "/me/chat/conversations/c1/messages/", body: { body: "hi" } },
    ]);
  });
});
