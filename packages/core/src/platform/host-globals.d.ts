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
 * below exists in browsers **and** in React Native. The absences that matter
 * are `document`, `window`, `localStorage`, `sessionStorage`, `navigator`,
 * `location` and `alert`, and those are compile errors here, which is what the
 * boundary is for. Host capabilities that are genuinely per-platform go through
 * the ports in `./types.ts`, not through a global.
 *
 * BUT `lib` DOES NOT COVER DOM *TYPES*, AND THIS FILE USED TO CLAIM IT DID.
 * The sentence above once read "Everything absent ... is a compile error in this
 * package", full stop. That was false for about 145 names.
 * `src/hooks/useStatutes.ts` imports `@tanstack/react-query`, which imports
 * `@types/react`, which loads `@types/react/global.d.ts` — and that file exists
 * precisely to let React compile without `lib: dom`, so it declares `Document`,
 * `Element`, `HTMLElement`, `MouseEvent`, `KeyboardEvent`, `TouchEvent`,
 * `FormData` and the rest as **empty interfaces**. `types: []` does not stop
 * this: it only turns off *automatic* `@types` inclusion, not ambient globals
 * reached through an import. So `const el: HTMLElement = {}` compiles here, and
 * a DOM-shaped signature reads as accepted while carrying no type safety and no
 * implementation on a phone.
 *
 * That leak cannot be closed from this package — React is a declared optional
 * peer dependency, so `@types/react` being in the program is a supported
 * configuration. What is enforced instead is that nothing in `src/` *uses* what
 * leaked, by `src/platform/__tests__/domBoundary.test.ts`, which derives the
 * banned list from `@types/react/global.d.ts` itself and allows only names this
 * file also declares. Adding an entry below is therefore the one way to take a
 * DOM name off that list — which is the same "adding to this file is the
 * decision" rule as ever, now with something checking it.
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

/* `process` IS NOT HERE, AND ITS ABSENCE IS THE DECISION.
 *
 * It used to be, as `{ env: Record<string, string | undefined> }`, described as
 * "build-time configuration, inlined by the bundler". That description was
 * true of what bundlers do and false as a claim about this package: the three
 * modules that read `process.env.NEXT_PUBLIC_API_URL` were the whole reason
 * `PlatformAdapter.baseUrl` exists, and once `baseUrl` became a port there was
 * no reader left. What remained was a declaration that made the next one
 * compile.
 *
 * `eslint.config.mjs` bans the *syntax*, and that is the belt. This is the
 * braces, and it is the stronger of the two: a selector matches shapes, and
 * `process["env"].X`, `const { env } = process`, `const p = process; p.env.X`
 * and `globalThis.process.env.X` are four shapes that reach the same value. An
 * undeclared name has no shapes. `no-undef` is off for TypeScript here (see
 * that file), so tsc is the only thing that can say this at all.
 *
 * Held by `__tests__/nodeGlobals.test.ts`, which asks the checker whether the
 * name resolves rather than reading this file as text. */



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

/* `URL` IS NOT HERE, AND ITS ABSENCE IS THE DECISION.
 *
 * It used to be, declared as `{ readonly searchParams: URLSearchParams }` with
 * a constructor, for one call site: `api/client.ts`'s `fetchAllPages` read a
 * page's parameters off `new URL(next).searchParams`. Under this file's own
 * header that declaration asserted that every present and future client has
 * `URL.searchParams`. React Native's `URL` is a partial polyfill written by
 * hand rather than the platform's own, and `searchParams` is the member it is
 * known for omitting — where it is absent, `parsed.searchParams` is `undefined`
 * and `.forEach` throws on the first paginated fetch, while this file said the
 * opposite. (The version cutoff is not stated because it was not measured:
 * there is no React Native checkout here to measure it against. The claim being
 * withdrawn is the point, not a reproduction.)
 *
 * `fetchAllPages` now splits the query off the string itself and hands it to
 * `URLSearchParams`, which is above and which React Native does ship. That was
 * `URL`'s only use in this package, so the entry is deleted rather than
 * narrowed: an allowlist entry with no call site is a claim nobody needs made.
 * Re-adding it means re-making the claim — deliberately, with a reason, which
 * is what the header asks for. */



/** Only ever a type here — file downloads are handed to the caller, which is
 *  the layer that knows what a "download" means on its platform. */
interface Blob {
  readonly size: number;
  readonly type: string;
}
declare const Blob: { new (parts?: unknown[], options?: { type?: string }): Blob };

/**
 * Multipart upload bodies. `usersApi.import` and `permApi.import` both take one
 * and hand it straight to axios.
 *
 * WHY THIS IS ALLOWED AND NOT BANNED. It is on the allowlist for the same
 * reason `WebSocket` and `Blob` are: React Native ships `FormData` as a global,
 * documented and used by its own `fetch`, so the claim this entry makes — every
 * present and future client has the thing — is true. It is spelled out here
 * because it was previously resolving *by accident*: `@types/react/global.d.ts`
 * reaches this package through `@tanstack/react-query`, and declares
 * `interface FormData {}` — empty, like the ~145 DOM names beside it, so `{}`
 * satisfied it and the two call sites had no type safety at all while reading
 * as though they did. `src/platform/__tests__/domBoundary.test.ts` now fails on
 * any name that resolves only that way; this declaration is what takes
 * `FormData` off that list on purpose rather than by omission.
 *
 * `append` is the only member declared: it is the whole of what a caller does
 * to build one of these, and it is the intersection of the web and React Native
 * shapes (RN's `value` accepts its own file-descriptor objects, hence
 * `unknown`). No constructor is declared, so `new FormData()` stays a compile
 * error in this package — assembling an upload means knowing what a "file" is
 * on the platform, which is the host's job. Core only ever receives one.
 */
interface FormData {
  append(name: string, value: unknown, fileName?: string): void;
}

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
