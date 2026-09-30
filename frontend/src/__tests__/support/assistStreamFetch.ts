/**
 * A fake `fetch` for the assistant's streamed asks (canvas「问一问 · 流式输出」). Core's real
 * `streamAssist` reads it — the real parser, timers and abort — and the test writes the body
 * event by event. Aborting the request rejects the pending read, as a browser's fetch does.
 */
import { TextDecoder, TextEncoder } from "node:util";

// jsdom has neither; the stream reader decodes bytes.
Object.assign(globalThis, { TextDecoder, TextEncoder });

export type StreamEvent = Record<string, unknown> & { event: string };
const frame = (e: StreamEvent) => `event: ${e.event}\ndata: ${JSON.stringify(e)}\n\n`;

/** One streamed ask: what was sent, and the pen for its body. */
export interface StreamAsk {
  url: string;
  body: Record<string, unknown>;
  send: (..._events: StreamEvent[]) => void;
  close: () => void;
  aborted: () => boolean;
}
/** What an ask does as soon as it arrives: write to it, refuse it (status + JSON body), or nothing yet. */
export type StreamScript = (_ask: StreamAsk) => { status: number; data: Record<string, string> } | void;

export function installStreamFetch() {
  const asks: StreamAsk[] = [];
  const scripts: StreamScript[] = [];
  const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
    const queue: (string | null)[] = [];
    let wake: (() => void) | null = null;
    let aborted = false;
    (init.signal as AbortSignal).addEventListener("abort", () => {
      aborted = true;
      wake?.();
    });
    const ask: StreamAsk = {
      url,
      body: JSON.parse(init.body as string),
      send: (...events) => {
        queue.push(events.map(frame).join(""));
        wake?.();
      },
      close: () => {
        queue.push(null);
        wake?.();
      },
      aborted: () => aborted,
    };
    asks.push(ask);
    const refused = scripts.shift()?.(ask);
    if (refused) return { ok: false, status: refused.status, json: async () => refused.data, body: null };
    const read = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
      while (!queue.length && !aborted) await new Promise<void>((r) => (wake = r));
      if (aborted) throw new DOMException("aborted", "AbortError");
      const next = queue.shift()!;
      return next === null ? { done: true } : { done: false, value: new TextEncoder().encode(next) };
    };
    return { ok: true, status: 200, json: async () => ({}), body: { getReader: () => ({ read }) } };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { asks, scripts, fetchMock };
}

export const refuse = (status: number, data: Record<string, string>): StreamScript => () => ({ status, data });
