/**
 * The soul chat entry point: find a soul by its full code, then open the chat.
 *
 * Driven through the real `soulHttp` (soul token, interceptors) with only the
 * transport stubbed — a mocked `soulChatApi` would test the mock. The server
 * rate-limits lookups per account, so the hook must fire exactly once per
 * submit: never on mount, never on retry.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import {
  SOUL_ERROR_CODES,
  clearSoulTokens,
  soulCodeMessage,
  soulHttp,
  storeSoulTokens,
} from "@soulledger/core/api/soul";
import { SOUL_CHAT_LOOKUP_ERROR_CODES, soulChatApi } from "@soulledger/core/api/soul-chat";
import { useOpenSoulChat, useSoulChatLookup, useSoulConversations } from "@soulledger/core/hooks/useSoulChat";
import { soulChatKeys } from "@soulledger/core/query_keys";

type Call = { method: string; url: string; auth: unknown; body: unknown };
let calls: Call[];
let reply: (_config: InternalAxiosRequestConfig) => AxiosResponse;
const originalAdapter = soulHttp.defaults.adapter;

const ok = (config: InternalAxiosRequestConfig, data: unknown, status = 200) =>
  ({ status, data, headers: {}, config, statusText: "" }) as AxiosResponse;

beforeEach(() => {
  calls = [];
  reply = (config) => ok(config, {});
  storeSoulTokens({ access: "SOUL", refresh: "R" });
  soulHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    calls.push({
      method: config.method ?? "",
      url: config.url ?? "",
      auth: config.headers?.Authorization,
      body: config.data ? JSON.parse(config.data as string) : undefined,
    });
    return reply(config);
  };
});

afterEach(() => {
  soulHttp.defaults.adapter = originalAdapter;
  clearSoulTokens();
});

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

const card = { user_id: 7, display_name: "Beatrice", avatar: null, is_active: true };

describe("soulChatApi", () => {
  it("looks up by POST body with the soul token — the code never goes into a URL", async () => {
    reply = (config) => ok(config, card);
    await expect(soulChatApi.lookup("abcd23456x")).resolves.toEqual(card);
    expect(calls).toEqual([{ method: "post", url: "/me/chat/lookup/", auth: "Bearer SOUL", body: { soul_code: "abcd23456x" } }]);
    expect(calls[0].url).not.toContain("abcd");
  });

  it("opens a direct chat with the looked-up user_id, and lists conversations", async () => {
    await soulChatApi.openDirect(7);
    await soulChatApi.conversations();
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["post", "/me/chat/conversations/", { target_user: 7 }],
      ["get", "/me/chat/conversations/", undefined],
    ]);
  });

  it("maps every lookup refusal to existing copy, not to the `unknown` fallback", () => {
    for (const code of SOUL_CHAT_LOOKUP_ERROR_CODES) {
      expect(SOUL_ERROR_CODES).toContain(code);
      expect(soulCodeMessage(code)).toEqual({ key: `soul_app.errors.${code}` });
    }
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
