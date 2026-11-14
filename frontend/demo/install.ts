"use client";

/**
 * The demo build's only way in. `PlatformProvider` requires this file behind
 * `process.env.NEXT_PUBLIC_DEMO_MODE === "1"`, a literal the bundler folds, so a normal build has none of `frontend/demo/`
 * (`src/__tests__/demoStaysOutOfTheNormalBuild.test.ts`, `scripts/check-demo-bundle.sh`).
 *
 * It has to run before the first request and the first socket, so it is synchronous and small: the store and the
 * recorded data load behind the first call. Nothing here touches the network, and no Service Worker is involved:
 * axios gets another adapter, `fetch` is wrapped for this API's paths only, and the realtime socket is a stand-in that
 * says "connected" and then stays quiet (without it every page would show the connection-lost banner).
 */
import axios, { type AxiosAdapter } from "axios";
import { api } from "@soulledger/core/api/client";

const runtime = () => import("./runtime");

/**
 * The answer comes a frame after the question, as a server's would (fe-perf.md P7): without this the whole read ran in
 * the click's own task — the "server time" counted into INP, and the loading states were never seen.
 */
const nextFrame = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
};

const adapter: AxiosAdapter = async (config) => {
  await nextFrame();
  return (await runtime()).axiosAnswer(config);
};

api.defaults.adapter = adapter;
axios.defaults.adapter = adapter;

class QuietSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = QuietSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    super();
    setTimeout(() => {
      this.readyState = QuietSocket.OPEN;
      this.onopen?.(new Event("open"));
    }, 0);
  }

  private reply(frame: object) {
    setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) })), 0);
  }

  send(raw: string) {
    const frame = JSON.parse(raw) as { type?: string };
    if (frame.type === "auth") this.reply({ type: "connected", user_id: 0, tenant_code: "", permissions: [] });
    if (frame.type === "ping") this.reply({ type: "pong" });
  }

  close(code = 1000) {
    this.readyState = QuietSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, wasClean: true }));
  }
}

if (typeof window !== "undefined") {
  window.WebSocket = QuietSocket as unknown as typeof WebSocket;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/api/v1/")) return realFetch(input, init);
    await nextFrame();
    return (await runtime()).fetchAnswer(url, init);
  };
}
