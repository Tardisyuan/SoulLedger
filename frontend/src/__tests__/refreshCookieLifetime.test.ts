/**
 * 「在此设备上保持登录 30 天」, as the browser sees it: the refresh cookie's
 * lifetime.
 *
 * The cookie is written by `lib/platform/web.ts`, not by the server, so this is
 * where Max-Age / Expires are decided and where they are pinned:
 *
 * - a token carrying `remember: true` → `max-age` = the token's remaining life
 *   (30 days fresh from login), no `expires`;
 * - any other token → neither `max-age` nor `expires`: a session cookie;
 * - both → exactly today's other attributes: `path=/`, `SameSite=Lax`, no
 *   `HttpOnly` (the value must stay readable by JS — see the note in web.ts),
 *   `Secure` only on https (jsdom serves http://localhost, so absent here).
 *
 * And the case that makes the claim necessary: a silent refresh rewrites the
 * cookie through `rotateRefreshToken`, which knows nothing about how the
 * operator signed in. The rotated token's claim is what keeps the cookie at
 * 30 days instead of quietly turning it into a session cookie.
 */
import { rotateRefreshToken } from "@soulledger/core/api/client";
import { configurePlatform, setRefreshToken } from "@soulledger/core/platform";
import { refreshCookieLifetime, REFRESH_TOKEN_KEY, webPlatform } from "@/lib/platform/web";

const NOW = 1_800_000_000; // seconds
const DAY = 86_400;

let mockRotatedRefresh = "";
jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: jest.fn(async () => ({ data: { access: "NEW-ACCESS", refresh: mockRotatedRefresh } })),
    create: () => ({ interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } }),
  },
}));

function b64url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwt(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.signature`;
}

const remembered = jwt({ token_type: "refresh", exp: NOW + 30 * DAY, iat: NOW, remember: true, tenant_code: "CN_DIYU" });
const ordinary = jwt({ token_type: "refresh", exp: NOW + 7 * DAY, iat: NOW, tenant_code: "CN_DIYU" });

/** Every string assigned to `document.cookie`, in order. jsdom's getter only
 *  returns name=value pairs, so the attributes can only be seen on the way in. */
let writes: string[] = [];
const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;

beforeEach(() => {
  writes = [];
  jest.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => cookieDescriptor.get!.call(document),
    set: (value: string) => {
      writes.push(value);
      cookieDescriptor.set!.call(document, value);
    },
  });
  configurePlatform(webPlatform);
});

afterEach(() => {
  jest.restoreAllMocks();
  // Drop the instance override so the prototype accessor is back.
  delete (document as unknown as { cookie?: string }).cookie;
  document.cookie = `${REFRESH_TOKEN_KEY}=; path=/; max-age=0`;
});

const attributes = (write: string) =>
  write
    .split(";")
    .slice(1)
    .map((part) => part.trim().toLowerCase());

const refreshWrites = () => writes.filter((w) => w.startsWith(`${REFRESH_TOKEN_KEY}=`) && !w.includes("max-age=0"));

describe("the refresh cookie's lifetime", () => {
  it("lives 30 days when the token was issued with 保持登录", () => {
    setRefreshToken(remembered);
    const [write] = refreshWrites();
    expect(write.startsWith(`${REFRESH_TOKEN_KEY}=${remembered};`)).toBe(true);
    expect(attributes(write)).toEqual(["path=/", `max-age=${30 * DAY}`, "samesite=lax"]);
  });

  it("is a session cookie otherwise — no max-age, no expires", () => {
    setRefreshToken(ordinary);
    const [write] = refreshWrites();
    expect(attributes(write)).toEqual(["path=/", "samesite=lax"]);
    expect(write).not.toMatch(/max-age|expires/i);
  });

  it("keeps today's other flags in both cases: no HttpOnly, no Secure on http", () => {
    setRefreshToken(remembered);
    setRefreshToken(ordinary);
    for (const write of refreshWrites()) {
      expect(write).not.toMatch(/httponly/i);
      expect(write).not.toMatch(/secure/i);
      expect(attributes(write)).toContain("samesite=lax");
      expect(attributes(write)).toContain("path=/");
    }
  });

  it("counts the remaining life, not a fixed 30 days, for an older remembered token", () => {
    expect(refreshCookieLifetime(remembered, NOW + 29 * DAY)).toBe(`; max-age=${DAY}`);
    expect(refreshCookieLifetime(remembered, NOW + 31 * DAY)).toBe("; max-age=0");
  });

  it.each([
    ["not a JWT", "opaque-value"],
    ["unparseable payload", "a.%%%.c"],
    ["remember as a string", jwt({ exp: NOW + 30 * DAY, remember: "true" })],
    ["remember false", jwt({ exp: NOW + 30 * DAY, remember: false })],
    ["remember without exp", jwt({ remember: true })],
  ])("falls back to the session lifetime for %s", (_label, token) => {
    expect(refreshCookieLifetime(token, NOW)).toBe("");
  });
});

describe("after a silent refresh", () => {
  it("a rotated remembered token keeps the 30-day cookie", async () => {
    mockRotatedRefresh = remembered;
    await rotateRefreshToken(ordinary);
    expect(attributes(refreshWrites().at(-1)!)).toContain(`max-age=${30 * DAY}`);
  });

  it("a rotated ordinary token stays a session cookie", async () => {
    mockRotatedRefresh = ordinary;
    await rotateRefreshToken(ordinary);
    expect(refreshWrites().at(-1)).not.toMatch(/max-age|expires/i);
  });
});
