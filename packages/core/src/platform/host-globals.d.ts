/**
 * The globals this package is allowed to assume its host provides.
 *
 * WHY THIS FILE EXISTS AT ALL. `tsconfig.json` sets `lib: ["ES2020"]` with no
 * `"dom"`, which is the only thing enforcing the claim that this package is
 * platform-independent. But `lib.dom.d.ts` is not a list of *browser* APIs — it
 * is a list of everything a browser has, and that includes a dozen things React
 * Native has too. Dropping it therefore removes `document` (correct) and
 * `WebSocket` (not correct) in the same move.
 *
 * So the boundary is drawn here instead, by hand, as an allowlist. Everything
 * below exists in browsers **and** in React Native. Everything absent — and the
 * absences that matter are `document`, `window`, `localStorage`,
 * `sessionStorage`, `navigator`, `location`, `alert`, `fetch`-adjacent DOM
 * types — is a compile error in this package, which is what the boundary is
 * for. Host capabilities that are genuinely per-platform go through the ports
 * in `./types.ts`, not through a global.
 *
 * ADDING TO THIS FILE IS THE DECISION. A new entry is a claim that every
 * present and future client has the thing. `document` must never appear here;
 * if some module needs it, that module belongs in `frontend`, not in this
 * package. The declarations are deliberately minimal — only the members this
 * package actually uses — so that widening the surface is also an edit here.
 *
 * These are `declare`d, not imported, because that is what a host global is.
 * `@types/node` was the alternative and was rejected: it would supply `process`
 * and the timers, but it would also supply `Buffer`, `global`, `__dirname` and
 * the rest of the Node surface, which no browser and no phone has. That trades
 * one wrong boundary for another.
 */

declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

/** Build-time configuration, inlined by the bundler. Next and Expo both do
 *  this; neither ships the rest of Node's `process`. Only `env` is declared. */
declare const process: { env: Record<string, string | undefined> };

declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(handle: number | undefined): void;
declare function setInterval(handler: () => void, timeout?: number): number;
declare function clearInterval(handle: number | undefined): void;

interface URLSearchParams {
  append(name: string, value: string): void;
  forEach(callback: (value: string, key: string) => void): void;
  get(name: string): string | null;
  set(name: string, value: string): void;
  toString(): string;
}
declare const URLSearchParams: {
  new (init?: Record<string, string> | string): URLSearchParams;
};

interface URL {
  readonly searchParams: URLSearchParams;
  toString(): string;
}
declare const URL: { new (url: string, base?: string): URL };

/** Only ever a type here — file downloads are handed to the caller, which is
 *  the layer that knows what a "download" means on its platform. */
interface Blob {
  readonly size: number;
  readonly type: string;
}
declare const Blob: { new (parts?: unknown[], options?: { type?: string }): Blob };

interface WebSocketEventMap {
  /** `string`, not `string | ArrayBuffer | Blob`. Both WebSocket clients here
   *  do `JSON.parse(event.data)` unconditionally, so the narrow type states the
   *  assumption the code already makes: this app speaks JSON text frames. A
   *  binary protocol would have to widen this and handle the other cases. */
  readonly data: string;
  readonly code?: number;
  readonly reason?: string;
}

interface WebSocket {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: WebSocketEventMap) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: WebSocketEventMap) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
declare const WebSocket: {
  new (url: string, protocols?: string | string[]): WebSocket;
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly CLOSING: number;
  readonly CLOSED: number;
};
