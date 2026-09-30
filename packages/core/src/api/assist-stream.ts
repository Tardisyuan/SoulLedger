/**
 * Streaming answers from the assistant: a typed Server-Sent Events reader for
 * the three ask endpoints called with `stream: true` — `/me/assist/` (soul),
 * `/assist/` (officer) and `/assist-admin/try/`. backend/apps/soul_assist/sse.py
 * writes the events; docs/ARCHITECTURE-soul-assist.md §13 is the contract.
 *
 * Order: `meta` → `delta`* → `done` | `error`. Each event is an `event:` line
 * plus one `data:` line of JSON, and the JSON repeats `event`, so the data line
 * alone is enough. Errors before the stream starts (not enabled, throttled,
 * busy, unknown conversation) are ordinary JSON responses with a status code,
 * exactly as without `stream`.
 *
 * WHO SENDS THE REQUEST. Reading a body as it arrives is the one thing the
 * hosts do differently — the browser's `fetch`, `expo/fetch` on React Native —
 * and axios buffers the whole body on both. So `streamAssist` below takes the
 * host's `fetch` as an argument (structurally typed: nothing here needs a DOM
 * type) and owns the rest: the same URL, token and locale as the axios clients,
 * the 401 → refresh → retry-once, the two client timeouts, the decoding and the
 * parsing. `parseAssistStream` / `AssistStreamParser` stay usable on their own.
 *
 * STOP = the host aborts its request. The server notices the closed
 * connection, stops calling the model, and stores what was generated with
 * `interruption: "stopped"` (it shows up in the conversation list).
 */
import axios from "axios";
import { getAccessToken, getApiBaseUrl, getLocale } from "../platform/index";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type AssistStreamEvent = Schemas["AssistStreamEvent"];
export type AssistStreamMeta = Schemas["AssistStreamMeta"];
export type AssistStreamDelta = Schemas["AssistStreamDelta"];
export type AssistStreamDone = Schemas["AssistStreamDone"];
export type AssistStreamError = Schemas["AssistStreamError"];
/** The admin page's 试问: same events, but `done` carries the try result. */
export type AssistTryStreamEvent = Schemas["AssistTryStreamEvent"];

/**
 * When a streaming client should give up. The server ends a stream with an
 * `error` event at 22 s without text (first-token deadline) and at 60 s in all
 * (`ASSISTANT_TIMEOUT_SECONDS` / `ASSISTANT_STREAM_TOTAL_SECONDS`), so a client
 * that waits a little longer than each normally hears the reason from the
 * server; its own timeout then means the network. 25 s is canvas 1e's figure.
 */
export const ASSIST_STREAM_FIRST_TEXT_MS = 25_000;
export const ASSIST_STREAM_TOTAL_MS = 65_000;

function parseBlock<E>(block: string): E | null {
  const data: string[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
  }
  return data.length ? (JSON.parse(data.join("\n")) as E) : null;
}

/** Push text as it arrives (any split, even mid-character-sequence of a line); get back the events it completed. */
export class AssistStreamParser<E extends { event: string } = AssistStreamEvent> {
  private buffer = "";

  push(text: string): E[] {
    this.buffer += text;
    const events: E[] = [];
    for (let end = this.buffer.indexOf("\n\n"); end !== -1; end = this.buffer.indexOf("\n\n")) {
      const event = parseBlock<E>(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end + 2);
      if (event) events.push(event);
    }
    return events;
  }

  /** The body ended: whatever is left (a last event without its blank line). */
  end(): E[] {
    const event = parseBlock<E>(this.buffer);
    this.buffer = "";
    return event ? [event] : [];
  }
}

/** The body as decoded text chunks → the events, in order. */
export async function* parseAssistStream<E extends { event: string } = AssistStreamEvent>(
  chunks: AsyncIterable<string>,
): AsyncGenerator<E> {
  const parser = new AssistStreamParser<E>();
  for await (const chunk of chunks) yield* parser.push(chunk);
  yield* parser.end();
}

/** What a chat bubble needs, folded from the events. */
export interface AssistStreamState {
  conversationId: string | null;
  /** The text so far; on `done`, the stored answer (the server's copy wins). */
  text: string;
  done: AssistStreamDone | null;
  /** `kind: "interrupted"` keeps `text` — it was stored as a partial answer. */
  error: AssistStreamError | null;
}

export const INITIAL_ASSIST_STREAM_STATE: AssistStreamState = { conversationId: null, text: "", done: null, error: null };

export function reduceAssistStream(state: AssistStreamState, event: AssistStreamEvent): AssistStreamState {
  switch (event.event) {
    case "meta":
      return { ...state, conversationId: event.conversation_id };
    case "delta":
      return { ...state, text: state.text + event.text };
    case "done":
      return { ...state, conversationId: event.conversation_id, text: event.answer.content, done: event };
    case "error":
      return { ...state, conversationId: event.conversation_id ?? state.conversationId, error: event };
    default:
      return state;
  }
}

/**
 * A refusal before the stream started (not enabled, throttled, busy, unknown
 * conversation, a field error): the same status and JSON body the
 * non-streaming call answers with. The `…ErrorCode` / `…RetryAt` readers of
 * ./soul-assist, ./officer-assist and ./assist-admin read it like an axios error.
 */
export class AssistStreamHttpError extends Error {
  constructor(
    readonly status: number,
    readonly data: unknown,
  ) {
    super(`assist stream refused (${status})`);
  }
}

/** The JSON body of a refusal, from axios or from a stream request. */
export function refusalBody(error: unknown): Record<string, unknown> | undefined {
  const data =
    error instanceof AssistStreamHttpError ? error.data : axios.isAxiosError(error) ? error.response?.data : undefined;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
}

/**
 * The slice of `fetch` a streaming read needs, written structurally so both
 * hosts fit: the browser's `fetch`, and `expo/fetch` on React Native. Each host
 * wraps its own in one line (the DOM's `RequestInit` wants a DOM `AbortSignal`,
 * which this package cannot name).
 */
export interface AssistStreamResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
}
export type AssistStreamFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: unknown },
) => Promise<AssistStreamResponse>;

/** An `AbortController`, structurally: stopping is the host aborting it. */
export interface AssistStreamAbort {
  signal: { readonly aborted: boolean };
  abort(): void;
}

/**
 * How a stream ended, seen from the client:
 * - `ended`: the server sent `done` or `error` (the events say which);
 * - `stopped`: the host aborted (the reader pressed stop) — the server stores the partial answer;
 * - `timeout`: no text in `firstTextMs`, or not finished in `totalMs` (normally the network: the
 *   server's own deadlines are shorter and arrive as an `error` event);
 * - `dropped`: the body ended, or the connection broke, without `done` or `error`.
 */
export type AssistStreamEnd = "ended" | "stopped" | "timeout" | "dropped";

export interface StreamAssistOptions<E> {
  fetch: AssistStreamFetch;
  /** Path under the API base, e.g. `/me/assist/`. */
  path: string;
  /** The ask body; `stream: true` is added here. */
  body: object;
  controller: AssistStreamAbort;
  onEvent: (event: E) => void;
  /** On 401: renew the session (any authenticated call through the host's axios client does), then retry once. */
  refresh?: () => Promise<unknown>;
  firstTextMs?: number;
  totalMs?: number;
}

/** The same token and locale the axios clients send (./client.ts, ./soul.ts); read per attempt. */
function headers(): Record<string, string> {
  const token = getAccessToken();
  return { "Content-Type": "application/json", "Accept-Language": getLocale(), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/**
 * POST with `stream: true` and hand each event to `onEvent` as it arrives; resolves once a `done` /
 * `error` event is handled (or the stream ends another way — see `AssistStreamEnd`). Throws
 * `AssistStreamHttpError` for a refusal, or the fetch error when nothing was received.
 */
export async function streamAssist<E extends { event: string } = AssistStreamEvent>({
  fetch,
  path,
  body,
  controller,
  onEvent,
  refresh,
  firstTextMs = ASSIST_STREAM_FIRST_TEXT_MS,
  totalMs = ASSIST_STREAM_TOTAL_MS,
}: StreamAssistOptions<E>): Promise<AssistStreamEnd> {
  let timedOut = false;
  let started = false;
  const expire = () => {
    timedOut = true;
    controller.abort();
  };
  const total = setTimeout(expire, totalMs);
  const first = setTimeout(expire, firstTextMs);
  const send = () =>
    fetch(`${getApiBaseUrl()}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...body, stream: true }),
      signal: controller.signal,
    });
  /** `true` once the terminal event is handed on: nothing after it matters. */
  const emit = (events: E[]) => {
    for (const event of events) {
      if (event.event === "delta") clearTimeout(first);
      onEvent(event);
      if (event.event === "done" || event.event === "error") return true;
    }
    return false;
  };
  try {
    let res = await send();
    if (res.status === 401 && refresh) {
      await refresh();
      res = await send();
    }
    if (!res.ok) throw new AssistStreamHttpError(res.status, await res.json().catch(() => null));
    if (!res.body) throw new Error("assist stream: the response has no readable body");
    started = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const parser = new AssistStreamParser<E>();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (emit(parser.push(decoder.decode(value, { stream: true })))) return "ended";
    }
    return emit([...parser.push(decoder.decode()), ...parser.end()]) ? "ended" : "dropped";
  } catch (error) {
    if (timedOut) return "timeout";
    if (controller.signal.aborted) return "stopped";
    if (started) return "dropped";
    throw error;
  } finally {
    clearTimeout(total);
    clearTimeout(first);
  }
}

/**
 * Progressive Markdown for a streamed answer (canvas「流式输出」A3): only what has closed is formatted.
 * A line is a block — a list item (`- `, `* `, `1. `) or a paragraph — and `**bold**` is bold once
 * both markers are in. While `streaming`, the last line is still being written, so it stays plain
 * text as a list item (its marker shows as typed) until its newline arrives; an unclosed `**` always
 * shows as typed.
 * Only bold and list items: the prompt asks for plain text, and that is what models add anyway.
 */
export interface AssistSpan {
  text: string;
  bold: boolean;
}
export interface AssistBlock {
  kind: "p" | "li";
  /** `•` or the item's own number (`1.`). */
  marker: string;
  /** A blank line came before it: the start of a new paragraph. */
  gap: boolean;
  spans: AssistSpan[];
}

function spans(line: string): AssistSpan[] {
  const out: AssistSpan[] = [];
  let at = 0;
  for (const m of line.matchAll(/\*\*(.+?)\*\*/g)) {
    if (m.index! > at) out.push({ text: line.slice(at, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    at = m.index! + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at), bold: false });
  return out;
}

export function assistBlocks(text: string, streaming: boolean): AssistBlock[] {
  const lines = text.split("\n");
  const blocks: AssistBlock[] = [];
  let gap = false;
  lines.forEach((line, i) => {
    if (!line.trim()) {
      gap = blocks.length > 0;
      return;
    }
    const open = streaming && i === lines.length - 1;
    const item = open ? null : /^\s*([-*•]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    blocks.push(
      item
        ? { kind: "li", marker: /\d/.test(item[1]) ? item[1] : "•", gap, spans: spans(item[2]) }
        : { kind: "p", marker: "", gap, spans: spans(line) },
    );
    gap = false;
  });
  return blocks;
}

/**
 * Reduced motion (A11): text arrives a whole paragraph at a time — each one as soon as it finishes
 * (its blank line has arrived), not at the end of the answer. Otherwise everything received shows.
 */
export function assistShownText(text: string, streaming: boolean, reduced: boolean): string {
  if (!streaming || !reduced) return text;
  const end = text.lastIndexOf("\n\n");
  return end < 0 ? "" : text.slice(0, end);
}
