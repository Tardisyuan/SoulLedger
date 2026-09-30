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
 * WHY NO REQUEST HERE. Reading a body as it arrives is the one thing the hosts
 * do differently — web: `fetch` + `ReadableStream`; React Native: `expo/fetch`
 * or XHR `onprogress` — and axios buffers the whole body on both. So the host
 * sends the POST (same URL, same headers as `soulHttp` / `api`, body plus
 * `stream: true`) and hands this module the text as it arrives, either as an
 * async iterable (`parseAssistStream`) or by pushing into an
 * `AssistStreamParser`. Nothing below needs a DOM type or a platform port.
 *
 * STOP = the host aborts its request. The server notices the closed
 * connection, stops calling the model, and stores what was generated with
 * `interruption: "stopped"` (it shows up in the conversation list).
 */
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
