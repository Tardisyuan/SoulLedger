import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCESS_TOKEN_KEY,
  configurePlatform,
  onAccessTokenChanged,
  resetPlatform,
  setAccessToken,
  setRefreshToken,
} from "../index";
import type { PlatformAdapter } from "../types";

/**
 * `onAccessTokenChanged`: the one signal that the bearer the realtime client
 * connected with has been replaced.
 *
 * WHY THE PORT AND NOT A CALL FROM `api/client.ts` INTO `ws/client.ts`. The
 * two modules do not know each other and should not: `api/client.ts` would
 * otherwise have to hold a socket it does not own. `setAccessToken` is the one
 * write the login page and `rotateRefreshToken` share, so the write is the
 * event. The consumer is `frontend/src/contexts/WebSocketContext.tsx`, pinned
 * end-to-end by `WebSocketContext.tokenRefresh.test.tsx`; this file pins the
 * port's own contract so that suite can fail for one reason at a time.
 */

function memoryAdapter(): PlatformAdapter & { writes: string[] } {
  const store = new Map<string, string>();
  const writes: string[] = [];
  const kv = {
    get: (k: string) => store.get(k) ?? null,
    set: (k: string, v: string) => {
      writes.push(`${k}=${v}`);
      store.set(k, v);
    },
    remove: (k: string) => {
      store.delete(k);
    },
  };
  return {
    writes,
    session: kv,
    persistent: kv,
    secure: kv,
    baseUrl: "http://x/api/v1",
    onUnauthorized: () => {},
    onSessionSuspend: () => () => {},
    onSessionResume: () => () => {},
    notify: () => {},
    deliverOnExit: () => false,
  };
}

afterEach(() => {
  resetPlatform();
});

describe("onAccessTokenChanged", () => {
  it("fires after the token is written — the handler can already read the new value", () => {
    const adapter = memoryAdapter();
    configurePlatform(adapter);
    const seen: string[] = [];
    const off = onAccessTokenChanged(() => {
      seen.push(adapter.session.get(ACCESS_TOKEN_KEY) ?? "<none>");
    });

    setAccessToken("t1");
    setAccessToken("t2");

    expect(seen).toEqual(["t1", "t2"]);
    expect(adapter.writes).toEqual([`${ACCESS_TOKEN_KEY}=t1`, `${ACCESS_TOKEN_KEY}=t2`]);
    off();
  });

  it("stops firing once unsubscribed, and other subscribers are unaffected", () => {
    configurePlatform(memoryAdapter());
    const a = vi.fn();
    const b = vi.fn();
    const offA = onAccessTokenChanged(a);
    const offB = onAccessTokenChanged(b);

    setAccessToken("t1");
    offA();
    setAccessToken("t2");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
  });

  it("does NOT fire for the refresh token — that write changes nothing the socket sent", () => {
    configurePlatform(memoryAdapter());
    const handler = vi.fn();
    const off = onAccessTokenChanged(handler);

    setRefreshToken("r1");

    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it("fires with the null adapter too — subscribers are not adapter state", () => {
    // A server render writes nowhere, but a handler installed before
    // `configurePlatform` must not be lost by `resetPlatform`/re-install: the
    // subscription belongs to the consumer, not to the host.
    const handler = vi.fn();
    const off = onAccessTokenChanged(handler);

    setAccessToken("t1");
    resetPlatform();
    setAccessToken("t2");

    expect(handler).toHaveBeenCalledTimes(2);
    off();
  });
});
