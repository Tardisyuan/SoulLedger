/**
 * The SSE reader for `stream: true` (./assist-stream.ts). The body below is the
 * exact byte shape backend/apps/soul_assist/sse.py writes (`frame()`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configurePlatform, resetPlatform, setAccessToken, type KeyValueStore } from "../../platform/index";
import {
  AssistStreamHttpError,
  AssistStreamParser,
  assistBlocks,
  assistShownText,
  refusalBody,
  streamAssist,
  type AssistStreamFetch,
  INITIAL_ASSIST_STREAM_STATE,
  parseAssistStream,
  reduceAssistStream,
  type AssistStreamEvent,
} from "../assist-stream";

const frame = (data: AssistStreamEvent) => `event: ${data.event}\ndata: ${JSON.stringify(data)}\n\n`;

const CONVERSATION = "7f2c1d9e-0000-4000-8000-000000000001";
const BODY =
  frame({ event: "meta", conversation_id: CONVERSATION }) +
  frame({ event: "delta", text: "可以" }) +
  frame({ event: "delta", text: "申诉。\n第二行" }) +
  frame({
    event: "done",
    conversation_id: CONVERSATION,
    answer: { id: 9, role: "assistant", content: "可以申诉。\n第二行", interruption: "", created_at: "2026-10-01T00:00:00Z" },
    usage: { input_tokens: 10, output_tokens: 4, cache_read_tokens: 0 },
  });

async function* chunks(text: string, size: number) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

describe("parseAssistStream", () => {
  it.each([1, 3, 7, 1000])("reads the same events however the body is split (%i chars per chunk)", async (size) => {
    const events: AssistStreamEvent[] = [];
    for await (const event of parseAssistStream(chunks(BODY, size))) events.push(event);
    expect(events.map((e) => e.event)).toEqual(["meta", "delta", "delta", "done"]);
    const state = events.reduce(reduceAssistStream, INITIAL_ASSIST_STREAM_STATE);
    expect(state).toMatchObject({ conversationId: CONVERSATION, text: "可以申诉。\n第二行", error: null });
    expect(state.done?.usage.output_tokens).toBe(4);
  });

  it("returns nothing for a half-received event and completes it on the next push", () => {
    const parser = new AssistStreamParser();
    const whole = frame({ event: "delta", text: "好" });
    expect(parser.push(whole.slice(0, 10))).toEqual([]);
    expect(parser.push(whole.slice(10))).toEqual([{ event: "delta", text: "好" }]);
    expect(parser.end()).toEqual([]);
  });

  it("keeps an interrupted partial answer and reports the error", () => {
    const state = [
      { event: "meta", conversation_id: CONVERSATION },
      { event: "delta", text: "一半" },
      { event: "error", kind: "interrupted", text_sent: true, detail: "…", conversation_id: CONVERSATION, message_id: 3 },
    ].reduce((s, e) => reduceAssistStream(s, e as AssistStreamEvent), INITIAL_ASSIST_STREAM_STATE);
    expect(state.text).toBe("一半");
    expect(state.error).toMatchObject({ kind: "interrupted", message_id: 3 });
    expect(state.done).toBeNull();
  });

  it("tolerates CRLF line ends and a body that ends without the blank line", () => {
    const parser = new AssistStreamParser();
    const events = parser.push('event: delta\r\ndata: {"event":"delta","text":"a"}\r\n\n');
    expect(events).toEqual([{ event: "delta", text: "a" }]);
    parser.push('data: {"event":"delta","text":"b"}');
    expect(parser.end()).toEqual([{ event: "delta", text: "b" }]);
  });
});

/** Browsers and Node have it; core's tsconfig (no DOM, no Node types) does not name it. Tests only. */
declare const TextEncoder: { new (): { encode(text: string): Uint8Array } };

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

/** A body whose chunks the test releases one at a time; `abort` rejects the pending read like a fetch does. */
function controllableBody() {
  const queue: (string | null)[] = [];
  let wake: (() => void) | null = null;
  let aborted = false;
  const encoder = new TextEncoder();
  return {
    push(text: string | null) {
      queue.push(text);
      wake?.();
    },
    abort() {
      aborted = true;
      wake?.();
    },
    reader: {
      async read(): Promise<{ done: boolean; value?: Uint8Array }> {
        while (!queue.length && !aborted) await new Promise<void>((r) => (wake = r));
        if (aborted) throw new Error("AbortError");
        const next = queue.shift()!;
        return next === null ? { done: true } : { done: false, value: encoder.encode(next) };
      },
    },
  };
}

describe("streamAssist", () => {
  let body: ReturnType<typeof controllableBody>;
  let requests: { url: string; headers: Record<string, string>; body: unknown }[];
  let status: number[];

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
    setAccessToken("OLD");
    body = controllableBody();
    requests = [];
    status = [200];
  });
  afterEach(() => {
    resetPlatform();
    vi.useRealTimers();
  });

  const fetch: AssistStreamFetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const code = status.shift() ?? 200;
    (init.signal as { onabort?: () => void }).onabort = () => body.abort();
    return {
      ok: code < 400,
      status: code,
      json: async () => ({ code: "rate_limited", retry_at: "2026-10-01T10:00:00Z" }),
      body: code < 400 ? { getReader: () => body.reader } : null,
    };
  };
  const controller = () => {
    const signal: { aborted: boolean; onabort?: () => void } = { aborted: false };
    return { signal, abort: () => ((signal.aborted = true), signal.onabort?.()) };
  };

  it("posts stream: true with the token and locale, hands events on as they arrive, and ends on done", async () => {
    const events: string[] = [];
    const run = streamAssist({ fetch, path: "/me/assist/", body: { question: "q" }, controller: controller(), onEvent: (e) => events.push(e.event) });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ url: "http://api.test/api/v1/me/assist/", body: { question: "q", stream: true } });
    expect(requests[0].headers.Authorization).toBe("Bearer OLD");
    body.push(frame({ event: "meta", conversation_id: CONVERSATION }) + frame({ event: "delta", text: "一" }).slice(0, 12));
    await vi.waitFor(() => expect(events).toEqual(["meta"]));
    body.push(frame({ event: "delta", text: "一" }).slice(12));
    await vi.waitFor(() => expect(events).toEqual(["meta", "delta"]));
    body.push(BODY.slice(BODY.indexOf("event: done")));
    // Resolves on `done` without waiting for the server to close the body.
    await expect(run).resolves.toBe("ended");
    expect(events).toEqual(["meta", "delta", "done"]);
  });

  it("stop: the host aborts, the stream resolves `stopped` and no later event is handed on", async () => {
    const events: string[] = [];
    const c = controller();
    const run = streamAssist({ fetch, path: "/assist/", body: {}, controller: c, onEvent: (e) => events.push(e.event) });
    body.push(frame({ event: "delta", text: "半" }));
    await vi.waitFor(() => expect(events).toEqual(["delta"]));
    c.abort();
    await expect(run).resolves.toBe("stopped");
    expect(events).toEqual(["delta"]);
  });

  it("a body that ends without done or error is `dropped`", async () => {
    const run = streamAssist({ fetch, path: "/assist/", body: {}, controller: controller(), onEvent: () => {} });
    body.push(frame({ event: "delta", text: "半" }));
    body.push(null);
    await expect(run).resolves.toBe("dropped");
  });

  it("no text within the first-text budget is `timeout`, not `stopped`", async () => {
    vi.useFakeTimers();
    const c = controller();
    const run = streamAssist({ fetch, path: "/assist/", body: {}, controller: c, onEvent: () => {}, firstTextMs: 25_000 });
    await vi.advanceTimersByTimeAsync(24_999);
    expect(c.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toBe("timeout");
  });

  it("a delta clears the first-text timer; the total budget still ends it", async () => {
    vi.useFakeTimers();
    const c = controller();
    const run = streamAssist({ fetch, path: "/assist/", body: {}, controller: c, onEvent: () => {}, firstTextMs: 1_000, totalMs: 5_000 });
    await vi.advanceTimersByTimeAsync(10);
    body.push(frame({ event: "delta", text: "a" }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(c.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(run).resolves.toBe("timeout");
  });

  it("a refusal throws the status and body, which the code readers accept like an axios error", async () => {
    status = [429];
    const run = streamAssist({ fetch, path: "/me/assist/", body: {}, controller: controller(), onEvent: () => {} });
    await expect(run).rejects.toBeInstanceOf(AssistStreamHttpError);
    await run.catch((e: unknown) => expect(refusalBody(e)).toMatchObject({ code: "rate_limited" }));
  });

  it("401: refreshes once and retries with the new token", async () => {
    status = [401, 200];
    const refresh = vi.fn(async () => setAccessToken("NEW"));
    const run = streamAssist({ fetch, path: "/assist/", body: {}, controller: controller(), onEvent: () => {}, refresh });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(requests.map((r) => r.headers.Authorization)).toEqual(["Bearer OLD", "Bearer NEW"]);
    body.push(frame({ event: "error", kind: "unavailable", text_sent: false, detail: "x" }));
    await expect(run).resolves.toBe("ended");
  });
});

describe("assistBlocks (progressive Markdown)", () => {
  it("formats closed bold and finished list items", () => {
    expect(assistBlocks("先**提交**申请\n- 第一步\n2. 第二步\n", false)).toEqual([
      { kind: "p", marker: "", gap: false, spans: [{ text: "先", bold: false }, { text: "提交", bold: true }, { text: "申请", bold: false }] },
      { kind: "li", marker: "•", gap: false, spans: [{ text: "第一步", bold: false }] },
      { kind: "li", marker: "2.", gap: false, spans: [{ text: "第二步", bold: false }] },
    ]);
  });

  it("while streaming, a half-written bold and the list item in progress stay plain text", () => {
    const blocks = assistBlocks("好\n- 正在写**一半", true);
    expect(blocks[1]).toEqual({ kind: "p", marker: "", gap: false, spans: [{ text: "- 正在写**一半", bold: false }] });
    // …and the same line, once its newline arrives, is a list item.
    expect(assistBlocks("好\n- 正在写**一半**\n", true)[1]).toMatchObject({ kind: "li", spans: [{ text: "正在写", bold: false }, { text: "一半", bold: true }] });
  });

  it("a blank line starts a new paragraph", () => {
    expect(assistBlocks("一\n\n二", false).map((b) => b.gap)).toEqual([false, true]);
  });
});

describe("assistShownText (reduced motion)", () => {
  it("shows whole paragraphs while streaming, each as soon as its blank line arrives", () => {
    expect(assistShownText("第一段正在", true, true)).toBe("");
    expect(assistShownText("第一段。\n\n第二段正在", true, true)).toBe("第一段。");
  });
  it("shows everything once done, and always without reduced motion", () => {
    expect(assistShownText("第一段。\n\n第二段", false, true)).toBe("第一段。\n\n第二段");
    expect(assistShownText("第一段正在", true, false)).toBe("第一段正在");
  });
});
