/**
 * The two ports added for the React Native adapter: `secure`, and
 * `onSessionResume`.
 *
 * WHY THIS FILE EXISTS AT ALL, given web behaviour is unchanged by both.
 * That is exactly the problem. On this host `secure` and `persistent` are the
 * same cookie jar and `onSessionResume` fires on a bfcache restore nobody
 * currently subscribes to, so every existing test stays green whether the split
 * happened or not. The thing the split is *for* — a host where the two stores
 * are different objects — has no adapter yet, and will not have one when this
 * code is next edited.
 *
 * So the subject here is not the web adapter. It is
 * `@soulledger/core/platform`'s routing: given an adapter whose `secure` and
 * `persistent` are demonstrably different stores, which one does the refresh
 * token land in. That question has an answer today and had a different answer
 * yesterday, and nothing else in the suite asks it.
 *
 * Both halves assert ABSENCE as well as presence. "The token is in `secure`"
 * stays green while a copy also sits in `persistent`, which is the state the
 * split exists to prevent.
 */
import {
  REFRESH_TOKEN_KEY,
  TENANT_ID_KEY,
  configurePlatform,
  getRefreshToken,
  getTenantId,
  onSessionResume,
  onSessionSuspend,
  resetPlatform,
  setRefreshToken,
  type KeyValueStore,
  type PlatformAdapter,
} from "@soulledger/core/platform";
import { installWebPlatform } from "@/lib/platform/web";

/** A store that records what it was given and knows nothing about any other. */
function recordingStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

function probeAdapter() {
  const session = recordingStore();
  const persistent = recordingStore();
  const secure = recordingStore();
  const adapter: PlatformAdapter = {
    session,
    persistent,
    secure,
    onUnauthorized: () => {},
    onSessionSuspend: () => () => {},
    onSessionResume: () => () => {},
    notify: () => {},
    deliverOnExit: () => false,
    baseUrl: "http://example.test/api/v1",
  };
  return { adapter, session, persistent, secure };
}

/**
 * `pageshow` carrying `persisted`. jsdom has no `PageTransitionEvent`
 * constructor, and a plain `new Event("pageshow")` has no `persisted` at all —
 * which reads as `undefined`, i.e. falsy, i.e. the adapter would ignore it and
 * the "restore fires the handler" test would pass for the wrong reason. Defined
 * explicitly so both directions of the branch are actually exercised.
 */
function pageshowEvent(persisted: boolean): Event {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

afterEach(() => {
  // jest.setup.js installs the web adapter for every suite. Put it back, so
  // this file does not leave a probe or a null adapter behind it.
  installWebPlatform();
  document.cookie = `${REFRESH_TOKEN_KEY}=; path=/; max-age=0`;
  localStorage.clear();
});

describe("the refresh token is routed to `secure`", () => {
  it("writes it to `secure` and NOT to `persistent`", () => {
    const { adapter, persistent, secure } = probeAdapter();
    configurePlatform(adapter);

    setRefreshToken("REFRESH-VALUE");

    expect(secure.data.get(REFRESH_TOKEN_KEY)).toBe("REFRESH-VALUE");
    // The half that fails if the routing goes back to `persistent`, and the
    // half that fails if it ever writes to both.
    expect(persistent.data.has(REFRESH_TOKEN_KEY)).toBe(false);
  });

  it("reads it from `secure` even when `persistent` holds a different value", () => {
    const { adapter, persistent, secure } = probeAdapter();
    configurePlatform(adapter);
    // A stale token in the old store is exactly what a half-done migration
    // leaves behind. Reading it would be the failure.
    persistent.data.set(REFRESH_TOKEN_KEY, "STALE-FROM-THE-OLD-STORE");
    secure.data.set(REFRESH_TOKEN_KEY, "CURRENT");

    expect(getRefreshToken()).toBe("CURRENT");
  });

  it("leaves the tenant id in `persistent` — the split is not a move of everything", () => {
    const { adapter, persistent, secure } = probeAdapter();
    configurePlatform(adapter);
    persistent.data.set(TENANT_ID_KEY, "tenant-a");

    expect(getTenantId()).toBe("tenant-a");
    expect(secure.data.has(TENANT_ID_KEY)).toBe(false);
  });

  it("an adapter with no `secure` store reads nothing rather than throwing", () => {
    resetPlatform();
    expect(getRefreshToken()).toBeNull();
  });
});

describe("web behaviour is unchanged by the split", () => {
  it("still round-trips the refresh token through the cookie jar", () => {
    installWebPlatform();

    setRefreshToken("WEB-REFRESH");

    expect(document.cookie).toContain(`${REFRESH_TOKEN_KEY}=WEB-REFRESH`);
    expect(getRefreshToken()).toBe("WEB-REFRESH");
  });
});

describe("onSessionResume", () => {
  it("does nothing, safely, when no host has installed an adapter", () => {
    resetPlatform();
    const handler = jest.fn();

    const unsubscribe = onSessionResume(handler);
    window.dispatchEvent(pageshowEvent(true));
    unsubscribe();

    expect(handler).not.toHaveBeenCalled();
  });

  it("fires on a bfcache restore", () => {
    installWebPlatform();
    const handler = jest.fn();
    const unsubscribe = onSessionResume(handler);

    window.dispatchEvent(pageshowEvent(true));

    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does NOT fire on an ordinary pageshow — a first paint is not a resume", () => {
    installWebPlatform();
    const handler = jest.fn();
    const unsubscribe = onSessionResume(handler);

    window.dispatchEvent(pageshowEvent(false));

    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops firing once unsubscribed", () => {
    installWebPlatform();
    const handler = jest.fn();

    const unsubscribe = onSessionResume(handler);
    window.dispatchEvent(pageshowEvent(true));
    unsubscribe();
    window.dispatchEvent(pageshowEvent(true));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("is a separate channel from suspend — neither event crosses over", () => {
    installWebPlatform();
    const resumed = jest.fn();
    const suspended = jest.fn();
    const stopResume = onSessionResume(resumed);
    const stopSuspend = onSessionSuspend(suspended);

    window.dispatchEvent(new Event("beforeunload"));
    expect(suspended).toHaveBeenCalledTimes(1);
    expect(resumed).not.toHaveBeenCalled();

    window.dispatchEvent(pageshowEvent(true));
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(suspended).toHaveBeenCalledTimes(1);

    stopResume();
    stopSuspend();
  });
});
