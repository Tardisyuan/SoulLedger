/**
 * The SSE reader for `stream: true` (./assist-stream.ts). The body below is the
 * exact byte shape backend/apps/soul_assist/sse.py writes (`frame()`).
 */
import { describe, expect, it } from "vitest";
import {
  AssistStreamParser,
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
